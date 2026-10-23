/**
 * SecureVault Cloud — Client Cryptography Service
 *
 * Implements client-side Zero-Knowledge cryptographic flows:
 * 1. Master Key Derivation (Argon2id + HKDF) -> MEK kept strictly in memory, authHash sent to server
 * 2. AES-256-GCM vault payload encryption/decryption with fresh IVs
 * 3. RSA-OAEP asymmetric key generation & key wrapping for UC-10 sharing
 * 4. Password generation & entropy calculation integration
 */

import {
  deriveMasterKeys,
  generateSalt,
  encryptData,
  decryptData,
  generateAsymmetricKeyPair,
  wrapKey,
  unwrapKey,
  encryptPrivateKey,
  decryptPrivateKey,
  toBase64,
  fromBase64,
  generateRandomBytes,
  CryptoError,
  importPublicKey,
  importPrivateKey,
} from '../../shared/crypto.js';

import {
  generatePassword,
  generatePassphrase,
  calculateEntropy,
  CHAR_SETS,
} from '../../shared/generator.js';

import {
  validateRegistration,
  validateLogin,
  validateVaultItem,
  validateShareRequest,
  validatePasswordReset,
  getErrorMessage,
} from '../../shared/validator.js';

export const ClientCrypto = {
  // Key Derivation
  deriveKeys: async (masterPassword, salt) => {
    return await deriveMasterKeys(masterPassword, salt);
  },

  createSalt: (length = 16) => {
    return generateSalt(length);
  },

  // Asymmetric Keys for Sharing (UC-10)
  createKeyPair: async () => {
    return await generateAsymmetricKeyPair();
  },

  protectPrivateKey: async (privateKey, mek) => {
    return await encryptPrivateKey(privateKey, mek);
  },

  unprotectPrivateKey: async (encryptedPrivateKey, mek) => {
    return await decryptPrivateKey(encryptedPrivateKey, mek);
  },

  // Vault Items (AES-256-GCM)
  encryptItem: async (plainPayload, mek) => {
    // Encrypts { username, password, url, notes, ... }
    return await encryptData(plainPayload, mek);
  },

  decryptItem: async (encryptedData, mek) => {
    return await decryptData(encryptedData, mek);
  },

  // Shared items use their own random Item Key: the payload is encrypted with it,
  // and `owner_key` holds that Item Key encrypted with the owner's MEK.
  // Recipients get the same Item Key wrapped with their RSA public key.
  getOwnerItemKey: async (encryptedData, mek) => {
    if (!encryptedData?.owner_key) return null;
    const keyB64 = await decryptData(encryptedData.owner_key, mek, { rawString: true });
    return fromBase64(keyB64);
  },

  decryptVaultItem: async (encryptedData, { mek, itemKey } = {}) => {
    if (encryptedData?.owner_key || itemKey) {
      const key = itemKey || (await ClientCrypto.getOwnerItemKey(encryptedData, mek));
      return await decryptData(encryptedData, key);
    }
    return await decryptData(encryptedData, mek);
  },

  encryptVaultItem: async (plainPayload, existingEncryptedData, { mek, itemKey } = {}) => {
    if (!existingEncryptedData?.owner_key) {
      return await encryptData(plainPayload, mek);
    }
    const key = itemKey || (await ClientCrypto.getOwnerItemKey(existingEncryptedData, mek));
    const encrypted = await encryptData(plainPayload, key);
    return { ...encrypted, owner_key: existingEncryptedData.owner_key };
  },

  createSharedEnvelope: async (plainPayload, mek) => {
    const itemKey = generateRandomBytes(32);
    const encrypted = await encryptData(plainPayload, itemKey);
    encrypted.owner_key = await encryptData(toBase64(itemKey), mek);
    return { itemKey, encryptedData: encrypted };
  },

  // Key Wrapping for Sharing
  wrapItemKey: async (itemKey, recipientPublicKey) => {
    return await wrapKey(itemKey, recipientPublicKey);
  },

  unwrapItemKey: async (wrappedKey, recipientPrivateKey) => {
    return await unwrapKey(wrappedKey, recipientPrivateKey);
  },

  generateItemKey: () => {
    return generateRandomBytes(32);
  },

  // Collections Cryptography (M2/M3: R2)
  generateCollectionKey: () => {
    return generateCollectionKey();
  },

  wrapCollectionKey: async (collectionKey, recipientPublicKey) => {
    return await wrapCollectionKey(collectionKey, recipientPublicKey);
  },

  unwrapCollectionKey: async (wrappedKey, recipientPrivateKey) => {
    return await unwrapCollectionKey(wrappedKey, recipientPrivateKey);
  },

  encryptCollectionItem: async (plainPayload, collectionKey, options = {}) => {
    return await encryptCollectionItem(plainPayload, collectionKey, options);
  },

  decryptCollectionItem: async (encryptedPayload, collectionKey, options = {}) => {
    return await decryptCollectionItem(encryptedPayload, collectionKey, options);
  },

  // Password Generator & Entropy
  generateSecurePassword: (options) => {
    return generatePassword(options);
  },

  generateSecurePassphrase: (options) => {
    return generatePassphrase(options);
  },

  calculateStrength: (pwd, isPassphrase) => {
    return calculateEntropy(pwd, isPassphrase);
  },

  // Validation
  validators: {
    validateRegistration,
    validateLogin,
    validateVaultItem,
    validateShareRequest,
    validatePasswordReset,
    getErrorMessage,
  },

  // Helpers
  toBase64,
  fromBase64,
  CHAR_SETS,
};

