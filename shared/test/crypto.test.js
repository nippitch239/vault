import test from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveMasterKeys,
  encryptData,
  decryptData,
  generateSalt,
  generateItemKey,
  generateAsymmetricKeyPair,
  wrapKey,
  unwrapKey,
  encryptPrivateKey,
  decryptPrivateKey,
  hashAuthHash,
  toBase64,
  fromBase64,
  toHex,
  fromHex,
  CRYPTO_CONSTANTS,
  CryptoError,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  toCognitoPassword,
} from '../crypto.js';

test('Encoding Utilities: Base64 and Hex roundtrips', () => {
  const originalBytes = new Uint8Array([0, 1, 15, 16, 127, 128, 254, 255]);

  const b64 = toBase64(originalBytes);
  const decodedB64 = fromBase64(b64);
  assert.deepEqual(decodedB64, originalBytes);

  const hex = toHex(originalBytes);
  assert.equal(hex, '00010f107f80feff');
  const decodedHex = fromHex(hex);
  assert.deepEqual(decodedHex, originalBytes);
});

test('Dual-Key Derivation (Argon2id + HKDF + HMAC)', async () => {
  const masterPassword = 'CorrectHorseBatteryStaple123!';
  const salt = generateSalt(16);

  // Derive master keys using standard RFC 9106 Argon2id parameters
  const result = await deriveMasterKeys(masterPassword, salt, CRYPTO_CONSTANTS.FAST_TEST_ARGON2);

  assert.ok(result.mek instanceof Uint8Array, 'MEK must be a Uint8Array');
  assert.equal(result.mek.length, 32, 'MEK must be exactly 32 bytes (256 bits)');
  assert.ok(typeof result.authHash === 'string', 'authHash must be a string');
  assert.equal(result.authHash.length, 64, 'authHash must be 64-character lowercase hex');
  assert.equal(/^[0-9a-f]{64}$/.test(result.authHash), true, 'authHash must match hex format');
  assert.equal(result.salt, salt, 'Salt must match input salt');

  // Determinism check: Same password + same salt must produce exact same keys
  const secondResult = await deriveMasterKeys(masterPassword, salt, CRYPTO_CONSTANTS.FAST_TEST_ARGON2);
  assert.deepEqual(secondResult.mek, result.mek, 'Same inputs must derive identical MEK');
  assert.equal(secondResult.authHash, result.authHash, 'Same inputs must derive identical authHash');

  // Salt isolation: Different salt must produce completely distinct MEK and authHash
  const differentSalt = generateSalt(16);
  const saltIsolated = await deriveMasterKeys(masterPassword, differentSalt, CRYPTO_CONSTANTS.FAST_TEST_ARGON2);
  assert.notDeepEqual(saltIsolated.mek, result.mek, 'Different salt must yield different MEK');
  assert.notEqual(saltIsolated.authHash, result.authHash, 'Different salt must yield different authHash');

  // Password sensitivity: Different password with same salt must yield completely distinct keys
  const differentPass = await deriveMasterKeys('DifferentPassword999!', salt, CRYPTO_CONSTANTS.FAST_TEST_ARGON2);
  assert.notDeepEqual(differentPass.mek, result.mek, 'Different password must yield different MEK');
  assert.notEqual(differentPass.authHash, result.authHash, 'Different password must yield different authHash');
});

test('Dual-Key Derivation: Zero-Knowledge & Validation Guards', async () => {
  const validSalt = generateSalt(16);

  // Rejects empty password
  await assert.rejects(
    () => deriveMasterKeys('', validSalt),
    (err) => err instanceof CryptoError && err.code === 'INVALID_PASSWORD'
  );

  // Rejects salt shorter than 16 bytes
  const weakSalt = toBase64(new Uint8Array(8));
  await assert.rejects(
    () => deriveMasterKeys('validPass123', weakSalt),
    (err) => err instanceof CryptoError && err.code === 'WEAK_SALT'
  );
});

