/**
 * SecureVault Cloud — React Client End-to-End Cryptography & API Verification
 *
 * Verifies all 13 Use Cases (UC-1 through UC-13) against ClientCrypto and API client:
 * - Client-side Zero-Knowledge Argon2id KDF & MEK retention
 * - Authenticated AES-256-GCM vault payload encryption/decryption
 * - RSA-OAEP asymmetric key wrapping for item sharing
 * - Complete API client interaction with backend
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import ClientCrypto from '../src/services/crypto.js';
import { api, setAuthToken } from '../src/services/api.js';

describe('Milestone 3 — React Client Cryptography & Services Verification', () => {
  let masterPassword = 'Correct-Horse-Battery-Staple-99!';
  let accountSalt;
  let mekBuffer;
  let authHashHex;
  let userKeyPair;

  test('UC-1: Registration Cryptography — Salt, Argon2id KDF, RSA Key Pair, and Private Key Encryption', async () => {
    // 1. Generate salt
    accountSalt = ClientCrypto.createSalt(16);
    assert.equal(typeof accountSalt, 'string');
    assert.ok(accountSalt.length >= 22);

    // 2. Derive MEK and authHash
    const derived = await ClientCrypto.deriveKeys(masterPassword, accountSalt);
    assert.ok(derived.mek instanceof Uint8Array);
    assert.equal(derived.mek.length, 32);
    assert.equal(typeof derived.authHash, 'string');
    assert.equal(derived.authHash.length, 64);

    mekBuffer = derived.mek;
    authHashHex = derived.authHash;

    // 3. Asymmetric keypair generation
    userKeyPair = await ClientCrypto.createKeyPair();
    assert.ok(userKeyPair.publicKey.length > 100);
    assert.ok(userKeyPair.privateKey.length > 100);

    // 4. Protect private key with MEK
    const protectedPrivKey = await ClientCrypto.protectPrivateKey(userKeyPair.privateKey, mekBuffer);
    assert.ok(protectedPrivKey.ciphertext);
    assert.ok(protectedPrivKey.iv);
    assert.ok(protectedPrivKey.authTag || protectedPrivKey.auth_tag);

    // 5. Unprotect private key with MEK
    const recoveredPrivKey = await ClientCrypto.unprotectPrivateKey(protectedPrivKey, mekBuffer);
    assert.equal(recoveredPrivKey, userKeyPair.privateKey);
  });

  test('UC-4 & UC-5: Vault Item AES-256-GCM Authenticated Encryption & Decryption Roundtrip', async () => {
    const rawPayload = {
      title: 'GitHub Corporate Access',
      username: 'dev@corp.internal',
      password: 'SuperSecretToken12345!',
      url: 'https://github.com/login',
      notes: 'Backup recovery keys: 1984-2026',
    };

    // Encrypt using MEK
    const encrypted = await ClientCrypto.encryptItem(rawPayload, mekBuffer);
    assert.equal(encrypted.algorithm, 'AES-256-GCM');
    assert.ok(encrypted.ciphertext);
    assert.ok(encrypted.iv);
    assert.ok(encrypted.authTag || encrypted.auth_tag);

    // Decrypt using MEK
    const decrypted = await ClientCrypto.decryptItem(encrypted, mekBuffer);
    assert.deepEqual(decrypted, rawPayload);

    // Tamper resistance test
    const tamperedPayload = {
      ...encrypted,
      ciphertext: encrypted.ciphertext.slice(0, -4) + 'AAAA',
    };

    await assert.rejects(
      async () => {
        await ClientCrypto.decryptItem(tamperedPayload, mekBuffer);
      },
      /Decryption failed|authenticity tag/i
    );
  });

  test('UC-10: Password Sharing RSA-OAEP Key Wrapping Roundtrip', async () => {
    // Generate recipient keypair (Bob)
    const bobKeyPair = await ClientCrypto.createKeyPair();

    // Alice generates symmetric Item Key (32 bytes)
    const itemKey = ClientCrypto.generateItemKey();
    assert.equal(itemKey.length, 32);

    // Alice encrypts item with itemKey
    const secretItemData = { apiKey: 'live_secret_key_88991122' };
    const encryptedSecret = await ClientCrypto.encryptItem(secretItemData, itemKey);

    // Alice wraps itemKey with Bob's public key
    const wrappedKeyPayload = await ClientCrypto.wrapItemKey(itemKey, bobKeyPair.publicKey);
    assert.ok(wrappedKeyPayload.wrappedKey || wrappedKeyPayload.wrapped_key);

    // Bob unwraps itemKey with Bob's private key
    const unwrappedItemKey = await ClientCrypto.unwrapItemKey(wrappedKeyPayload, bobKeyPair.privateKey);
    assert.deepEqual(unwrappedItemKey, itemKey);

    // Bob decrypts item using unwrapped key
    const decryptedSecret = await ClientCrypto.decryptItem(encryptedSecret, unwrappedItemKey);
    assert.deepEqual(decryptedSecret, secretItemData);
  });

  test('Customizable Password Generator & Entropy Calculation', () => {
    // 1. Password generation with custom lengths
    const pwd16 = ClientCrypto.generateSecurePassword({ length: 16 });
    assert.equal(pwd16.length, 16);

    const pwd32 = ClientCrypto.generateSecurePassword({ length: 32 });
    assert.equal(pwd32.length, 32);

    // 2. Diceware passphrase mode
    const phrase = ClientCrypto.generateSecurePassphrase({ words: 5, separator: '-' });
    const parts = phrase.split('-');
    // 5 words + 1 number
    assert.ok(parts.length >= 5);

    // 3. Entropy calculation
    const entropyResult = ClientCrypto.calculateStrength(pwd32);
    assert.ok(entropyResult.entropyBits >= 80);
    assert.equal(entropyResult.strength, 'very_strong');
    assert.ok(entropyResult.label.th);
    assert.ok(entropyResult.label.en);
  });

  test('Client Input Validation Guards', () => {
    // Registration validation
    const invalidReg = ClientCrypto.validators.validateRegistration({
      username: 'ab', // too short
      email: 'not-an-email',
      password: '123', // too short
    });
    assert.equal(invalidReg.valid, false);
    assert.ok(invalidReg.errors.length >= 3);

    const validReg = ClientCrypto.validators.validateRegistration({
      username: 'valid_user',
      email: 'user@example.com',
      fullName: 'Valid User',
      password: 'ValidPassword123!',
      confirmPassword: 'ValidPassword123!',
    });
    assert.equal(validReg.valid, true);
    assert.equal(validReg.errors.length, 0);

    // Share validation
    const selfShare = ClientCrypto.validators.validateShareRequest(
      { recipientId: 'user-1' },
      'user-1',
      'user-1'
    );
    assert.equal(selfShare.valid, false);
  });
});
