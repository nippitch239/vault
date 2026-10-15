/**
 * Secure Vault Cloud — Shared Zero-Knowledge Cryptographic Engine
 *
 * Implements:
 * 1. Dual-Key Derivation (Argon2id + HKDF-Expand) separating Client Auth Hash and MEK
 * 2. Authenticated Symmetric Encryption (AES-256-GCM) with fresh 12-byte IV & 16-byte tag
 * 3. Asymmetric Key Generation & Key Wrapping (RSA-OAEP-SHA256) for UC-10 item sharing
 * 4. User private key encryption/decryption using MEK
 *
 * Ponytail minimalism: Native Web Crypto API first, zero polyfills, hash-wasm for Argon2id.
 */

import { argon2id } from 'hash-wasm';

const webCrypto = globalThis.crypto;
const subtle = webCrypto.subtle;

// Standard Cryptographic Constants (RFC 9106, NIST SP 800-38D, RFC 8017)
export const CRYPTO_CONSTANTS = {
  ARGON2_DEFAULTS: {
    iterations: 3,
    memorySize: 65536, // 64 MB (KiB)
    parallelism: 1,
    hashLength: 64, // 512 bits master key material
    outputType: 'binary',
  },
  FAST_TEST_ARGON2: {
    iterations: 1,
    memorySize: 1024,
    parallelism: 1,
    hashLength: 64,
    outputType: 'binary',
  },
  AES_GCM_KEY_LENGTH: 256, // bits
  AES_GCM_IV_LENGTH: 12, // 96 bits nonce
  AES_GCM_TAG_LENGTH: 128, // 16 bytes tag (in bits)
  RSA_MODULUS_LENGTH: 2048,
  RSA_PUBLIC_EXPONENT: new Uint8Array([1, 0, 1]), // 65537
  HKDF_INFO_MEK: 'securevault-master-encryption-key',
  HKDF_INFO_AK: 'securevault-client-authentication-key',
  HMAC_AUTH_MSG: 'securevault-auth-request',
};

/**
 * Custom Error for Cryptographic Operations
 */
export class CryptoError extends Error {
  constructor(message, code = 'CRYPTO_ERROR', originalError = null) {
    super(message);
    this.name = 'CryptoError';
    this.code = code;
    this.originalError = originalError;
  }
}

// ============================================================================
// Encoding Helpers (Isomorphic Node.js + Browser)
// ============================================================================

/**
 * Converts Uint8Array to Base64 string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toBase64(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('base64');
  }
  let binary = '';
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

/**
 * Converts Base64 string to Uint8Array
 * @param {string} base64
 * @returns {Uint8Array}
 */
export function fromBase64(base64) {
  if (!base64 || typeof base64 !== 'string') {
    throw new CryptoError('Invalid base64 input', 'INVALID_BASE64');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(base64, 'base64'));
  }
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/**
 * Converts Uint8Array to lowercase hexadecimal string
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function toHex(bytes) {
  if (typeof Buffer !== 'undefined') {
    return Buffer.from(bytes).toString('hex');
  }
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * Converts hexadecimal string to Uint8Array
 * @param {string} hex
 * @returns {Uint8Array}
 */