test('AES-256-GCM Authenticated Encryption & Decryption Roundtrip', async () => {
  const mek = generateItemKey(); // 32 bytes
  const secretPayload = {
    title: 'Cloudflare Admin',
    url: 'https://dash.cloudflare.com',
    username: 'admin@corporate.io',
    password: 'UltraSecurePassword!2026',
    notes: 'Emergency 2FA recovery backup: 9812-4412',
    favorite: true,
  };

  // 1. Encrypt payload
  const encrypted = await encryptData(secretPayload, mek, { keyVersion: 1 });

  assert.ok(encrypted.ciphertext, 'Ciphertext must be present');
  assert.ok(encrypted.iv, 'IV must be present');
  assert.ok(encrypted.authTag, 'Auth Tag must be present');
  assert.equal(encrypted.algorithm, 'AES-256-GCM');
  assert.equal(encrypted.keyVersion, 1);

  // Decoded IV must be exactly 12 bytes
  const ivBytes = fromBase64(encrypted.iv);
  assert.equal(ivBytes.length, 12, 'IV must be 12 bytes (96 bits)');

  // Decoded Auth Tag must be exactly 16 bytes
  const tagBytes = fromBase64(encrypted.authTag);
  assert.equal(tagBytes.length, 16, 'Auth Tag must be 16 bytes (128 bits)');

  // 2. Decrypt payload
  const decrypted = await decryptData(encrypted, mek);
  assert.deepEqual(decrypted, secretPayload, 'Decrypted payload must match original secret');

  // 3. Raw String roundtrip
  const stringSecret = 'Plaintext sensitive token: secret_tok_xyz123';
  const encString = await encryptData(stringSecret, mek);
  const decString = await decryptData(encString, mek);
  assert.equal(decString, stringSecret);
});

test('AES-256-GCM Fresh IV Guarantee', async () => {
  const mek = generateItemKey();
  const secret = 'IdenticalSecretText';

  const enc1 = await encryptData(secret, mek);
  const enc2 = await encryptData(secret, mek);

  // Critical security invariant: NEVER reuse IV
  assert.notEqual(enc1.iv, enc2.iv, 'Two encryptions must NEVER use the same IV');
  assert.notEqual(enc1.ciphertext, enc2.ciphertext, 'Same plaintext with different IVs must produce different ciphertexts');
});