// ============================================================================
// Collection Cryptography & Key Wrapping Helpers (M2/M3 Zero-Knowledge Sharing)
// ============================================================================

function cleanKeyString(pemOrBase64) {
  if (typeof pemOrBase64 !== 'string') return pemOrBase64;
  return pemOrBase64
    .replace(/-----BEGIN [^-]+-----/g, '')
    .replace(/-----END [^-]+-----/g, '')
    .replace(/[\r\n\s]/g, '');
}

/**
 * Generates a 256-bit (32-byte) cryptographically secure symmetric collection key.
 * @returns {Uint8Array}
 */
export function generateCollectionKey() {
  return generateRandomBytes(32);
}

/**
 * Wraps a 32-byte symmetric Collection Key with a recipient's RSA public key via RSA-OAEP-SHA256.
 * Conforms strictly to schema { ciphertext, algorithm: 'RSA-OAEP', hash: 'SHA-256' }.
 *
 * @param {Uint8Array|Buffer|string} collectionKey - 32-byte symmetric collection key
 * @param {string|CryptoKey} recipientPublicKey - SPKI base64 string, PEM string, or CryptoKey
 * @returns {Promise<{ algorithm: string, ciphertext: string, hash: string }>}
 */
export async function wrapCollectionKey(collectionKey, recipientPublicKey) {
  let keyBytes;
  if (collectionKey instanceof Uint8Array) {
    keyBytes = collectionKey;
  } else if (typeof Buffer !== 'undefined' && Buffer.isBuffer(collectionKey)) {
    keyBytes = new Uint8Array(collectionKey);
  } else if (typeof collectionKey === 'string') {
    keyBytes = fromBase64(collectionKey);
  } else {
    throw new CryptoError('Collection key must be a 32-byte Buffer or Uint8Array', 'INVALID_KEY');
  }

  if (keyBytes.length !== 32) {
    throw new CryptoError(`Collection key must be exactly 32 bytes (received ${keyBytes.length})`, 'INVALID_KEY_LENGTH');
  }

  try {
    if (typeof process !== 'undefined' && typeof recipientPublicKey === 'string' && recipientPublicKey.includes('-----BEGIN')) {
      const nodeCrypto = await import('node:crypto');
      const encryptedBuf = nodeCrypto.publicEncrypt(
        {
          key: recipientPublicKey,
          padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(keyBytes)
      );
      return {
        algorithm: 'RSA-OAEP',
        ciphertext: encryptedBuf.toString('base64'),
        hash: 'SHA-256',
      };
    }

    const subtle = globalThis.crypto?.subtle;
    let pubKey;
    if (recipientPublicKey && typeof recipientPublicKey.type === 'string') {
      pubKey = recipientPublicKey;
    } else {
      const cleaned = cleanKeyString(recipientPublicKey);
      pubKey = await importPublicKey(cleaned);
    }

    const encryptedBuffer = await subtle.encrypt({ name: 'RSA-OAEP' }, pubKey, keyBytes);
    const ciphertext = toBase64(new Uint8Array(encryptedBuffer));

    return {
      algorithm: 'RSA-OAEP',
      ciphertext,
      hash: 'SHA-256',
    };
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('Collection key wrapping failed', 'WRAP_COLLECTION_KEY_ERROR', err);
  }
}

/**
 * Unwraps a wrapped Collection Key using recipient's RSA private key.
 *
 * @param {object|string} wrappedKeyObj - { ciphertext, algorithm, hash } or base64 string
 * @param {string|CryptoKey} recipientPrivateKey - PKCS8 base64 string, PEM string, or CryptoKey
 * @returns {Promise<Uint8Array>} - 32-byte symmetric collection key
 */
export async function unwrapCollectionKey(wrappedKeyObj, recipientPrivateKey) {
  if (!wrappedKeyObj) {
    throw new CryptoError('Missing wrapped key payload', 'INVALID_WRAPPED_KEY');
  }

  let ciphertextBase64;
  if (typeof wrappedKeyObj === 'string') {
    ciphertextBase64 = wrappedKeyObj;
  } else if (typeof wrappedKeyObj === 'object') {
    ciphertextBase64 = wrappedKeyObj.ciphertext || wrappedKeyObj.wrappedKey || wrappedKeyObj.wrapped_key;
  }

  if (!ciphertextBase64) {
    throw new CryptoError('Missing ciphertext in wrapped key payload', 'INVALID_WRAPPED_KEY');
  }

  try {
    if (typeof process !== 'undefined' && typeof recipientPrivateKey === 'string' && recipientPrivateKey.includes('-----BEGIN')) {
      const nodeCrypto = await import('node:crypto');
      const decryptedBuf = nodeCrypto.privateDecrypt(
        {
          key: recipientPrivateKey,
          padding: nodeCrypto.constants.RSA_PKCS1_OAEP_PADDING,
          oaepHash: 'sha256',
        },
        Buffer.from(ciphertextBase64, 'base64')
      );
      if (decryptedBuf.length !== 32) {
        throw new CryptoError(`Unwrapped key length mismatch: expected 32 bytes, got ${decryptedBuf.length}`, 'INVALID_KEY_LENGTH');
      }
      return new Uint8Array(decryptedBuf);
    }

    const subtle = globalThis.crypto?.subtle;
    let privKey;
    if (recipientPrivateKey && typeof recipientPrivateKey.type === 'string') {
      privKey = recipientPrivateKey;
    } else {
      const cleaned = cleanKeyString(recipientPrivateKey);
      privKey = await importPrivateKey(cleaned);
    }

    const ciphertextBytes = fromBase64(ciphertextBase64);
    const decryptedBuffer = await subtle.decrypt({ name: 'RSA-OAEP' }, privKey, ciphertextBytes);
    const unwrappedKey = new Uint8Array(decryptedBuffer);

    if (unwrappedKey.length !== 32) {
      throw new CryptoError(`Unwrapped key length mismatch: expected 32 bytes, got ${unwrappedKey.length}`, 'INVALID_KEY_LENGTH');
    }

    return unwrappedKey;
  } catch (err) {
    if (err instanceof CryptoError) throw err;
    throw new CryptoError('Collection key unwrapping failed', 'UNWRAP_COLLECTION_KEY_ERROR', err);
  }
}

/**
 * Encrypts a vault item payload using a symmetric collection key with AES-256-GCM.
 *
 * @param {object|string} plainPayload - Sensitive item payload
 * @param {Uint8Array|Buffer|string} collectionKey - 32-byte symmetric collection key
 * @param {object} [options] - Optional options
 * @returns {Promise<{ ciphertext: string, iv: string, authTag: string, algorithm: string, keyVersion: number }>}
 */
export async function encryptCollectionItem(plainPayload, collectionKey, options = {}) {
  return await encryptData(plainPayload, collectionKey, options);
}

/**
 * Decrypts an encrypted vault item payload using a symmetric collection key with AES-256-GCM.
 *
 * @param {object} encryptedPayload - JSONB payload { ciphertext, iv, authTag, algorithm }
 * @param {Uint8Array|Buffer|string} collectionKey - 32-byte symmetric collection key
 * @param {object} [options] - Optional options
 * @returns {Promise<any>} - Decrypted object or string
 */
export async function decryptCollectionItem(encryptedPayload, collectionKey, options = {}) {
  return await decryptData(encryptedPayload, collectionKey, options);
}

export default ClientCrypto;