export function fromHex(hex) {
  if (!hex || typeof hex !== 'string' || hex.length % 2 !== 0) {
    throw new CryptoError('Invalid hexadecimal input', 'INVALID_HEX');
  }
  if (typeof Buffer !== 'undefined') {
    return new Uint8Array(Buffer.from(hex, 'hex'));
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

// ============================================================================
// Random Number & Salt Generation
// ============================================================================

/**
 * Generates cryptographically secure pseudorandom bytes using CSPRNG
 * @param {number} length
 * @returns {Uint8Array}
 */
export function generateRandomBytes(length = 16) {
  if (!Number.isInteger(length) || length <= 0) {
    throw new CryptoError('Length must be a positive integer', 'INVALID_LENGTH');
  }
  const bytes = new Uint8Array(length);
  webCrypto.getRandomValues(bytes);
  return bytes;
}

/**
 * Generates a fresh 16-byte random salt as Base64 string
 * @param {number} length
 * @returns {string}
 */
export function generateSalt(length = 16) {
  return toBase64(generateRandomBytes(length));
}

/**
 * Generates a fresh 12-byte IV for AES-256-GCM
 * @returns {Uint8Array}
 */
export function generateIV() {
  return generateRandomBytes(CRYPTO_CONSTANTS.AES_GCM_IV_LENGTH);
}

/**
 * Generates a random UUIDv4
 * @returns {string}
 */
export function generateUUID() {
  if (typeof webCrypto.randomUUID === 'function') {
    return webCrypto.randomUUID();
  }
  // Fallback RFC 4122 v4 UUID using CSPRNG
  const b = generateRandomBytes(16);
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = toHex(b);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

// ============================================================================
// Dual-Key Derivation (Argon2id + HKDF + HMAC)
// ============================================================================

/**
 * Derives both Client Auth Hash (authHash) and Master Encryption Key (mek)
 * from Master Password and User Salt.
 *
 * Guaranteed Properties:
 * 1. Zero-Knowledge: authHash cannot be inverted to derive MEK or Master Password.
 * 2. MEK is strictly retained in client memory (Uint8Array 32 bytes).
 * 3. authHash is transmitted over TLS to authenticate with backend.
 *
 * @param {string} masterPassword - Plaintext master password
 * @param {string|Uint8Array} salt - Account salt (base64 string or Uint8Array)
 * @param {object} [options] - Optional custom Argon2id parameters (e.g. for testing)
 * @returns {Promise<{ mek: Uint8Array, authHash: string, salt: string }>}
 */
export async function deriveMasterKeys(masterPassword, salt, options = {}) {
  if (typeof masterPassword !== 'string' || masterPassword.length === 0) {
    throw new CryptoError('Master password must be a non-empty string', 'INVALID_PASSWORD');
  }

  // Parse salt
  let saltBytes;
  let saltBase64;
  if (typeof salt === 'string') {
    saltBase64 = salt;
    saltBytes = fromBase64(salt);
  } else if (salt instanceof Uint8Array) {
    saltBytes = salt;
    saltBase64 = toBase64(salt);
  } else {
    throw new CryptoError('Salt must be a base64 string or Uint8Array', 'INVALID_SALT');
  }

  if (saltBytes.length < 16) {
    throw new CryptoError('Salt must be at least 16 bytes for cryptographic security', 'WEAK_SALT');
  }

  // Merge Argon2id parameters
  const argonConfig = {
    password: masterPassword,
    salt: saltBytes,
    iterations: options.iterations ?? CRYPTO_CONSTANTS.ARGON2_DEFAULTS.iterations,
    memorySize: options.memorySize ?? CRYPTO_CONSTANTS.ARGON2_DEFAULTS.memorySize,
    parallelism: options.parallelism ?? CRYPTO_CONSTANTS.ARGON2_DEFAULTS.parallelism,
    hashLength: options.hashLength ?? CRYPTO_CONSTANTS.ARGON2_DEFAULTS.hashLength,
    outputType: 'binary',
  };

  // Step 1: Compute 64-byte Master Key Material (MKM) via Argon2id
  let mkm;
  try {
    mkm = await argon2id(argonConfig);
  } catch (err) {
    throw new CryptoError('Argon2id derivation failed', 'ARGON2_ERROR', err);
  }

  // Step 2: HKDF-Expand to separate MEK and Client Auth Key (AK)
  try {
    const prkKey = await subtle.importKey('raw', mkm, 'HKDF', false, ['deriveBits']);

    // Derive Master Encryption Key (MEK) - 32 bytes (256 bits)
    const mekBuffer = await subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode(CRYPTO_CONSTANTS.HKDF_INFO_MEK),
      },
      prkKey,
      256
    );
    const mek = new Uint8Array(mekBuffer);

    // Derive Client Authentication Key (AK) - 32 bytes (256 bits)
    const akBuffer = await subtle.deriveBits(
      {
        name: 'HKDF',
        hash: 'SHA-256',
        salt: new Uint8Array(),
        info: new TextEncoder().encode(CRYPTO_CONSTANTS.HKDF_INFO_AK),
      },
      prkKey,
      256
    );
    const ak = new Uint8Array(akBuffer);

    // Step 3: Compute Client Auth Hash (authHash) via HMAC-SHA256(AK, "securevault-auth-request")
    const hmacKey = await subtle.importKey(
      'raw',
      ak,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const authHashBuffer = await subtle.sign(
      'HMAC',
      hmacKey,
      new TextEncoder().encode(CRYPTO_CONSTANTS.HMAC_AUTH_MSG)
    );
    const authHash = toHex(new Uint8Array(authHashBuffer));

    // mek is the Key Encryption Key (KEK): it only wraps the random Vault Key.
    return {
      kek: mek,
      mek,
      authHash,
      salt: saltBase64,
    };
  } catch (err) {
    throw new CryptoError('HKDF key expansion or auth hash derivation failed', 'KDF_EXPAND_ERROR', err);
  }
}

// ============================================================================
// Symmetric Encryption & Decryption (AES-256-GCM)
// ============================================================================

/**
 * Normalizes input key (Uint8Array or CryptoKey) to an AES-GCM CryptoKey
 * @param {Uint8Array|CryptoKey} key
 * @param {Array<string>} usages
 * @returns {Promise<CryptoKey>}
 */
async function importAesKey(key, usages = ['encrypt', 'decrypt']) {
  if (key && typeof key.type === 'string' && key.algorithm?.name === 'AES-GCM') {
    return key;
  }
  let rawBytes;
  if (key instanceof Uint8Array) {
    rawBytes = key;
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(key)) {
    rawBytes = new Uint8Array(key);
  } else if (typeof key === 'string') {
    rawBytes = fromBase64(key);
  } else {
    throw new CryptoError('Key must be a Uint8Array (32 bytes), base64 string, or CryptoKey', 'INVALID_KEY');
  }

  if (rawBytes.length !== 32) {
    throw new CryptoError(`AES-256 key must be exactly 32 bytes (received ${rawBytes.length})`, 'INVALID_KEY_LENGTH');
  }

  return await subtle.importKey('raw', rawBytes, { name: 'AES-GCM' }, false, usages);
}

/**
 * Encrypts arbitrary data using AES-256-GCM with fresh 12-byte IV and 16-byte auth tag.
 * Returns the exact JSONB payload format specified in PROJECT.md and crypto_backend_specs.md.
 *
 * @param {object|string} data - Plaintext secret object or string
 * @param {Uint8Array|CryptoKey} key - 256-bit encryption key
 * @param {object} [options]
 * @param {number} [options.keyVersion=1] - Cryptographic key revision version
 * @param {Uint8Array|string} [options.additionalData] - Optional AAD
 * @returns {Promise<{ ciphertext: string, iv: string, authTag: string, algorithm: string, keyVersion: number }>}
 */
export async function encryptData(data, key, options = {}) {
  try {
    const cryptoKey = await importAesKey(key, ['encrypt']);
    const iv = generateIV();

    let plaintextBytes;
    if (typeof data === 'string') {
      plaintextBytes = new TextEncoder().encode(data);
    } else {
      plaintextBytes = new TextEncoder().encode(JSON.stringify(data));
    }

    const encryptParams = {
      name: 'AES-GCM',
      iv,
      tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH,
    };

    if (options.additionalData) {
      encryptParams.additionalData =
        typeof options.additionalData === 'string'
          ? new TextEncoder().encode(options.additionalData)
          : options.additionalData;
    }

    // subtle.encrypt appends 16-byte auth tag to the end of ciphertext
    const encryptedBuffer = await subtle.encrypt(encryptParams, cryptoKey, plaintextBytes);
    const encBytes = new Uint8Array(encryptedBuffer);

    const ciphertextLen = encBytes.length - 16;
    const ciphertextBytes = encBytes.slice(0, ciphertextLen);
    const authTagBytes = encBytes.slice(ciphertextLen);

    return {
      ciphertext: toBase64(ciphertextBytes),
      iv: toBase64(iv),
      authTag: toBase64(authTagBytes),
      algorithm: 'AES-256-GCM',
      keyVersion: options.keyVersion ?? 1,
    };
  } catch (err) {
    throw new CryptoError('AES-256-GCM encryption failed', 'ENCRYPT_ERROR', err);
  }
}

/**
 * Decrypts an AES-256-GCM encrypted payload.
 * Throws CryptoError if authentication tag fails or data is tampered.
 *
 * @param {object} encryptedPayload - JSONB object with { ciphertext, iv, authTag, algorithm }
 * @param {Uint8Array|CryptoKey} key - 256-bit decryption key
 * @param {object} [options]
 * @param {Uint8Array|string} [options.additionalData] - Optional AAD matching encryption
 * @param {boolean} [options.rawString=false] - Return raw string instead of parsed JSON
 * @returns {Promise<any>} - Decrypted object or string
 */
export async function decryptData(encryptedPayload, key, options = {}) {
  if (!encryptedPayload || typeof encryptedPayload !== 'object') {
    throw new CryptoError('Encrypted payload must be an object', 'INVALID_PAYLOAD');
  }

  const { ciphertext, iv, algorithm } = encryptedPayload;
  // Handle authTag or auth_tag
  const authTag = encryptedPayload.authTag || encryptedPayload.auth_tag;

  if (!ciphertext || !iv || !authTag) {
    throw new CryptoError('Payload missing required cryptographic fields (ciphertext, iv, authTag)', 'INVALID_PAYLOAD');
  }

  if (algorithm && algorithm !== 'AES-256-GCM') {
    throw new CryptoError(`Unsupported algorithm: ${algorithm}. Expected AES-256-GCM`, 'UNSUPPORTED_ALGORITHM');
  }

  try {
    const cryptoKey = await importAesKey(key, ['decrypt']);
    const ivBytes = fromBase64(iv);
    const ciphertextBytes = fromBase64(ciphertext);
    const tagBytes = fromBase64(authTag);

    if (ivBytes.length !== CRYPTO_CONSTANTS.AES_GCM_IV_LENGTH) {
      throw new CryptoError(`Invalid IV length: expected 12 bytes, got ${ivBytes.length}`, 'INVALID_IV');
    }
    if (tagBytes.length !== 16) {
      throw new CryptoError(`Invalid Auth Tag length: expected 16 bytes, got ${tagBytes.length}`, 'INVALID_TAG');
    }

    // Reconstruct WebCrypto expected buffer: ciphertext || authTag
    const combinedBytes = new Uint8Array(ciphertextBytes.length + tagBytes.length);
    combinedBytes.set(ciphertextBytes, 0);
    combinedBytes.set(tagBytes, ciphertextBytes.length);

    const decryptParams = {
      name: 'AES-GCM',
      iv: ivBytes,
      tagLength: CRYPTO_CONSTANTS.AES_GCM_TAG_LENGTH,
    };

    if (options.additionalData) {
      decryptParams.additionalData =
        typeof options.additionalData === 'string'
          ? new TextEncoder().encode(options.additionalData)
          : options.additionalData;
    }

    const decryptedBuffer = await subtle.decrypt(decryptParams, cryptoKey, combinedBytes);
    const decryptedText = new TextDecoder().decode(decryptedBuffer);

    if (options.rawString) {
      return decryptedText;
    }

    try {
      return JSON.parse(decryptedText);
    } catch {
      return decryptedText;
    }
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError(
      'Decryption failed: authenticity tag verification failed or ciphertext tampered',
      'DECRYPT_FAILED',
      err
    );
  }
}

// ============================================================================
// Vault Key (random, wrapped by the password-derived KEK)
// ============================================================================
//
//   master password + kdf_salt --Argon2id--> Master Key --HKDF--> KEK + Authentication Key
//   KEK --AES-256-GCM--> unwraps the random Vault Key
//   Vault Key --AES-256-GCM--> RSA private key and personal vault items
//
// Changing the master password only re-wraps the Vault Key; items are not re-encrypted.

/**
 * Generates a fresh random 256-bit Vault Key.
 * @returns {Uint8Array}
 */
export function generateVaultKey() {
  return generateRandomBytes(32);
}

/**
 * Wraps the Vault Key with the KEK (AES-256-GCM, fresh IV).
 * @param {Uint8Array} vaultKey 32 bytes
 * @param {Uint8Array|CryptoKey} kek 32 bytes
 */
export async function wrapVaultKey(vaultKey, kek) {
  if (!(vaultKey instanceof Uint8Array) || vaultKey.length !== 32) {
    throw new CryptoError('Vault Key must be a 32-byte Uint8Array', 'INVALID_KEY_LENGTH');
  }
  return encryptData(toBase64(vaultKey), kek, { additionalData: 'securevault-vault-key-v1' });
}

/**
 * Unwraps the Vault Key. Fails (DECRYPT_FAILED) when the master password is wrong.
 * @returns {Promise<Uint8Array>}
 */
export async function unwrapVaultKey(encryptedVaultKey, kek) {
  const b64 = await decryptData(encryptedVaultKey, kek, { rawString: true, additionalData: 'securevault-vault-key-v1' });
  const bytes = fromBase64(b64);
  if (bytes.length !== 32) throw new CryptoError('Unwrapped Vault Key has invalid length', 'INVALID_KEY_LENGTH');
  return bytes;
}

/**
 * Maps the Authentication Key (hex authHash) to the Amazon Cognito password.
 * The fixed prefix satisfies Cognito's default password policy (upper, lower, digit,
 * symbol); all of the entropy comes from the 256-bit authHash.
 * @param {string} authHash 64 hex chars
 */
export function toCognitoPassword(authHash) {
  if (typeof authHash !== 'string' || !/^[0-9a-f]{64}$/.test(authHash)) {
    throw new CryptoError('authHash must be 64 lowercase hex characters', 'INVALID_AUTH_HASH');
  }
  return `Sv1!${authHash}`;
}

/**
 * Generates a fresh random 256-bit symmetric Item Key for vault items
 * @returns {Uint8Array}
 */
export function generateItemKey() {
  return generateRandomBytes(32);
}

// ============================================================================
// Asymmetric Key Pair Generation & Key Wrapping (UC-10 Item Sharing)
// ============================================================================

/**
 * Generates an RSA-OAEP-SHA256 2048-bit keypair for zero-knowledge sharing.
 * Returns public key in SPKI Base64 format and private key in PKCS8 Base64 format.
 *
 * @returns {Promise<{ publicKey: string, privateKey: string }>}
 */
export async function generateAsymmetricKeyPair() {
  try {
    const keyPair = await subtle.generateKey(
      {
        name: 'RSA-OAEP',
        modulusLength: CRYPTO_CONSTANTS.RSA_MODULUS_LENGTH,
        publicExponent: CRYPTO_CONSTANTS.RSA_PUBLIC_EXPONENT,
        hash: 'SHA-256',
      },
      true,
      ['encrypt', 'decrypt', 'wrapKey', 'unwrapKey']
    );

    const spkiBuffer = await subtle.exportKey('spki', keyPair.publicKey);
    const pkcs8Buffer = await subtle.exportKey('pkcs8', keyPair.privateKey);

    return {
      publicKey: toBase64(new Uint8Array(spkiBuffer)),
      privateKey: toBase64(new Uint8Array(pkcs8Buffer)),
    };
  } catch (err) {
    throw new CryptoError('RSA-OAEP key pair generation failed', 'KEYGEN_ERROR', err);
  }
}

/**
 * Imports an RSA-OAEP public key from SPKI Base64 string
 * @param {string} spkiBase64
 * @returns {Promise<CryptoKey>}
 */
export async function importPublicKey(spkiBase64) {
  try {
    const spkiBytes = fromBase64(spkiBase64);
    return await subtle.importKey(
      'spki',
      spkiBytes,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['encrypt', 'wrapKey']
    );
  } catch (err) {
    throw new CryptoError('Invalid public key format', 'INVALID_PUBLIC_KEY', err);
  }
}

/**
 * Imports an RSA-OAEP private key from PKCS8 Base64 string
 * @param {string} pkcs8Base64
 * @returns {Promise<CryptoKey>}
 */
export async function importPrivateKey(pkcs8Base64) {
  try {
    const pkcs8Bytes = fromBase64(pkcs8Base64);
    return await subtle.importKey(
      'pkcs8',
      pkcs8Bytes,
      { name: 'RSA-OAEP', hash: 'SHA-256' },
      false,
      ['decrypt', 'unwrapKey']
    );
  } catch (err) {
    throw new CryptoError('Invalid private key format', 'INVALID_PRIVATE_KEY', err);
  }
}

/**
 * Wraps (encrypts) a symmetric Item Key with a recipient's RSA-OAEP public key.
 *
 * @param {Uint8Array} itemKey - 32-byte symmetric item key
 * @param {string|CryptoKey} recipientPublicKey - Recipient's public key (SPKI base64 or CryptoKey)
 * @returns {Promise<{ wrappedKey: string, wrapped_key: string, algorithm: string }>}
 */
export async function wrapKey(itemKey, recipientPublicKey) {
  try {
    const pubKey =
      recipientPublicKey && typeof recipientPublicKey.type === 'string'
        ? recipientPublicKey
        : await importPublicKey(recipientPublicKey);

    const keyBytes =
      itemKey instanceof Uint8Array
        ? itemKey
        : fromBase64(itemKey);

    const encryptedBuffer = await subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, keyBytes);
    const wrappedKeyBase64 = toBase64(new Uint8Array(encryptedBuffer));

    return {
      wrappedKey: wrappedKeyBase64,
      wrapped_key: wrappedKeyBase64, // DB compatibility alias
      algorithm: 'RSA-OAEP-SHA256',
    };
  } catch (err) {
    throw new CryptoError('Key wrapping failed', 'WRAP_KEY_ERROR', err);
  }
}

/**
 * Unwraps (decrypts) a wrapped Item Key using the recipient's RSA-OAEP private key.
 *
 * @param {object|string} wrappedKeyPayload - { wrappedKey, algorithm } or base64 string
 * @param {string|CryptoKey} recipientPrivateKey - Recipient's private key (PKCS8 base64 or CryptoKey)
 * @returns {Promise<Uint8Array>} - 32-byte symmetric item key
 */
export async function unwrapKey(wrappedKeyPayload, recipientPrivateKey) {
  try {
    const privKey =
      recipientPrivateKey && typeof recipientPrivateKey.type === 'string'
        ? recipientPrivateKey
        : await importPrivateKey(recipientPrivateKey);

    let wrappedBase64;
    if (typeof wrappedKeyPayload === 'string') {
      wrappedBase64 = wrappedKeyPayload;
    } else if (wrappedKeyPayload && typeof wrappedKeyPayload === 'object') {
      wrappedBase64 = wrappedKeyPayload.wrappedKey || wrappedKeyPayload.wrapped_key;
    }

    if (!wrappedBase64) {
      throw new CryptoError('Missing wrappedKey data', 'INVALID_WRAPPED_KEY');
    }

    const wrappedBytes = fromBase64(wrappedBase64);
    const decryptedBuffer = await subtle.decrypt({ name: 'RSA-OAEP' }, privKey, wrappedBytes);
    return new Uint8Array(decryptedBuffer);
  } catch (err) {
    throw new CryptoError('Key unwrapping failed', 'UNWRAP_KEY_ERROR', err);
  }
}

// ============================================================================
// User Private Key Storage Encryption (At Registration & Login)
// ============================================================================

/**
 * Encrypts a user's RSA private key using their Master Encryption Key (MEK)
 * so it can be safely persisted in PostgreSQL users.encrypted_private_key JSONB.
 *
 * @param {string} privateKeyPkcs8 - Base64 PKCS8 private key
 * @param {Uint8Array} mek - 32-byte Master Encryption Key
 * @returns {Promise<{ ciphertext: string, iv: string, authTag: string, algorithm: string, keyVersion: number }>}
 */
export async function encryptPrivateKey(privateKeyPkcs8, mek) {
  return await encryptData({ privateKey: privateKeyPkcs8 }, mek);
}

/**
 * Decrypts a user's persisted private key using their Master Encryption Key (MEK).
 *
 * @param {object} encryptedPrivateKeyPayload - JSONB object
 * @param {Uint8Array} mek - 32-byte Master Encryption Key
 * @returns {Promise<string>} - Base64 PKCS8 private key
 */
export async function decryptPrivateKey(encryptedPrivateKeyPayload, mek) {
  const decrypted = await decryptData(encryptedPrivateKeyPayload, mek);
  return typeof decrypted === 'object' ? decrypted.privateKey : decrypted;
}

// ============================================================================
// Server-Side Defense-in-Depth Password Hashing Helper
// ============================================================================

// ============================================================================
// Collection keys (random 256-bit key per collection, RSA-OAEP wrapped per member)
// ============================================================================

function stripPem(key) {
  if (typeof key !== 'string') return key;
  return key
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/\s/g, '');
}

