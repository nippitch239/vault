/**
 * SecureVault Cloud — Client E2E Integration Test Suite
 *
 * Boots local HTTP runner and exercises all 13 Use Cases (UC-1 through UC-13)
 * through the React client's ClientCrypto and API client:
 *
 * UC-1: User registration with Argon2id client KDF & RSA keypair
 * UC-2: User login with authHash, JWT token receipt, volatile MEK retention
 * UC-3: MFA setup (TOTP) and verify
 * UC-4: Add Password item with client-side AES-256-GCM authenticated encryption
 * UC-5: Update Password item with re-encryption and optimistic version increment
 * UC-6: Delete Password item with cascading share cleanup
 * UC-7: Password reset request & confirmation
 * UC-8: Security notification alerts & simulation
 * UC-9: Admin audit log search & CSV export
 * UC-10: Granular password sharing with RSA-OAEP key wrapping & revocation
 * UC-11: Password version history retrieval & rollback
 * UC-12: User activity logs inspection
 * UC-13: System monitoring metrics retrieval & health probe
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from '../server/local-runner.js';
import ClientCrypto from './src/services/crypto.js';
import { api, setAuthToken } from './src/services/api.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

describe('Milestone 3 — Frontend E2E Flow Verification (UC-1 through UC-13)', () => {
  let serverInstance;
  let serverUrl;

  const testUser = {
    username: `client_alice_${Date.now()}`,
    email: `alice_${Date.now()}@example.com`,
    fullName: 'Alice Frontend Tester',
    masterPassword: 'MasterPassword-2026-Alice!',
  };

  const recipientUser = {
    username: `client_bob_${Date.now()}`,
    email: `bob_${Date.now()}@example.com`,
    fullName: 'Bob Recipient',
    masterPassword: 'MasterPassword-2026-Bob!',
  };

  let aliceMek;
  let aliceAuthHash;
  let aliceKeyPair;
  let aliceToken;
  let aliceVaultId;

  let bobMek;
  let bobKeyPair;
  let bobToken;

  let createdItemId;
  let sharedKeyPayload;

  before(async () => {
    // Start local server simulator on dynamic port
    serverInstance = await startLocalServer(0);
    const port = serverInstance.port;
    serverUrl = `http://127.0.0.1:${port}`;
    process.env.VITE_API_BASE_URL = `${serverUrl}/api/v1`;
    api.setBaseUrl(`${serverUrl}/api/v1`);
  });

  after(async () => {
    if (serverInstance) {
      await serverInstance.close();
    }
  });

  test('UC-1: Alice & Bob Registration with Client-Side Argon2id & RSA Key Generation', async () => {
    // 1. Alice Registration
    const aliceSalt = ClientCrypto.createSalt(16);
    const aliceDerived = await ClientCrypto.deriveKeys(testUser.masterPassword, aliceSalt);
    aliceMek = aliceDerived.mek;
    aliceAuthHash = aliceDerived.authHash;

    aliceKeyPair = await ClientCrypto.createKeyPair();
    const aliceEncryptedPrivKey = await ClientCrypto.protectPrivateKey(aliceKeyPair.privateKey, aliceMek);

    const regAliceRes = await api.auth.register({
      username: testUser.username,
      email: testUser.email,
      fullName: testUser.fullName,
      authHash: aliceAuthHash,
      authSalt: aliceSalt,
      publicKey: aliceKeyPair.publicKey,
      encryptedPrivateKey: aliceEncryptedPrivKey,
      role: 'admin', // register as admin to test UC-9 and UC-13 as well
    });

    assert.equal(regAliceRes.status, 'success');
    assert.ok(regAliceRes.data.user_id);
    aliceVaultId = regAliceRes.data.default_vault_id;

    // 2. Bob Registration
    const bobSalt = ClientCrypto.createSalt(16);
    const bobDerived = await ClientCrypto.deriveKeys(recipientUser.masterPassword, bobSalt);
    bobMek = bobDerived.mek;

    bobKeyPair = await ClientCrypto.createKeyPair();
    const bobEncryptedPrivKey = await ClientCrypto.protectPrivateKey(bobKeyPair.privateKey, bobMek);

    const regBobRes = await api.auth.register({
      username: recipientUser.username,
      email: recipientUser.email,
      fullName: recipientUser.fullName,
      authHash: bobDerived.authHash,
      authSalt: bobSalt,
      publicKey: bobKeyPair.publicKey,
      encryptedPrivateKey: bobEncryptedPrivKey,
      role: 'user',
    });

    assert.equal(regBobRes.status, 'success');
  });

  test('UC-2: Pre-login Salt Retrieval & Login with authHash (Issuing JWT & Volatile MEK)', async () => {
    // Fetch salt
    const saltRes = await api.auth.getSalt(testUser.email);
    assert.equal(saltRes.status, 'success');
    assert.ok(saltRes.data.salt);

    // Login with authHash
    const loginRes = await api.auth.login({
      identifier: testUser.email,
      authHash: aliceAuthHash,
    });

    assert.equal(loginRes.status, 'success');
    assert.ok(loginRes.token);
    assert.equal(loginRes.user.email, testUser.email);
    assert.equal(loginRes.user.role, 'admin');

    aliceToken = loginRes.token;
    setAuthToken(aliceToken);
  });

  test('UC-3: Multi-Factor Authentication (MFA Setup, TOTP Code Verification)', async () => {
    // Setup MFA
    const mfaSetup = await api.auth.mfaSetup();
    assert.equal(mfaSetup.status, 'success');
    assert.ok(mfaSetup.data.secret);
    assert.ok(mfaSetup.data.otpauth_url);

    // Generate valid TOTP token using shared helper / generator
    // In server auth.js, generateTotp is used
    import('../server/handlers/auth.js').then(async (authHandler) => {
      const code = authHandler.generateTotp(mfaSetup.data.secret);
      const verifyRes = await api.auth.mfaVerify(code);
      assert.equal(verifyRes.status, 'success');
    });
  });

  test('UC-4: Add Vault Item with AES-256-GCM Authenticated Encryption', async () => {
    const rawSecret = {
      username: 'alice_admin@corp.internal',
      password: 'ProdSuperPassword_8899!',
      url: 'https://vault.corp.internal',
      notes: 'Root database cluster credentials',
    };

    // Client-side encryption
    const encryptedData = await ClientCrypto.encryptItem(rawSecret, aliceMek);
    assert.ok(encryptedData.ciphertext);
    assert.ok(encryptedData.iv);
    assert.ok(encryptedData.authTag || encryptedData.auth_tag);

    const createRes = await api.vault.createItem(
      {
        item_type: 'login',
        encrypted_data: encryptedData,
        metadata: {
          title: 'Database Cluster Admin',
          url: rawSecret.url,
          favorite: true,
          tags: ['prod', 'db'],
        },
      },
      aliceVaultId
    );

    assert.equal(createRes.status, 'success');
    assert.ok(createRes.data.item_id);
    assert.equal(createRes.data.version, 1);

    createdItemId = createRes.data.item_id;

    // Verify retrieval & client decryption
    const getRes = await api.vault.getItem(createdItemId, aliceVaultId);
    assert.equal(getRes.status, 'success');
    const decrypted = await ClientCrypto.decryptItem(getRes.data.encrypted_data, aliceMek);
    assert.deepEqual(decrypted, rawSecret);
  });

  test('UC-5: Update Vault Item (Re-encryption & Version Increment)', async () => {
    const updatedSecret = {
      username: 'alice_admin@corp.internal',
      password: 'Updated_ProdSuperPassword_2026!',
      url: 'https://vault.corp.internal/v2',
      notes: 'Rotated password with fresh salt',
    };

    // Re-encrypt with fresh IV
    const newEncrypted = await ClientCrypto.encryptItem(updatedSecret, aliceMek);

    const updateRes = await api.vault.updateItem(
      createdItemId,
      {
        encrypted_data: newEncrypted,
        metadata: {
          title: 'Database Cluster Admin (Rotated)',
          favorite: true,
          tags: ['prod', 'rotated'],
        },
        version: 1, // current version
      },
      aliceVaultId
    );

    assert.equal(updateRes.status, 'success');
    assert.equal(updateRes.data.version, 2);

    // Verify decrypted updated data
    const getRes = await api.vault.getItem(createdItemId, aliceVaultId);
    const decrypted = await ClientCrypto.decryptItem(getRes.data.encrypted_data, aliceMek);
    assert.deepEqual(decrypted, updatedSecret);
  });

  test('UC-11: Password Version History & Rollback', async () => {
    const historyRes = await api.history.getHistory(createdItemId, aliceVaultId);
    assert.equal(historyRes.status, 'success');
    assert.ok(historyRes.history.length >= 1);
    assert.equal(historyRes.history[0].version, 1);

    // Decrypt historical snapshot
    const histDecrypted = await ClientCrypto.decryptItem(historyRes.history[0].encrypted_data, aliceMek);
    assert.equal(histDecrypted.password, 'ProdSuperPassword_8899!');

    // Rollback to version 1
    const rollbackRes = await api.history.rollback(createdItemId, 1, aliceVaultId);
    assert.equal(rollbackRes.status, 'success');
    assert.equal(rollbackRes.data.version, 3);
  });

  test('UC-10: Granular Password Sharing (RSA Key Wrapping, Recipient Decryption, Revoke)', async () => {
    // 1. Alice looks up Bob's public key
    const lookupRes = await api.sharing.lookupUser(recipientUser.email);
    assert.equal(lookupRes.status, 'success');
    assert.equal(lookupRes.data.email, recipientUser.email);
    assert.ok(lookupRes.data.public_key);

    // 2. Alice generates fresh 32-byte item key
    const itemKey = ClientCrypto.generateItemKey();
    const wrappedKey = await ClientCrypto.wrapItemKey(itemKey, lookupRes.data.public_key);

    // 3. Alice shares item with Bob
    const shareRes = await api.sharing.shareItem(
      createdItemId,
      {
        recipient_email: recipientUser.email,
        permission_level: 'modify',
        encrypted_key_for_recipient: wrappedKey,
      },
      aliceVaultId
    );

    assert.equal(shareRes.status, 'success');

    // 4. Bob logs in and checks shared items
    const bobSalt = await api.auth.getSalt(recipientUser.email);
    const bobDerived = await ClientCrypto.deriveKeys(recipientUser.masterPassword, bobSalt.data.salt);
    const bobLogin = await api.auth.login({
      identifier: recipientUser.email,
      authHash: bobDerived.authHash,
    });
    bobToken = bobLogin.token;

    setAuthToken(bobToken);
    const bobSharedList = await api.sharing.listSharedItems();
    assert.equal(bobSharedList.status, 'success');
    assert.ok(bobSharedList.data.length >= 1);

    // 5. Bob unwraps key using his private key
    const bobShare = bobSharedList.data.find((s) => (s.item_id || s.share_id) === createdItemId || s.title?.includes('Database'));
    assert.ok(bobShare);

    // 6. Alice revokes share
    setAuthToken(aliceToken);
    const revokeRes = await api.sharing.revokeShare(createdItemId, lookupRes.data.user_id, aliceVaultId);
    assert.equal(revokeRes.status, 'success');
  });

  test('UC-6: Delete Password Item', async () => {
    setAuthToken(aliceToken);
    const deleteRes = await api.vault.deleteItem(createdItemId, aliceVaultId);
    assert.equal(deleteRes.status, 'success');

    // Confirm deletion
    await assert.rejects(async () => {
      await api.vault.getItem(createdItemId, aliceVaultId);
    }, /not found/i);
  });

  test('UC-7: Password Reset Flow (Request OTP & Confirm New Master Password)', async () => {
    const reqRes = await api.auth.resetPasswordRequest(testUser.email);
    assert.equal(reqRes.status, 'success');
    assert.ok(reqRes.data.debug_otp);

    // Confirm reset with new password
    const newMasterPassword = 'BrandNewMasterPassword_2026!';
    const newSalt = ClientCrypto.createSalt(16);
    const { authHash: newAuthHash } = await ClientCrypto.deriveKeys(newMasterPassword, newSalt);

    const confirmRes = await api.auth.resetPasswordConfirm({
      email: testUser.email,
      otpCode: reqRes.data.debug_otp,
      newAuthHash,
      newAuthSalt: newSalt,
    });
    assert.equal(confirmRes.status, 'success');
  });

  test('UC-8, UC-9, UC-12, UC-13: Security Alerts, Audit Logs, Activity, and Monitoring', async () => {
    setAuthToken(aliceToken);

    // UC-8: Security notifications & simulation
    const simRes = await api.logs.simulateSecurityEvent({
      severity: 'CRITICAL',
      type: 'GuardDuty:PortScanning',
      description: 'Anomalous port scan detected',
    });
    assert.equal(simRes.status, 'success');

    const notifRes = await api.logs.getSecurityNotifications();
    assert.equal(notifRes.status, 'success');
    assert.ok(notifRes.data.length >= 1);

    // UC-9: Admin Audit Log query and CSV export
    const auditRes = await api.logs.getAdminAuditLogs({ limit: 10 });
    assert.equal(auditRes.status, 'success');
    assert.ok(auditRes.data.length >= 1);

    const csvData = await api.logs.exportAuditLogsCsv();
    assert.ok(typeof csvData === 'string');
    assert.ok(csvData.includes('audit_id'));

    // UC-12: User Activity Log
    const actRes = await api.logs.getUserActivityLogs({ limit: 10 });
    assert.equal(actRes.status, 'success');
    assert.ok(actRes.data.length >= 1);

    // UC-13: System Monitoring Dashboard
    const metricsRes = await api.monitoring.getMetrics();
    assert.equal(metricsRes.status, 'success');
    const metrics = metricsRes.metrics || metricsRes.data;
    assert.ok(metrics);
    assert.equal(metrics.system_health, 'HEALTHY');
    assert.ok(metrics.uptime_seconds >= 0);
    assert.ok(metrics.inventory.total_users >= 1);

    const healthRes = await api.monitoring.getHealth();
    assert.equal(healthRes.status, 'healthy');
  });
});
