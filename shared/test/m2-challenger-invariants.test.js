/**
 * Challenger M2.2 — Empirical Security Invariants & Zero-Knowledge Verification
 *
 * Rigorous adversarial verification of:
 * 1. Zero-Knowledge Leak Probes: Return objects and error stacks never expose raw keys.
 * 2. Unrelated RSA Key Attacks: Wrapped Org/Collection Keys cannot be unwrapped by unauthorized keys.
 * 3. Two-Tier AAD Context Isolation: Anti-replay defense between Item Keys, Vault Keys, Org Keys.
 * 4. Non-Extractable CryptoKey Defense: asCryptoKey returns non-exportable WebCrypto keys.
 * 5. Input Boundaries & Fuzzing: Length, type strictness, and 1-bit tampering detection.
 */

import test, { describe } from 'node:test';
import assert from 'node:assert/strict';
import {
  generateOrgKey,
  wrapOrgKey,
  unwrapOrgKey,
  generateCollectionKey,
  wrapCollectionKey,
  unwrapCollectionKey,
  generateItemKey,
  wrapItemKey,
  unwrapItemKey,
  generateVaultKey,
  wrapVaultKey,
  unwrapVaultKey,
  generateAsymmetricKeyPair,
  encryptData,
  decryptData,
  toBase64,
  fromBase64,
  toHex,
  CryptoError,
} from '../crypto.js';

