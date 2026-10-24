/**
 * Collections: CRUD, RBAC, key distribution and item association — regression tests for
 * the bugs listed in REVIEW.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase } from '../src/db/adapter.js';
import { TEST_ENCRYPTED_PAYLOAD, callRouter, registerProfile } from './helpers.js';

const WRAPPED = { ciphertext: 'd3JhcHBlZC1rZXk=', algorithm: 'RSA-OAEP', hash: 'SHA-256' };

async function createItem(claims) {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims,
    body: { encrypted_data: TEST_ENCRYPTED_PAYLOAD, metadata: { favorite: false } },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.data));
  return res.data.data.item_id;
}

async function createCollection(claims, name = 'Team') {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/collections',
    claims,
    body: { name, encryptedKeyForRecipient: WRAPPED },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.data));
  return res.data.collection.id;
}

async function grant(claims, collectionId, targetId, permission, targetType = 'user') {
  const res = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims,
    body: { targetType, targetId, permission },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.data));
}

test('C1: a collection writer cannot attach (and then read) another user\'s vault item', async () => {
  await resetDatabase();
  const owner = await registerProfile('owner');
  const mallory = await registerProfile('mallory');
  const victim = await registerProfile('victim');

  const victimItem = await createItem(victim);
  const collectionId = await createCollection(owner);
  await grant(owner, collectionId, mallory.sub, 'write');

  const attach = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: mallory,
    body: { itemId: victimItem },
  });
  assert.equal(attach.statusCode, 403);
  assert.equal(attach.data.error, 'ITEM_NOT_OWNED');

  const listed = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/items`, claims: mallory });
  assert.equal(listed.statusCode, 200);
  assert.equal(listed.data.items.length, 0);

  // The owner of an item can still add their own item
  const ownItem = await createItem(mallory);
  const ok = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: mallory,
    body: { itemId: ownItem },
  });
  assert.equal(ok.statusCode, 201);
});

test('C2: only collection admins can distribute wrapped keys, and only to members', async () => {
  await resetDatabase();
  const admin = await registerProfile('keyadmin');
  const reader = await registerProfile('reader');
  const outsider = await registerProfile('outsider');
  const collectionId = await createCollection(admin);
  await grant(admin, collectionId, reader.sub, 'read');

  const attackerKey = { ...WRAPPED, ciphertext: 'YXR0YWNrZXIta2V5' };
  // A reader must not replace the admin's key (key substitution)
  const overwrite = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/keys`,
    claims: reader,
    body: { userId: admin.sub, encryptedKeyForRecipient: attackerKey },
  });
  assert.equal(overwrite.statusCode, 403);
  const adminKey = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/keys`, claims: admin });
  assert.equal(adminKey.data.key.encryptedKeyForRecipient.ciphertext, WRAPPED.ciphertext);

  // Keys can only be stored for users who already have access
  const noAccess = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/keys`,
    claims: admin,
    body: { userId: outsider.sub, encryptedKeyForRecipient: WRAPPED },
  });
  assert.equal(noAccess.statusCode, 400);
  assert.equal(noAccess.data.error, 'TARGET_HAS_NO_ACCESS');

  // Admin -> member works
  const ok = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/keys`,
    claims: admin,
    body: { userId: reader.sub, encryptedKeyForRecipient: WRAPPED },
  });
  assert.equal(ok.statusCode, 201);
  const readerKey = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/keys`, claims: reader });
  assert.equal(readerKey.statusCode, 200);
});

test('Groups: a manager cannot escalate to group admin (which would inherit collection admin)', async () => {
  await resetDatabase();
  const owner = await registerProfile('gowner');
  const manager = await registerProfile('gmanager');
  const friend = await registerProfile('gfriend');

  const group = await callRouter({ method: 'POST', path: '/api/v1/groups', claims: owner, body: { name: 'Ops' } });
  const groupId = group.data.group.group_id || group.data.group.id;
  const addManager = await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: owner, body: { userId: manager.sub, role: 'manager' } });
  assert.equal(addManager.statusCode, 201);

  const escalate = await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: manager, body: { userId: friend.sub, role: 'admin' } });
  assert.equal(escalate.statusCode, 403);
  const member = await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: manager, body: { userId: friend.sub, role: 'member' } });
  assert.equal(member.statusCode, 201);

  // A manager cannot remove the group admin (the owner)
  const removeOwner = await callRouter({ method: 'DELETE', path: `/api/v1/groups/${groupId}/members/${owner.sub}`, claims: manager });
  assert.equal(removeOwner.statusCode, 403);

  // Non-string role no longer crashes with 500
  const badRole = await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: owner, body: { userId: friend.sub, role: 42 } });
  assert.notEqual(badRole.statusCode, 500);
});

test('C3: revoking access (direct or via group) removes the user\'s wrapped key', async () => {
  await resetDatabase();
  const admin = await registerProfile('c3admin');
  const direct = await registerProfile('c3direct');
  const viaGroup = await registerProfile('c3group');
  const collectionId = await createCollection(admin);

  const group = await callRouter({ method: 'POST', path: '/api/v1/groups', claims: admin, body: { name: 'C3' } });
  const groupId = group.data.group.group_id || group.data.group.id;
  await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: admin, body: { userId: viaGroup.sub } });

  await grant(admin, collectionId, direct.sub, 'read');
  await grant(admin, collectionId, groupId, 'read', 'group');
  for (const u of [direct, viaGroup]) {
    const res = await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/keys`, claims: admin, body: { userId: u.sub, encryptedKeyForRecipient: WRAPPED } });
    assert.equal(res.statusCode, 201);
  }

  const revoke = await callRouter({ method: 'DELETE', path: `/api/v1/collections/${collectionId}/access/user/${direct.sub}`, claims: admin });
  assert.equal(revoke.statusCode, 200);
  assert.equal(revoke.data.keysRemoved, 1);

  const leave = await callRouter({ method: 'DELETE', path: `/api/v1/groups/${groupId}/members/${viaGroup.sub}`, claims: admin });
  assert.equal(leave.statusCode, 200);

  const db = (await import('../src/db/adapter.js')).getDatabase();
  const keys = await db.query('SELECT user_id FROM collection_keys WHERE collection_id = $1', [collectionId]);
  assert.deepEqual(keys.rows.map((r) => r.user_id), [admin.sub]);
});

test('C5/C6: malformed collection input returns 400 instead of 500', async () => {
  await resetDatabase();
  const admin = await registerProfile('c5admin');
  const collectionId = await createCollection(admin);
  const call = (method, path, body) => callRouter({ method, path, claims: admin, body });

  const cases = [
    ['GET', '/api/v1/collections/not-a-uuid', undefined, 'INVALID_ID'],
    ['POST', `/api/v1/collections/${collectionId}/access`, { targetType: 'user', targetId: 'abc', permission: 'read' }, 'INVALID_ID'],
    ['POST', `/api/v1/collections/${collectionId}/access`, { targetType: 'user', targetId: admin.sub, permission: 7 }, 'BAD_REQUEST'],
    ['POST', `/api/v1/collections/${collectionId}/access`, { targetType: ['user'], targetId: admin.sub }, 'BAD_REQUEST'],
    ['POST', '/api/v1/collections', { name: 'x'.repeat(256) }, 'VALIDATION_FAILED'],
    ['POST', '/api/v1/collections', { name: 'ok', description: { html: true } }, 'VALIDATION_FAILED'],
    ['POST', '/api/v1/collections', { name: 'ok', encryptedKeyForRecipient: 'plain' }, 'VALIDATION_FAILED'],
    ['PUT', `/api/v1/collections/${collectionId}`, { name: '   ' }, 'VALIDATION_FAILED'],
    ['POST', `/api/v1/collections/${collectionId}/items`, { itemId: 12 }, 'INVALID_ID'],
    ['POST', `/api/v1/collections/${collectionId}/keys`, { userId: 'nope', encryptedKeyForRecipient: WRAPPED }, 'INVALID_ID'],
    ['DELETE', `/api/v1/collections/${collectionId}/access/robot/${admin.sub}`, undefined, 'BAD_REQUEST'],
  ];
  for (const [method, path, body, code] of cases) {
    const res = await call(method, path, body);
    assert.equal(res.statusCode, 400, `${method} ${path} ${JSON.stringify(body)} -> ${res.statusCode} ${JSON.stringify(res.data)}`);
    assert.equal(res.data.error, code, `${method} ${path}`);
  }

  const badJson = await callRouter({ method: 'POST', path: '/api/v1/collections', claims: admin, body: '{"name":' });
  assert.equal(badJson.data.error, 'INVALID_JSON');

  // Boundaries that must still work: 255-char name, Unicode, null description
  const long = await call('POST', '/api/v1/collections', { name: `${'ก'.repeat(250)}🔐🔐`, description: null });
  assert.equal(long.statusCode, 201);
});

test('C5: mixed-case targetType is normalised (no CHECK-constraint 500)', async () => {
  await resetDatabase();
  const admin = await registerProfile('caseadmin');
  const friend = await registerProfile('casefriend');
  const collectionId = await createCollection(admin);
  const res = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: admin,
    body: { targetType: 'User', targetId: friend.sub, permission: 'WRITE' },
  });
  assert.equal(res.statusCode, 201);
  assert.equal(res.data.access.target_type, 'user');
  const revoke = await callRouter({ method: 'DELETE', path: `/api/v1/collections/${collectionId}/access/USER/${friend.sub}`, claims: admin });
  assert.equal(revoke.statusCode, 200);
});

test('C8: listing collections uses a constant number of queries and the supremum permission', async () => {
  await resetDatabase();
  const owner = await registerProfile('c8owner');
  const member = await registerProfile('c8member');
  const sysadmin = await registerProfile('c8sysadmin', { admin: true });

  const group = await callRouter({ method: 'POST', path: '/api/v1/groups', claims: owner, body: { name: 'C8' } });
  const groupId = group.data.group.group_id || group.data.group.id;
  await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: owner, body: { userId: member.sub } });

  const ids = [];
  for (let i = 0; i < 12; i++) ids.push(await createCollection(owner, `C8-${i}`));
  await grant(owner, ids[0], member.sub, 'read');
  await grant(owner, ids[0], groupId, 'write', 'group'); // direct read + group write -> write
  await grant(owner, ids[1], groupId, 'read', 'group');

  const db = (await import('../src/db/adapter.js')).getDatabase();
  const original = db.query.bind(db);
  let queries = 0;
  db.query = (...args) => {
    queries += 1;
    return original(...args);
  };
  try {
    const res = await callRouter({ method: 'GET', path: '/api/v1/collections', claims: member });
    assert.equal(res.statusCode, 200);
    const perms = Object.fromEntries(res.data.collections.map((c) => [c.id, c.effectivePermission]));
    assert.deepEqual(perms, { [ids[0]]: 'write', [ids[1]]: 'read' });
    assert.ok(queries <= 2, `expected a constant number of queries, got ${queries}`);
  } finally {
    db.query = original;
  }

  const ownerList = await callRouter({ method: 'GET', path: '/api/v1/collections', claims: owner });
  assert.equal(ownerList.data.collections.length, 12);
  assert.ok(ownerList.data.collections.every((c) => c.effectivePermission === 'admin'));
  const adminList = await callRouter({ method: 'GET', path: '/api/v1/collections', claims: sysadmin });
  assert.equal(adminList.data.collections.length, 12);
});

test('C7: create/delete collection are atomic', async () => {
  await resetDatabase();
  const owner = await registerProfile('c7owner');
  const db = (await import('../src/db/adapter.js')).getDatabase();
  const original = db.query.bind(db);
  const originalConsoleError = console.error;
  console.error = () => {};
  db.query = (sql, params) => {
    if (/INSERT INTO collection_keys/.test(sql)) throw new Error('simulated failure');
    return original(sql, params);
  };
  try {
    const res = await callRouter({ method: 'POST', path: '/api/v1/collections', claims: owner, body: { name: 'Half', encryptedKeyForRecipient: WRAPPED } });
    assert.equal(res.statusCode, 500);
  } finally {
    db.query = original;
    console.error = originalConsoleError;
  }
  const left = await db.query('SELECT COUNT(*) AS n FROM collections');
  assert.equal(Number(left.rows[0].n), 0, 'collection row must be rolled back');
  const access = await db.query('SELECT COUNT(*) AS n FROM collection_access');
  assert.equal(Number(access.rows[0].n), 0, 'access row must be rolled back');
});

test('C11: every collection change is written to the audit log', async () => {
  await resetDatabase();
  const owner = await registerProfile('c11owner');
  const friend = await registerProfile('c11friend');
  const collectionId = await createCollection(owner);
  const itemId = await createItem(owner);
  await grant(owner, collectionId, friend.sub, 'read');
  await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/keys`, claims: owner, body: { userId: friend.sub, encryptedKeyForRecipient: WRAPPED } });
  await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/items`, claims: owner, body: { itemId } });
  await callRouter({ method: 'DELETE', path: `/api/v1/collections/${collectionId}/items/${itemId}`, claims: owner });
  await callRouter({ method: 'PUT', path: `/api/v1/collections/${collectionId}`, claims: owner, body: { name: 'Renamed' } });
  await callRouter({ method: 'DELETE', path: `/api/v1/collections/${collectionId}/access/user/${friend.sub}`, claims: owner });
  await callRouter({ method: 'DELETE', path: `/api/v1/collections/${collectionId}`, claims: owner });

  const db = (await import('../src/db/adapter.js')).getDatabase();
  const rows = await db.query("SELECT event_action FROM audit_logs WHERE target_resource = 'collection' AND target_resource_id = $1", [collectionId]);
  const actions = new Set(rows.rows.map((r) => r.event_action));
  for (const a of [
    'COLLECTION_CREATED',
    'COLLECTION_ACCESS_GRANTED',
    'COLLECTION_KEY_DISTRIBUTED',
    'COLLECTION_ITEM_ADDED',
    'COLLECTION_ITEM_REMOVED',
    'COLLECTION_UPDATED',
    'COLLECTION_ACCESS_REVOKED',
    'COLLECTION_DELETED',
  ]) {
    assert.ok(actions.has(a), `missing audit action ${a}`);
  }
});

test('D4: admins can list members who have access but no wrapped key yet', async () => {
  await resetDatabase();
  const admin = await registerProfile('d4admin');
  const early = await registerProfile('d4early');
  const late = await registerProfile('d4late');
  const direct = await registerProfile('d4direct');
  const collectionId = await createCollection(admin);

  const group = await callRouter({ method: 'POST', path: '/api/v1/groups', claims: admin, body: { name: 'D4' } });
  const groupId = group.data.group.group_id || group.data.group.id;
  await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: admin, body: { userId: early.sub } });
  await grant(admin, collectionId, groupId, 'read', 'group');
  await grant(admin, collectionId, direct.sub, 'write');
  await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/keys`, claims: admin, body: { userId: early.sub, encryptedKeyForRecipient: WRAPPED } });
  // joins after the group grant -> has access, no key
  await callRouter({ method: 'POST', path: `/api/v1/groups/${groupId}/members`, claims: admin, body: { userId: late.sub } });

  const pending = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/keys/pending`, claims: admin });
  assert.equal(pending.statusCode, 200);
  assert.deepEqual(pending.data.pending.map((p) => p.username).sort(), ['d4direct', 'd4late']);
  assert.ok(pending.data.pending.every((p) => p.public_key));

  const forbidden = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/keys/pending`, claims: direct });
  assert.equal(forbidden.statusCode, 403);
});

test('D3: collection writers can edit (not delete) items in the collection; readers can view', async () => {
  await resetDatabase();
  const owner = await registerProfile('d3owner');
  const writer = await registerProfile('d3writer');
  const reader = await registerProfile('d3reader');
  const outsider = await registerProfile('d3outsider');
  const collectionId = await createCollection(owner);
  await grant(owner, collectionId, writer.sub, 'write');
  await grant(owner, collectionId, reader.sub, 'read');

  const created = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims: owner,
    body: { encrypted_data: TEST_ENCRYPTED_PAYLOAD, metadata: { collection_id: collectionId } },
  });
  const itemId = created.data.data.item_id;
  await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/items`, claims: owner, body: { itemId } });

  const edited = { ...TEST_ENCRYPTED_PAYLOAD, ciphertext: 'ZWRpdGVkLWJ5LXdyaXRlcg==' };
  const byWriter = await callRouter({
    method: 'PUT',
    path: `/api/v1/items/${itemId}`,
    claims: writer,
    body: { version: 1, encrypted_data: edited, metadata: { favorite: true } },
  });
  assert.equal(byWriter.statusCode, 200, JSON.stringify(byWriter.data));

  const view = await callRouter({ method: 'GET', path: `/api/v1/items/${itemId}`, claims: reader });
  assert.equal(view.statusCode, 200);
  assert.equal(view.data.data.encrypted_data.ciphertext, edited.ciphertext);
  assert.equal(view.data.data.collection_permission, 'read');
  assert.equal(view.data.data.metadata.collection_id, collectionId, 'non-owner edit keeps the collection');

  const byReader = await callRouter({ method: 'PUT', path: `/api/v1/items/${itemId}`, claims: reader, body: { version: 2, encrypted_data: edited } });
  assert.equal(byReader.statusCode, 403);
  const deleteByWriter = await callRouter({ method: 'DELETE', path: `/api/v1/items/${itemId}`, claims: writer });
  assert.equal(deleteByWriter.statusCode, 403);
  const outsiderView = await callRouter({ method: 'GET', path: `/api/v1/items/${itemId}`, claims: outsider });
  assert.equal(outsiderView.statusCode, 403);
});

test('UI support: access entries carry display names, collections carry item counts', async () => {
  await resetDatabase();
  const owner = await registerProfile('uiowner');
  const friend = await registerProfile('uifriend');
  const collectionId = await createCollection(owner, 'UI');
  const group = await callRouter({ method: 'POST', path: '/api/v1/groups', claims: owner, body: { name: 'Design team' } });
  const groupId = group.data.group.group_id || group.data.group.id;
  await grant(owner, collectionId, friend.sub, 'read');
  await grant(owner, collectionId, groupId, 'write', 'group');
  const itemId = await createItem(owner);
  await callRouter({ method: 'POST', path: `/api/v1/collections/${collectionId}/items`, claims: owner, body: { itemId } });

  const access = await callRouter({ method: 'GET', path: `/api/v1/collections/${collectionId}/access`, claims: owner });
  const names = Object.fromEntries(access.data.access.map((a) => [a.targetId, a.targetName]));
  assert.equal(names[friend.sub], 'uifriend Tester');
  assert.equal(names[groupId], 'Design team');

  const list = await callRouter({ method: 'GET', path: '/api/v1/collections', claims: owner });
  assert.equal(list.data.collections[0].itemCount, 1);
});