function toKeyBytes(key, label) {
  let bytes;
  if (key instanceof Uint8Array) bytes = key;
  else if (typeof key === 'string') bytes = fromBase64(key);
  else throw new CryptoError(`${label} must be a 32-byte Uint8Array or base64 string`, 'INVALID_KEY');
  if (bytes.length !== 32) {
    throw new CryptoError(`${label} must be exactly 32 bytes (received ${bytes.length})`, 'INVALID_KEY_LENGTH');
  }
  return bytes;
}

/**
 * @returns {Uint8Array} fresh 32-byte collection key
 */
export function generateCollectionKey() {
  return generateRandomBytes(32);
}

/**
 * Wraps a collection key for one member with RSA-OAEP-SHA256.
 * @param {Uint8Array|string} collectionKey
 * @param {string|CryptoKey} recipientPublicKey SPKI base64 / PEM / CryptoKey
 * @returns {Promise<{ algorithm: 'RSA-OAEP', hash: 'SHA-256', ciphertext: string }>}
 */
export async function wrapCollectionKey(collectionKey, recipientPublicKey) {
  const keyBytes = toKeyBytes(collectionKey, 'Collection key');
  try {
    const pubKey =
      recipientPublicKey && typeof recipientPublicKey.type === 'string'
        ? recipientPublicKey
        : await importPublicKey(stripPem(recipientPublicKey));
    const encrypted = await subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, keyBytes);
    return { algorithm: 'RSA-OAEP', hash: 'SHA-256', ciphertext: toBase64(new Uint8Array(encrypted)) };
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('Collection key wrapping failed', 'WRAP_COLLECTION_KEY_ERROR', err);
  }
}