describe('Challenger M2.2: Cryptographic Security Invariants & Zero-Knowledge Leak Probes', () => {

  test('Zero-Knowledge Leak Probe: Return objects never expose raw keys in plaintext, hex, base64, or JSON', async () => {
    const keyPair = await generateAsymmetricKeyPair();
    const rawOrgKey = generateOrgKey();
    const rawColKey = generateCollectionKey();
    const rawItemKey = generateItemKey();

    const orgKeyHex = toHex(rawOrgKey);
    const orgKeyB64 = toBase64(rawOrgKey);
    const colKeyHex = toHex(rawColKey);
    const colKeyB64 = toBase64(rawColKey);
    const itemKeyHex = toHex(rawItemKey);
    const itemKeyB64 = toBase64(rawItemKey);

    // 1. Inspect wrapOrgKey return object
    const wrappedOrg = await wrapOrgKey(rawOrgKey, keyPair.publicKey);
    const wrappedOrgJson = JSON.stringify(wrappedOrg);

    assert.ok(wrappedOrg.ciphertext, 'Ciphertext must be present');
    assert.equal(typeof wrappedOrg.ciphertext, 'string');
    assert.equal(wrappedOrg.algorithm, 'RSA-OAEP');
    assert.equal(wrappedOrg.hash, 'SHA-256');

    // Leak checks
    assert.ok(!wrappedOrgJson.includes(orgKeyHex), 'Raw Org Key hex must not appear in JSON');
    assert.ok(!wrappedOrgJson.includes(orgKeyB64), 'Raw Org Key base64 must not appear in JSON');
    assert.notEqual(wrappedOrg.ciphertext, orgKeyB64, 'Ciphertext must differ completely from plaintext base64');
    assert.notEqual(wrappedOrg.ciphertext, orgKeyHex, 'Ciphertext must differ completely from plaintext hex');

    // 2. Inspect wrapCollectionKey return object
    const wrappedCol = await wrapCollectionKey(rawColKey, keyPair.publicKey);
    const wrappedColJson = JSON.stringify(wrappedCol);

    assert.ok(!wrappedColJson.includes(colKeyHex), 'Raw Collection Key hex must not appear in JSON');
    assert.ok(!wrappedColJson.includes(colKeyB64), 'Raw Collection Key base64 must not appear in JSON');
    assert.notEqual(wrappedCol.ciphertext, colKeyB64, 'Ciphertext must differ from raw key');

    // 3. Inspect wrapItemKey return object
    const wrappedItem = await wrapItemKey(rawItemKey, rawColKey);
    const wrappedItemJson = JSON.stringify(wrappedItem);

    assert.ok(!wrappedItemJson.includes(itemKeyHex), 'Raw Item Key hex must not appear in wrapped Item Key JSON');
    assert.ok(!wrappedItemJson.includes(itemKeyB64), 'Raw Item Key base64 must not appear in wrapped Item Key JSON');
    assert.notEqual(wrappedItem.ciphertext, itemKeyB64, 'Item key ciphertext must be encrypted');

    // 4. Inspect encryptData / encryptItem return object
    const sensitivePayload = {
      user: 'admin_super_secret',
      secret: 'UltraSecureEnterprisePassword-2026!#$%',
      pin: '984712',
    };
    const encryptedPayload = await encryptData(sensitivePayload, rawItemKey);
    const encJson = JSON.stringify(encryptedPayload);

    assert.ok(!encJson.includes(sensitivePayload.user), 'Payload plaintext username must not appear in encrypted object');
    assert.ok(!encJson.includes(sensitivePayload.secret), 'Payload plaintext secret must not appear in encrypted object');
    assert.ok(!encJson.includes(sensitivePayload.pin), 'Payload plaintext pin must not appear in encrypted object');
    assert.ok(!encJson.includes(itemKeyHex), 'Item key hex must not appear in encrypted payload metadata');
    assert.ok(!encJson.includes(itemKeyB64), 'Item key base64 must not appear in encrypted payload metadata');
  });

  test('Zero-Knowledge Leak Probe: Error messages and stack traces never echo raw keys or private keys', async () => {
    const aliceKeyPair = await generateAsymmetricKeyPair();
    const bobKeyPair = await generateAsymmetricKeyPair();
    const rawOrgKey = generateOrgKey();
    const orgKeyHex = toHex(rawOrgKey);
    const orgKeyB64 = toBase64(rawOrgKey);
    const privKeyB64 = aliceKeyPair.privateKey;

    const wrapped = await wrapOrgKey(rawOrgKey, aliceKeyPair.publicKey);

    // 1. Wrong private key unwrapping error
    try {
      await unwrapOrgKey(wrapped, bobKeyPair.privateKey);
      assert.fail('Expected unwrap with wrong private key to throw');
    } catch (err) {
      const fullError = `${err.message} ${err.stack} ${err.originalError?.message || ''} ${err.originalError?.stack || ''}`;
      assert.ok(!fullError.includes(orgKeyHex), 'Wrong-key error must not leak raw org key hex');
      assert.ok(!fullError.includes(orgKeyB64), 'Wrong-key error must not leak raw org key base64');
      assert.ok(!fullError.includes(privKeyB64), 'Wrong-key error must not leak private key');
      assert.ok(!fullError.includes(bobKeyPair.privateKey), 'Wrong-key error must not leak attacker private key');
    }

    // 2. Corrupted ciphertext unwrapping error
    const corruptedCiphertext = {
      ...wrapped,
      ciphertext: wrapped.ciphertext.slice(0, 10) + 'FFFF' + wrapped.ciphertext.slice(14),
    };
    try {
      await unwrapOrgKey(corruptedCiphertext, aliceKeyPair.privateKey);
      assert.fail('Expected unwrap with corrupted ciphertext to throw');
    } catch (err) {
      const fullError = `${err.message} ${err.stack}`;
      assert.ok(!fullError.includes(orgKeyHex), 'Corrupt-ciphertext error must not leak org key hex');
      assert.ok(!fullError.includes(orgKeyB64), 'Corrupt-ciphertext error must not leak org key base64');
    }

    // 3. Invalid key length wrapping error
    const invalidKey = new Uint8Array(16); // 128-bit key
    const invalidKeyHex = toHex(invalidKey);
    try {
      await wrapOrgKey(invalidKey, aliceKeyPair.publicKey);
      assert.fail('Expected 16-byte key wrapping to throw');
    } catch (err) {
      const fullError = `${err.message} ${err.stack}`;
      assert.ok(!fullError.includes(invalidKeyHex), 'Invalid key error must not echo the raw invalid key bytes');
    }
  });

  test('Context Isolation: Org Key and Collection Key cannot be unwrapped by unrelated RSA private keys', async () => {
    const ownerKeyPair = await generateAsymmetricKeyPair();
    const recipientKeyPair = await generateAsymmetricKeyPair();
    const attackerKeyPair = await generateAsymmetricKeyPair();

    const orgKey = generateOrgKey();
    const colKey = generateCollectionKey();

    // Wrapped for legitimate recipient
    const wrappedOrg = await wrapOrgKey(orgKey, recipientKeyPair.publicKey);
    const wrappedCol = await wrapCollectionKey(colKey, recipientKeyPair.publicKey);

    // Legitimate recipient succeeds
    const recoveredOrg = await unwrapOrgKey(wrappedOrg, recipientKeyPair.privateKey);
    const recoveredCol = await unwrapCollectionKey(wrappedCol, recipientKeyPair.privateKey);
    assert.deepEqual(recoveredOrg, orgKey, 'Legitimate recipient recovers org key');
    assert.deepEqual(recoveredCol, colKey, 'Legitimate recipient recovers collection key');

    // Attacker with unrelated RSA key must fail
    await assert.rejects(
      async () => unwrapOrgKey(wrappedOrg, attackerKeyPair.privateKey),
      (err) => err instanceof CryptoError && err.code === 'UNWRAP_ORG_KEY_ERROR',
      'Attacker RSA private key cannot unwrap Org Key'
    );

    await assert.rejects(
      async () => unwrapCollectionKey(wrappedCol, attackerKeyPair.privateKey),
      (err) => err instanceof CryptoError && err.code === 'UNWRAP_COLLECTION_KEY_ERROR',
      'Attacker RSA private key cannot unwrap Collection Key'
    );

    // Owner cannot unwrap if key was wrapped exclusively for recipient
    await assert.rejects(
      async () => unwrapOrgKey(wrappedOrg, ownerKeyPair.privateKey),
      (err) => err instanceof CryptoError && err.code === 'UNWRAP_ORG_KEY_ERROR',
      'Owner cannot unwrap recipient-specific ciphertext with owner private key'
    );
  });

  test('Two-Tier AAD Context Separation: Item Keys fail decryption under mismatched AAD or wrong wrapping keys', async () => {
    const itemKey = generateItemKey();
    const collectionKeyA = generateCollectionKey();
    const collectionKeyB = generateCollectionKey();
    const orgKey = generateOrgKey();
    const vaultKey = generateVaultKey();

    // Protect Item Key with collectionKeyA (uses AAD 'securevault-item-key-v1')
    const wrappedItemKey = await wrapItemKey(itemKey, collectionKeyA);

    // Success with legitimate collectionKeyA
    const recovered = await unwrapItemKey(wrappedItemKey, collectionKeyA);
    assert.deepEqual(recovered, itemKey, 'Item Key unwrapped with matching collection key');

    // Attack 1: Unwrapping with a different Collection Key must fail
    await assert.rejects(
      async () => unwrapItemKey(wrappedItemKey, collectionKeyB),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      'Wrong Collection Key fails AES-GCM tag verification'
    );

    // Attack 2: Unwrapping with Org Key (even though it is a valid 32-byte key) must fail
    await assert.rejects(
      async () => unwrapItemKey(wrappedItemKey, orgKey),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      'Org Key cannot unwrap Collection-wrapped Item Key'
    );

    // Attack 3: Cross-tier replay attack — Attempting to unwrap Item Key as Vault Key
    // Vault Key unwrap expects AAD 'securevault-vault-key-v1'.
    // Even if the attacker passes collectionKeyA as the kek parameter, the AAD mismatch MUST cause tag failure!
    await assert.rejects(
      async () => unwrapVaultKey(wrappedItemKey, collectionKeyA),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      'Cross-tier unwrap as Vault Key fails due to AAD mismatch'
    );

    // Attack 4: Reverse cross-tier replay — Attempting to unwrap Vault Key as Item Key
    const wrappedVaultKey = await wrapVaultKey(vaultKey, collectionKeyA);
    await assert.rejects(
      async () => unwrapItemKey(wrappedVaultKey, collectionKeyA),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      'Reverse cross-tier unwrap as Item Key fails due to AAD mismatch'
    );

    // Attack 5: Tampered AAD during manual decryptData
    await assert.rejects(
      async () => decryptData(wrappedItemKey, collectionKeyA, { rawString: true, additionalData: 'tampered-aad-context' }),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      'Tampered AAD context string immediately fails tag verification'
    );
  });

  test('Non-Extractable CryptoKey Defense: asCryptoKey returns non-exportable AES-GCM key', async () => {
    const keyPair = await generateAsymmetricKeyPair();
    const orgKey = generateOrgKey();
    const wrapped = await wrapOrgKey(orgKey, keyPair.publicKey);

    const cryptoKey = await unwrapOrgKey(wrapped, keyPair.privateKey, { asCryptoKey: true });

    assert.equal(cryptoKey.type, 'secret');
    assert.equal(cryptoKey.algorithm.name, 'AES-GCM');
    assert.equal(cryptoKey.extractable, false, 'CryptoKey MUST be non-extractable to prevent in-memory export');

    // Attempting subtle.exportKey must fail because extractable is false
    await assert.rejects(
      async () => {
        const webCrypto = globalThis.crypto;
        await webCrypto.subtle.exportKey('raw', cryptoKey);
      },
      /key is not extractable|InvalidAccessError|OperationError/i,
      'Attempting to export a non-extractable key must be rejected by Web Crypto engine'
    );

    // Non-extractable key must still function cleanly for encryption & decryption
    const testSecret = { msg: 'confidential organization secret' };
    const encrypted = await encryptData(testSecret, cryptoKey);
    const decrypted = await decryptData(encrypted, cryptoKey);
    assert.deepEqual(decrypted, testSecret, 'Non-extractable CryptoKey successfully encrypts and decrypts');
  });

  test('Boundary & Tamper Resistance: Strict validation of key length and bit-flip detection', async () => {
    const keyPair = await generateAsymmetricKeyPair();

    // Invalid lengths for wrapOrgKey
    const invalidLengths = [0, 1, 15, 16, 24, 31, 33, 48, 64, 128];
    for (const len of invalidLengths) {
      const invalidKey = new Uint8Array(len);
      await assert.rejects(
        async () => wrapOrgKey(invalidKey, keyPair.publicKey),
        (err) => err instanceof CryptoError && err.code === 'INVALID_KEY_LENGTH',
        `wrapOrgKey must reject invalid length ${len} bytes`
      );
      await assert.rejects(
        async () => wrapCollectionKey(invalidKey, keyPair.publicKey),
        (err) => err instanceof CryptoError && err.code === 'INVALID_KEY_LENGTH',
        `wrapCollectionKey must reject invalid length ${len} bytes`
      );
    }

    // Invalid types for wrapOrgKey
    const invalidTypes = [123, true, null, undefined, {}, [], () => {}];
    for (const invalidType of invalidTypes) {
      await assert.rejects(
        async () => wrapOrgKey(invalidType, keyPair.publicKey),
        (err) => err instanceof CryptoError && (err.code === 'INVALID_KEY' || err.code === 'INVALID_BASE64'),
        `wrapOrgKey must reject non-buffer/non-string type: ${typeof invalidType}`
      );
    }

    // Malformed wrapped payload for unwrapOrgKey
    const malformedWrapped = [
      null,
      undefined,
      '',
      {},
      { ciphertext: '' },
      { ciphertext: 'not-valid-base64!' },
    ];
    for (const malformed of malformedWrapped) {
      await assert.rejects(
        async () => unwrapOrgKey(malformed, keyPair.privateKey),
        (err) => err instanceof CryptoError,
        'unwrapOrgKey must reject malformed wrapped payload'
      );
    }

    // 1-bit tampering detection across all fields in AES-GCM wrapped item key
    const itemKey = generateItemKey();
    const colKey = generateCollectionKey();
    const wrapped = await wrapItemKey(itemKey, colKey);

    // Tamper ciphertext
    const tamperedCiphertext = {
      ...wrapped,
      ciphertext: fromBase64(wrapped.ciphertext),
    };
    tamperedCiphertext.ciphertext[0] ^= 0x01;
    tamperedCiphertext.ciphertext = toBase64(tamperedCiphertext.ciphertext);
    await assert.rejects(
      async () => unwrapItemKey(tamperedCiphertext, colKey),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      '1-bit flip in ciphertext must cause DECRYPT_FAILED'
    );

    // Tamper IV
    const tamperedIV = {
      ...wrapped,
      iv: fromBase64(wrapped.iv),
    };
    tamperedIV.iv[0] ^= 0x01;
    tamperedIV.iv = toBase64(tamperedIV.iv);
    await assert.rejects(
      async () => unwrapItemKey(tamperedIV, colKey),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      '1-bit flip in IV must cause DECRYPT_FAILED'
    );

    // Tamper Auth Tag
    const authTagKey = wrapped.authTag ? 'authTag' : 'auth_tag';
    const tamperedTag = {
      ...wrapped,
      [authTagKey]: fromBase64(wrapped[authTagKey]),
    };
    tamperedTag[authTagKey][0] ^= 0x01;
    tamperedTag[authTagKey] = toBase64(tamperedTag[authTagKey]);
    await assert.rejects(
      async () => unwrapItemKey(tamperedTag, colKey),
      (err) => err instanceof CryptoError && err.code === 'DECRYPT_FAILED',
      '1-bit flip in Auth Tag must cause DECRYPT_FAILED'
    );
  });
});
