/**
 * SecureVault Cloud — frontend <-> backend integration test
 *
 * Boots the local API Gateway + Cognito simulator and drives it through the frontend's own
 * services (auth adapter in "local" mode, api.js, ClientCrypto), covering UC-1 .. UC-13:
 *
 *   sign-up -> confirm -> sign-in (Authentication Key as Cognito password)
 *   -> first sign-in creates the profile: random Vault Key wrapped by the KEK
 *   -> items encrypted with the Vault Key, TOTP, sharing, history, reset, logs, monitoring
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startLocalServer } from '../backend/local/local-runner.js';
import { generateTotp } from '../backend/local/local-auth.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

describe('Frontend services against the local API Gateway + Cognito simulator (UC-1 .. UC-13)', () => {
  const stamp = Date.now();
  const alice = { username: `alice_${stamp}`, email: `alice_${stamp}@example.com`, fullName: 'Alice Frontend', masterPassword: 'MasterPassword-2026-Alice!' };
  const bob = { username: `bob_${stamp}`, email: `bob_${stamp}@example.com`, fullName: 'Bob Recipient', masterPassword: 'MasterPassword-2026-Bob!' };

  let server;
  let api;
  let setAuthToken;
  let ClientCrypto;
  let auth;

  const sessions = {};
  let vaultId;
  let itemId;
  let totpSecret;

  async function signUpAndOpenVault(user) {
    const salt = (await api.auth.getSalt(user.username)).data.salt;
    const { kek, authHash } = await ClientCrypto.deriveKeys(user.masterPassword, salt);
    const password = ClientCrypto.toCognitoPassword(authHash);

    const signUp = await auth.signUp({ username: user.username, email: user.email, name: user.fullName, password });
    assert.equal(signUp.needsConfirmation, true);
    await auth.confirmSignUp({ username: user.username, code: signUp.devCode });

    assert.deepEqual(await auth.signIn({ username: user.email, password }), { status: 'DONE' });
    const token = await auth.getIdToken();
    setAuthToken(token);

    await assert.rejects(() => api.users.me(), (err) => err.code === 'PROFILE_NOT_FOUND');
    const vaultKey = ClientCrypto.createVaultKey();
    const keyPair = await ClientCrypto.createKeyPair();
    const profile = (
      await api.users.createMe({
        full_name: user.fullName,
        kdf_salt: salt,
        public_key: keyPair.publicKey,
        encrypted_private_key: await ClientCrypto.protectPrivateKey(keyPair.privateKey, vaultKey),
        encrypted_vault_key: await ClientCrypto.wrapVaultKey(vaultKey, kek),
      })
    ).data;
    return { salt, kek, password, token, vaultKey, keyPair, profile };
  }

  before(async () => {
    process.env.LOCAL_ADMIN_USERS = alice.username;
    server = await startLocalServer(0);
    const base = `http://127.0.0.1:${server.port}`;
    process.env.VITE_AUTH_MODE = 'local';
    process.env.VITE_API_URL = `${base}/api/v1`;
    process.env.VITE_LOCAL_AUTH_URL = `${base}/local-auth`;

    // Imported after the env vars are set: config.js reads them at module load.
    ({ api, setAuthToken } = await import('../frontend/src/services/api.js'));
    ClientCrypto = (await import('../frontend/src/services/crypto.js')).default;
    auth = await (await import('../frontend/src/services/auth/index.js')).getAuth();
  });

  after(async () => {
    setAuthToken?.(null);
    await server?.close();
  });

  test('UC-1: sign-up, e-mail confirmation and first sign-in create the zero-knowledge profile', async () => {
    sessions.alice = await signUpAndOpenVault(alice);
    assert.equal(sessions.alice.profile.username, alice.username);
    assert.equal(sessions.alice.profile.role, 'admin'); // from the Cognito "admin" group
    sessions.bob = await signUpAndOpenVault(bob);
    assert.equal(sessions.bob.profile.role, 'user');

    // The server never receives the master password, KEK or Vault Key
    const raw = JSON.stringify(sessions.alice.profile);
    assert.ok(!raw.includes(alice.masterPassword));
    assert.ok(!raw.includes(ClientCrypto.toBase64(sessions.alice.vaultKey)));
  });

  test('UC-2: sign-in with the master password re-derives the KEK and unwraps the Vault Key', async () => {
    const salt = (await api.auth.getSalt(alice.email)).data.salt;
    assert.equal(salt, sessions.alice.salt);
    const { kek, authHash } = await ClientCrypto.deriveKeys(alice.masterPassword, salt);
    assert.equal((await auth.signIn({ username: alice.username, password: ClientCrypto.toCognitoPassword(authHash) })).status, 'DONE');
    setAuthToken(await auth.getIdToken());

    const me = (await api.users.me()).data;
    const vaultKey = await ClientCrypto.unwrapVaultKey(me.encrypted_vault_key, kek);
    assert.deepEqual(vaultKey, sessions.alice.vaultKey);
    await api.auth.recordSession();

    // Wrong master password: Cognito rejects the derived password
    const wrong = await ClientCrypto.deriveKeys('not-the-password', salt);
    await assert.rejects(
      () => auth.signIn({ username: alice.username, password: ClientCrypto.toCognitoPassword(wrong.authHash) }),
      (err) => err.name === 'NotAuthorizedException'
    );
  });

  test('UC-3: TOTP enrolment and TOTP challenge on the next sign-in', async () => {
    assert.equal((await auth.signIn({ username: alice.username, password: sessions.alice.password })).status, 'DONE');
    const setup = await auth.setupTotp({ accountName: alice.email });
    totpSecret = setup.sharedSecret;
    assert.match(setup.otpauthUrl, /^otpauth:\/\/totp\//);
    await auth.verifyTotp({ code: generateTotp(totpSecret) });
    setAuthToken(await auth.getIdToken());
    assert.equal((await api.users.updateMe({ mfa_enabled: true })).data.mfa_enabled, true);

    await auth.signOut();
    assert.equal((await auth.signIn({ username: alice.username, password: sessions.alice.password })).status, 'TOTP_REQUIRED');
    assert.equal((await auth.confirmTotp({ code: generateTotp(totpSecret) })).status, 'DONE');
    sessions.alice.token = await auth.getIdToken();
    setAuthToken(sessions.alice.token);
  });

  test('UC-4: add an item encrypted with the Vault Key', async () => {
    vaultId = (await api.vault.listVaults()).data[0].vault_id;
    const secret = { username: 'alice_admin@corp.internal', password: 'ProdSuperPassword_8899!', url: 'https://vault.corp.internal', notes: 'Root DB' };
    const created = await api.vault.createItem(
      { item_type: 'login', encrypted_data: await ClientCrypto.encryptItem(secret, sessions.alice.vaultKey), metadata: { title: 'Database Cluster Admin' } },
      vaultId
    );
    assert.equal(created.data.version, 1);
    itemId = created.data.item_id;

    const fetched = await api.vault.getItem(itemId, vaultId);
    assert.deepEqual(await ClientCrypto.decryptItem(fetched.data.encrypted_data, sessions.alice.vaultKey), secret);
  });

  test('UC-5 & UC-11: update with optimistic version, history and rollback', async () => {
    const updated = { username: 'alice_admin@corp.internal', password: 'Rotated_2026!', url: 'https://vault.corp.internal/v2', notes: 'rotated' };
    const res = await api.vault.updateItem(
      itemId,
      { encrypted_data: await ClientCrypto.encryptItem(updated, sessions.alice.vaultKey), metadata: { title: 'Database Cluster Admin' }, version: 1 },
      vaultId
    );
    assert.equal(res.data.version, 2);

    const history = await api.history.getHistory(itemId, vaultId);
    assert.equal((await ClientCrypto.decryptItem(history.history[0].encrypted_data, sessions.alice.vaultKey)).password, 'ProdSuperPassword_8899!');
    assert.equal((await api.history.rollback(itemId, 1, vaultId)).data.version, 3);
  });

  test('UC-10: share with RSA-OAEP key wrapping, recipient listing and revoke', async () => {
    const lookup = await api.sharing.lookupUser(bob.email);
    assert.equal(lookup.data.public_key, sessions.bob.keyPair.publicKey);

    const wrapped = await ClientCrypto.wrapItemKey(ClientCrypto.generateItemKey(), lookup.data.public_key);
    const share = await api.sharing.shareItem(itemId, { recipient_email: bob.email, permission_level: 'modify', encrypted_key_for_recipient: wrapped }, vaultId);
    assert.equal(share.status, 'success');

    setAuthToken(sessions.bob.token);
    const shared = await api.sharing.listSharedItems();
    assert.ok(shared.data.some((s) => s.item_id === itemId));

    setAuthToken(sessions.alice.token);
    assert.equal((await api.sharing.revokeShare(itemId, lookup.data.user_id, vaultId)).status, 'success');
  });

  test('UC-6: delete item', async () => {
    assert.equal((await api.vault.deleteItem(itemId, vaultId)).status, 'success');
    await assert.rejects(() => api.vault.getItem(itemId, vaultId), (err) => err.status === 404);
  });

  test('UC-7: forgotten master password -> Cognito code -> new key material', async () => {
    const reset = await auth.forgotPassword({ username: bob.email });
    assert.ok(reset.devCode);

    const newMaster = 'BrandNewMasterPassword_2026!';
    const { kek, authHash } = await ClientCrypto.deriveKeys(newMaster, sessions.bob.salt);
    const newPassword = ClientCrypto.toCognitoPassword(authHash);
    await auth.confirmForgotPassword({ username: bob.email, code: reset.devCode, newPassword });

    await assert.rejects(() => auth.signIn({ username: bob.username, password: sessions.bob.password }));
    assert.equal((await auth.signIn({ username: bob.username, password: newPassword })).status, 'DONE');
    setAuthToken(await auth.getIdToken());

    const vaultKey = ClientCrypto.createVaultKey();
    const keyPair = await ClientCrypto.createKeyPair();
    const updated = await api.users.updateKeys({
      reason: 'reset',
      kdf_salt: sessions.bob.salt,
      public_key: keyPair.publicKey,
      encrypted_private_key: await ClientCrypto.protectPrivateKey(keyPair.privateKey, vaultKey),
      encrypted_vault_key: await ClientCrypto.wrapVaultKey(vaultKey, kek),
    });
    assert.deepEqual(await ClientCrypto.unwrapVaultKey(updated.data.encrypted_vault_key, kek), vaultKey);
  });

  test('UC-8, UC-9, UC-12, UC-13: security alerts, audit log, activity log, monitoring', async () => {
    setAuthToken(sessions.alice.token);
    assert.equal((await api.logs.simulateSecurityEvent({ severity: 'CRITICAL', type: 'GuardDuty:PortScanning', description: 'scan' })).status, 'success');
    assert.ok((await api.logs.getSecurityNotifications()).data.length >= 1);
    assert.ok((await api.logs.getAdminAuditLogs({ limit: 10 })).data.length >= 1);
    assert.ok((await api.logs.exportAuditLogsCsv()).includes('audit_id'));
    assert.ok((await api.logs.getUserActivityLogs({ limit: 10 })).data.length >= 1);
    const metrics = await api.monitoring.getMetrics();
    assert.equal((metrics.metrics || metrics.data).system_health, 'HEALTHY');
    assert.equal((await api.monitoring.getHealth()).status, 'healthy');

    // A regular user is forbidden from admin endpoints
    setAuthToken(sessions.bob.token);
    await assert.rejects(() => api.logs.getAdminAuditLogs(), (err) => err.status === 403);
  });

  test('API Gateway authorizer emulation: no token -> 401', async () => {
    setAuthToken(null);
    await auth.signOut();
    await assert.rejects(() => api.vault.listVaults(), (err) => err.status === 401);
  });
});
