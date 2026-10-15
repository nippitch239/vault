/**
 * SecureVault Cloud — frontend <-> backend integration test
 *
 * Boots the local API Gateway + Cognito simulator and drives it through the frontend's own
 * services (auth adapter in "local" mode, api.js, ClientCrypto), covering UC-1 .. UC-13:
 *
 *   sign-up -> confirm -> sign-in (Authentication Key as Cognito password)
 *   -> first sign-in creates the profile: random Vault Key wrapped by the KEK
 *   -> items encrypted with their own Item Key (wrapped by the Vault Key), TOTP,
 *      sharing within a group (Item Key wrapped for the recipient), history, logs, monitoring
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
  let itemCrypto;

  const sessions = {};
  let vaultId;
  let itemId;
  let itemKey;
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
    itemCrypto = await import('../frontend/src/lib/item-crypto.js');
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

  test('UC-4: add an item encrypted with its own Item Key (wrapped by the Vault Key)', async () => {
    vaultId = (await api.vault.listVaults()).data[0].vault_id;
    const secret = { title: 'Database Cluster Admin', username: 'alice_admin@corp.internal', password: 'ProdSuperPassword_8899!', url: 'https://vault.corp.internal', notes: 'Root DB' };
    const encrypted = await itemCrypto.encryptForSave(secret, { isOwner: true, mek: sessions.alice.vaultKey });
    const created = await api.vault.createItem({ item_type: 'login', ...encrypted, metadata: { favorite: true } }, vaultId);
    assert.equal(created.data.version, 1);
    itemId = created.data.item_id;

    const fetched = await api.vault.getItem(itemId, vaultId);
    const opened = await itemCrypto.decryptVaultItem(fetched.data, { mek: sessions.alice.vaultKey });
    assert.deepEqual(opened.payload, secret);
    itemKey = opened.itemKey;
    assert.deepEqual(await ClientCrypto.unprotectItemKey(fetched.data.encrypted_item_key, sessions.alice.vaultKey), itemKey);
    // The Vault Key itself does not decrypt the payload: only the Item Key does.
    await assert.rejects(() => ClientCrypto.decryptItem(fetched.data.encrypted_data, sessions.alice.vaultKey));
  });

  test('UC-5 & UC-11: update with optimistic version, history and rollback', async () => {
    const updated = { title: 'Database Cluster Admin', username: 'alice_admin@corp.internal', password: 'Rotated_2026!', url: 'https://vault.corp.internal/v2', notes: 'rotated' };
    const encrypted = await itemCrypto.encryptForSave(updated, { isOwner: true, itemKey, mek: sessions.alice.vaultKey });
    const res = await api.vault.updateItem(itemId, { ...encrypted, metadata: { favorite: true }, version: 1 }, vaultId);
    assert.equal(res.data.version, 2);

    const history = await api.history.getHistory(itemId, vaultId);
    assert.equal((await ClientCrypto.decryptItem(history.history[0].encrypted_data, itemKey)).password, 'ProdSuperPassword_8899!');
    assert.equal((await api.history.rollback(itemId, 1, vaultId)).data.version, 3);
  });

  test('UC-10: share within a group by username; the recipient decrypts and edits with the Item Key only', async () => {
    setAuthToken(sessions.alice.token);
    // Not in a shared group yet: Bob cannot be found.
    await assert.rejects(() => api.sharing.lookupUser(bob.username), (err) => err.status === 404);

    const team = await api.groups.create({ name: 'Team' });
    await api.groups.addMember(team.group.group_id || team.group.id, { username: bob.username, role: 'member' });
    const lookup = await api.sharing.lookupUser(bob.username);
    assert.equal(lookup.data.public_key, sessions.bob.keyPair.publicKey);
    assert.equal(lookup.data.email, undefined);

    // Legacy item (payload under the Vault Key) cannot be shared until it gets an Item Key.
    const legacy = await api.vault.createItem({ encrypted_data: await ClientCrypto.encryptItem({ title: 'old' }, sessions.alice.vaultKey) }, vaultId);
    const wrapped = await ClientCrypto.wrapItemKey(itemKey, lookup.data.public_key);
    await assert.rejects(
      () => api.sharing.shareItem(legacy.data.item_id, { recipient_user_id: lookup.data.user_id, encrypted_key_for_recipient: wrapped }, vaultId),
      (err) => err.status === 409
    );

    const share = await api.sharing.shareItem(itemId, { recipient_user_id: lookup.data.user_id, permission_level: 'modify', encrypted_key_for_recipient: wrapped }, vaultId);
    assert.equal(share.status, 'success');

    // Bob decrypts with his private key alone (he never has Alice's Vault Key) ...
    setAuthToken(sessions.bob.token);
    const sharedItem = (await api.sharing.listSharedItems()).data.find((s) => s.item_id === itemId);
    const { payload, itemKey: bobItemKey } = await itemCrypto.decryptVaultItem(sharedItem, { privateKey: sessions.bob.keyPair.privateKey });
    assert.equal(payload.password, 'ProdSuperPassword_8899!');

    // ... and edits it; trying to swap in another Item Key is ignored by the server.
    const edit = await itemCrypto.encryptForSave({ ...payload, password: 'EditedByBob_1!' }, { isOwner: false, itemKey: bobItemKey });
    await api.vault.updateItem(itemId, { ...edit, encrypted_item_key: await ClientCrypto.protectItemKey(bobItemKey, sessions.bob.vaultKey), version: sharedItem.version }, sharedItem.vault_id);

    // Alice still reads it with her own copy of the key.
    setAuthToken(sessions.alice.token);
    const after = await itemCrypto.decryptVaultItem((await api.vault.getItem(itemId, vaultId)).data, { mek: sessions.alice.vaultKey });
    assert.equal(after.payload.password, 'EditedByBob_1!');

    assert.equal((await api.sharing.revokeShare(itemId, lookup.data.user_id, vaultId)).status, 'success');
  });

  test('Collections: late group member appears in pending keys, admin sends the key, member decrypts', async () => {
    setAuthToken(sessions.alice.token);
    const collectionKey = ClientCrypto.generateCollectionKey();
    const created = await api.collections.create({
      name: 'Ops secrets',
      encryptedKeyForRecipient: await ClientCrypto.wrapCollectionKey(collectionKey, sessions.alice.keyPair.publicKey),
    });
    const collectionId = created.collection.id;

    const group = await api.groups.create({ name: 'Ops' });
    const groupId = group.group.group_id || group.group.id;
    await api.collections.grantAccess(collectionId, { targetType: 'group', targetId: groupId, permission: 'read' });
    await api.groups.addMember(groupId, { userId: sessions.bob.profile.user_id, role: 'member' });

    const pending = await api.collections.pendingKeys(collectionId);
    assert.deepEqual(pending.pending.map((m) => m.user_id), [sessions.bob.profile.user_id]);

    // What CollectionsView.handleDistributePendingKeys does:
    const myKey = await api.collections.getKeys(collectionId);
    const unwrapped = await ClientCrypto.unwrapCollectionKey(myKey.key.encryptedKeyForRecipient, sessions.alice.keyPair.privateKey);
    await api.collections.storeKey(collectionId, {
      userId: pending.pending[0].user_id,
      encryptedKeyForRecipient: await ClientCrypto.wrapCollectionKey(unwrapped, pending.pending[0].public_key),
    });
    assert.equal((await api.collections.pendingKeys(collectionId)).pending.length, 0);

    setAuthToken(sessions.bob.token);
    const bobKey = await api.collections.getKeys(collectionId);
    const bobCollectionKey = await ClientCrypto.unwrapCollectionKey(bobKey.key.encryptedKeyForRecipient, sessions.bob.keyPair.privateKey);
    assert.deepEqual(bobCollectionKey, collectionKey);

    // An item in the collection: its Item Key is wrapped with the collection key, so every
    // member with the collection key opens it; moving it out only re-wraps the Item Key.
    setAuthToken(sessions.alice.token);
    const secret = { title: 'Ops root', password: 'OpsRoot_2026!' };
    const enc = await itemCrypto.encryptForSave(secret, { isOwner: true, mek: sessions.alice.vaultKey, targetCollectionKey: collectionKey });
    const created2 = await api.vault.createItem({ ...enc, metadata: { collection_id: collectionId } }, vaultId);
    await api.collections.addItem(collectionId, { itemId: created2.data.item_id });

    setAuthToken(sessions.bob.token);
    const listed = (await api.collections.listItems(collectionId)).items.find((i) => i.item_id === created2.data.item_id);
    const bobView = await itemCrypto.decryptVaultItem(listed, { collectionKey: bobCollectionKey });
    assert.deepEqual(bobView.payload, secret);

    setAuthToken(sessions.alice.token);
    const moved = await itemCrypto.encryptForSave(secret, { isOwner: true, itemKey: bobView.itemKey, mek: sessions.alice.vaultKey });
    await api.vault.updateItem(created2.data.item_id, { ...moved, metadata: {}, version: 1 }, vaultId);
    const personal = await itemCrypto.decryptVaultItem((await api.vault.getItem(created2.data.item_id, vaultId)).data, { mek: sessions.alice.vaultKey });
    assert.deepEqual(personal.payload, secret);
    assert.deepEqual(personal.itemKey, bobView.itemKey);
  });

  test('UC-6: delete item', async () => {
    assert.equal((await api.vault.deleteItem(itemId, vaultId)).status, 'success');
    await assert.rejects(() => api.vault.getItem(itemId, vaultId), (err) => err.status === 404);
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