/**
 * Unwraps a member's collection key with their RSA private key.
 * @param {object|string} wrapped { ciphertext } or base64 ciphertext
 * @param {string|CryptoKey} recipientPrivateKey PKCS#8 base64 / PEM / CryptoKey
 * @returns {Promise<Uint8Array>}
 */
export async function unwrapCollectionKey(wrapped, recipientPrivateKey) {
  const ciphertext =
    typeof wrapped === 'string' ? wrapped : wrapped?.ciphertext || wrapped?.wrappedKey || wrapped?.wrapped_key;
  if (!ciphertext) throw new CryptoError('Missing ciphertext in wrapped key payload', 'INVALID_WRAPPED_KEY');
  try {
    const privKey =
      recipientPrivateKey && typeof recipientPrivateKey.type === 'string'
        ? recipientPrivateKey
        : await importPrivateKey(stripPem(recipientPrivateKey));
    const decrypted = new Uint8Array(await subtle.decrypt({ name: 'RSA-OAEP' }, privKey, fromBase64(ciphertext)));
    if (decrypted.length !== 32) {
      throw new CryptoError(`Unwrapped key length mismatch: expected 32 bytes, got ${decrypted.length}`, 'INVALID_KEY_LENGTH');
    }
    return decrypted;
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('Collection key unwrapping failed', 'UNWRAP_COLLECTION_KEY_ERROR', err);
  }
}

/**
 * Computes a secure server-side password hash from client's authHash
 * using HMAC-SHA256 with server pepper/salt for defense-in-depth storage in users.auth_hash.
 *
 * @param {string} clientAuthHash - 64-char hex string sent by client
 * @param {string} serverSalt - Server-side secret pepper/salt
 * @returns {Promise<string>} - 64-char hex hash
 */
export async function hashAuthHash(clientAuthHash, serverSalt = 'securevault-server-salt') {
  const keyBuffer = new TextEncoder().encode(serverSalt);
  const hmacKey = await subtle.importKey(
    'raw',
    keyBuffer,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const hashBuffer = await subtle.sign(
    'HMAC',
    hmacKey,
    new TextEncoder().encode(clientAuthHash)
  );
  return toHex(new Uint8Array(hashBuffer));
}