test('Tamper Resistance & Authentication Tag Verification (Integrity Mandate)', async () => {
  const mek = generateItemKey();
  const encrypted = await encryptData({ account: 'Bank Vault' }, mek);

  // 1. Altering 1 character in ciphertext must trigger cryptographic rejection
  const tamperedCiphertext = {
    ...encrypted,
    ciphertext: encrypted.ciphertext.slice(0, -2) + (encrypted.ciphertext.slice(-2, -1) === 'A' ? 'B' : 'A') + '=',
  };
  await assert.rejects(
    () => decryptData(tamperedCiphertext, mek),
    (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
    'Tampered ciphertext must fail authentication'
  );

  // 2. Altering 1 character in Auth Tag must fail authentication
  const tamperedTag = {
    ...encrypted,
    authTag: (encrypted.authTag.slice(0, 1) === 'A' ? 'B' : 'A') + encrypted.authTag.slice(1),
  };
  await assert.rejects(
    () => decryptData(tamperedTag, mek),
    (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
    'Tampered Auth Tag must fail authentication'
  );

  // 3. Altering 1 character in IV must fail authentication
  const tamperedIV = {
    ...encrypted,
    iv: (encrypted.iv.slice(0, 1) === 'A' ? 'B' : 'A') + encrypted.iv.slice(1),
  };
  await assert.rejects(
    () => decryptData(tamperedIV, mek),
    (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
    'Tampered IV must fail authentication'
  );

  // 4. Decrypting with wrong key must fail authentication
  const wrongKey = generateItemKey();
  await assert.rejects(
    () => decryptData(encrypted, wrongKey),
    (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
    'Decrypting with incorrect MEK must fail'
  );
});

test('Additional Authenticated Data (AAD) Protection', async () => {
  const mek = generateItemKey();
  const aad = 'user_id=123e4567-e89b-12d3-a456-426614174000;item_id=987a';

  const encrypted = await encryptData({ secret: 'bounded' }, mek, { additionalData: aad });

  // Correct AAD succeeds
  const decrypted = await decryptData(encrypted, mek, { additionalData: aad });
  assert.deepEqual(decrypted, { secret: 'bounded' });

  // Wrong AAD fails
  await assert.rejects(
    () => decryptData(encrypted, mek, { additionalData: 'user_id=attacker-injected' }),
    (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
    'Decryption with mismatched AAD must fail'
  );
});

test('Asymmetric Key Wrapping (RSA-OAEP-SHA256) for UC-10 Item Sharing', async () => {
  // Recipient generates RSA-OAEP key pair
  const recipientKeyPair = await generateAsymmetricKeyPair();
  assert.ok(recipientKeyPair.publicKey.length > 100, 'SPKI public key should be valid base64');
  assert.ok(recipientKeyPair.privateKey.length > 500, 'PKCS8 private key should be valid base64');

  // Owner generates fresh 256-bit Item Key (IK)
  const itemKey = generateItemKey();

  // Owner wraps IK with Recipient's public key
  const wrappedPayload = await wrapKey(itemKey, recipientKeyPair.publicKey);
  assert.ok(wrappedPayload.wrappedKey, 'Wrapped key must be present');
  assert.equal(wrappedPayload.algorithm, 'RSA-OAEP-SHA256');

  // Recipient unwraps IK with their private key
  const unwrappedKey = await unwrapKey(wrappedPayload, recipientKeyPair.privateKey);
  assert.deepEqual(unwrappedKey, itemKey, 'Unwrapped item key must match original item key');

  // Another user's private key cannot unwrap
  const otherKeyPair = await generateAsymmetricKeyPair();
  await assert.rejects(
    () => unwrapKey(wrappedPayload, otherKeyPair.privateKey),
    (err) => err instanceof CryptoError && err.code === 'UNWRAP_KEY_ERROR',
    'Wrong private key must not unwrap the item key'
  );
});

test('User Private Key Storage Encryption with MEK', async () => {
  const mek = generateItemKey();
  const keyPair = await generateAsymmetricKeyPair();

  // Encrypt private key with user's MEK for storage in users.encrypted_private_key
  const encryptedPrivKey = await encryptPrivateKey(keyPair.privateKey, mek);
  assert.ok(encryptedPrivKey.ciphertext);
  assert.ok(encryptedPrivKey.authTag);

  // Decrypt private key on login
  const recoveredPrivKey = await decryptPrivateKey(encryptedPrivKey, mek);
  assert.equal(recoveredPrivKey, keyPair.privateKey);
});

test('Server-Side Defense-in-Depth Hashing (hashAuthHash)', async () => {
  const authHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
  const serverSalt = 'company-production-pepper-9921';

  const serverHash1 = await hashAuthHash(authHash, serverSalt);
  assert.equal(serverHash1.length, 64);
  assert.equal(/^[0-9a-f]{64}$/.test(serverHash1), true);

  const serverHash2 = await hashAuthHash(authHash, serverSalt);
  assert.equal(serverHash1, serverHash2, 'Must be deterministic for identical server salt');

  const differentSaltHash = await hashAuthHash(authHash, 'different-pepper');
  assert.notEqual(serverHash1, differentSaltHash);
});

test('Dual-Key Derivation: RFC 9106 Production Parameters (m=64MB, t=3, p=1)', async () => {
  const masterPassword = 'ProductionMasterPassword!2026';
  const salt = generateSalt(16);

  // Derives using default production parameters (64MB memory, 3 iterations, 1 parallelism, 64-byte MKM)
  const result = await deriveMasterKeys(masterPassword, salt);

  assert.equal(result.mek.length, 32, 'MEK must be 32 bytes');
  assert.equal(result.authHash.length, 64, 'authHash must be 64-character hex');
  assert.equal(/^[0-9a-f]{64}$/.test(result.authHash), true);

  // Verify that encrypting with this production MEK works
  const payload = { item: 'production-secret' };
  const encrypted = await encryptData(payload, result.mek);
  const decrypted = await decryptData(encrypted, result.mek);
  assert.deepEqual(decrypted, payload);
});



test('Vault Key: random key wrapped by the KEK, wrong master password cannot unwrap', async () => {
  const fast = CRYPTO_CONSTANTS.FAST_TEST_ARGON2;
  const salt = generateSalt();
  const { kek, authHash } = await deriveMasterKeys('correct horse battery staple', salt, fast);
  const vaultKey = generateVaultKey();
  assert.equal(vaultKey.length, 32);

  const wrapped = await wrapVaultKey(vaultKey, kek);
  assert.equal(wrapped.algorithm, 'AES-256-GCM');
  assert.deepEqual(await unwrapVaultKey(wrapped, kek), vaultKey);

  const { kek: wrongKek } = await deriveMasterKeys('wrong password', salt, fast);
  await assert.rejects(() => unwrapVaultKey(wrapped, wrongKek), (err) => err.code === 'DECRYPT_FAILED');

  // Re-wrapping after a master password change keeps the same Vault Key
  const { kek: newKek } = await deriveMasterKeys('a brand new master password', generateSalt(), fast);
  assert.deepEqual(await unwrapVaultKey(await wrapVaultKey(vaultKey, newKek), newKek), vaultKey);

  // Cognito password derived from the Authentication Key
  const cognitoPassword = toCognitoPassword(authHash);
  assert.ok(cognitoPassword.endsWith(authHash));
  assert.match(cognitoPassword, /[A-Z]/);
  assert.match(cognitoPassword, /[^A-Za-z0-9]/);
  assert.throws(() => toCognitoPassword('not-hex'));
});
