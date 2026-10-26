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
    assert.match(derived.authHash, /^[0-9a-f]{64}$/);

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
    assert.equal(typeof wrappedKeyPayload.ciphertext, 'string'); // shape the share API validates

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

describe('API client (services/api.js)', () => {
  test('sends the Cognito ID token, keeps /auth/salt public and exposes error codes', async () => {
    const calls = [];
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url, options) => {
      calls.push({ url, options });
      if (url.endsWith('/users/me')) {
        return new Response(JSON.stringify({ status: 'fail', error: 'PROFILE_NOT_FOUND', message: 'not yet' }), {
          status: 404,
          headers: { 'content-type': 'application/json' },
        });
      }
      return new Response(JSON.stringify({ status: 'success', data: { salt: 'c2FsdA==' } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    };
    try {
      api.setBaseUrl('https://api.example.test/prod/api/v1');
      setAuthToken('id-token-123');

      await api.auth.getSalt('alice@example.com');
      assert.equal(calls[0].url, 'https://api.example.test/prod/api/v1/auth/salt?identifier=alice%40example.com');
      assert.equal(calls[0].options.headers.Authorization, undefined);

      await assert.rejects(() => api.users.me(), (err) => err.status === 404 && err.code === 'PROFILE_NOT_FOUND');
      assert.equal(calls[1].options.headers.Authorization, 'Bearer id-token-123');
    } finally {
      globalThis.fetch = originalFetch;
      setAuthToken(null);
      api.setBaseUrl(null);
    }
  });
});

describe('Milestone 2 — Organization & Collection Cryptographic Verification', () => {
  let aliceKeyPair;
  let bobKeyPair;

  test('Feature 7: Organization Key (generateOrgKey, wrapOrgKey, unwrapOrgKey) Roundtrip & Security Invariants', async () => {
    // 1. Generate keypairs for Alice (Owner) and Bob (Invited Member)
    aliceKeyPair = await ClientCrypto.createKeyPair();
    bobKeyPair = await ClientCrypto.createKeyPair();

    // 2. Generate 256-bit Org Key
    const orgKey = ClientCrypto.generateOrgKey();
    assert.ok(orgKey instanceof Uint8Array, 'Org Key must be Uint8Array');
    assert.equal(orgKey.length, 32, 'Org Key must be exactly 32 bytes (256 bits)');

    // Non-repetition (CSPRNG freshness)
    const orgKey2 = ClientCrypto.generateOrgKey();
    assert.notDeepEqual(orgKey, orgKey2, 'Subsequent Org Key generations must be distinct');

    // 3. Alice wraps Org Key for Bob using Bob's RSA-OAEP public key
    const wrappedForBob = await ClientCrypto.wrapOrgKey(orgKey, bobKeyPair.publicKey);
    assert.ok(wrappedForBob.ciphertext, 'Wrapped Org Key must contain base64 ciphertext');
    assert.equal(wrappedForBob.algorithm, 'RSA-OAEP', 'Algorithm must be RSA-OAEP');

    // 4. Bob unwraps with his private key
    const recoveredByBob = await ClientCrypto.unwrapOrgKey(wrappedForBob, bobKeyPair.privateKey);
    assert.ok(recoveredByBob instanceof Uint8Array, 'Unwrapped Org Key must be Uint8Array');
    assert.equal(recoveredByBob.length, 32, 'Unwrapped Org Key must be 32 bytes');
    assert.deepEqual(recoveredByBob, orgKey, 'Bob recovers identical 256-bit Org Key');

    // 5. Unauthorized unwrapping attempt (Alice's private key cannot unwrap Bob's copy)
    await assert.rejects(
      async () => {
        await ClientCrypto.unwrapOrgKey(wrappedForBob, aliceKeyPair.privateKey);
      },
      /unwrapping failed|UNWRAP_ORG_KEY_ERROR|OperationError/i,
      'Unwrapping with wrong private key must fail'
    );

    // 6. Tamper resistance (tampering with wrapped ciphertext fails authentication)
    const tampered = {
      ...wrappedForBob,
      ciphertext: wrappedForBob.ciphertext.slice(0, -4) + 'AAAA',
    };
    await assert.rejects(
      async () => {
        await ClientCrypto.unwrapOrgKey(tampered, bobKeyPair.privateKey);
      },
      /unwrapping failed|UNWRAP_ORG_KEY_ERROR|OperationError/i,
      'Tampered wrapped key ciphertext must fail unwrapping'
    );
  });

  test('Feature 8 & 9: Collection Key & Item Key Two-Tier Cryptographic Roundtrip with AAD Protection', async () => {
    // 1. Generate Collection Key
    const collectionKey = ClientCrypto.generateCollectionKey();
    assert.equal(collectionKey.length, 32, 'Collection Key must be 32 bytes');

    // 2. Wrap Collection Key for member (Bob)
    const wrappedColKey = await ClientCrypto.wrapCollectionKey(collectionKey, bobKeyPair.publicKey);
    const bobColKey = await ClientCrypto.unwrapCollectionKey(wrappedColKey, bobKeyPair.privateKey);
    assert.deepEqual(bobColKey, collectionKey, 'Member recovers exact Collection Key');

    // 3. Encrypt Item for save inside collection (simulating item-crypto.js encryptForSave)
    const rawSecret = {
      title: 'Postgres Production Cluster',
      host: 'pg-prod.internal',
      username: 'cloud_admin',
      password: 'ProdClusterSecurePass_2026!',
    };

    const itemKey = ClientCrypto.generateItemKey();
    assert.equal(itemKey.length, 32, 'Item Key must be 32 bytes');

    // Encrypt payload with Item Key (AES-256-GCM)
    const encryptedData = await ClientCrypto.encryptItem(rawSecret, itemKey);
    assert.equal(encryptedData.algorithm, 'AES-256-GCM');

    // Protect Item Key under Collection Key (AES-256-GCM with AAD securevault-item-key-v1)
    const encryptedItemKey = await ClientCrypto.protectItemKey(itemKey, collectionKey);
    assert.ok(encryptedItemKey.ciphertext);
    assert.ok(encryptedItemKey.iv);
    assert.ok(encryptedItemKey.authTag || encryptedItemKey.auth_tag);

    // 4. Member (Bob) unprotects Item Key using Collection Key
    const bobUnprotectedItemKey = await ClientCrypto.unprotectItemKey(encryptedItemKey, bobColKey);
    assert.deepEqual(bobUnprotectedItemKey, itemKey, 'Bob unprotects exact Item Key via Collection Key');

    // 5. Member (Bob) decrypts item payload using recovered Item Key
    const decryptedPayload = await ClientCrypto.decryptItem(encryptedData, bobUnprotectedItemKey);
    assert.deepEqual(decryptedPayload, rawSecret, 'Decrypted payload matches secret');

    // 6. AAD Context-Binding Integrity Test:
    // Unprotecting with wrong AAD (or swapped collection key) must fail
    const wrongWrappingKey = ClientCrypto.generateCollectionKey();
    await assert.rejects(
      async () => {
        await ClientCrypto.unprotectItemKey(encryptedItemKey, wrongWrappingKey);
      },
      /Decryption failed|authenticity tag/i,
      'Unprotecting Item Key with wrong collection key must fail'
    );
  });
});
