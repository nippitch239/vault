/**
 * Collections: CRUD, RBAC, key distribution and item association — regression tests for
 * the bugs listed in REVIEW.md.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase } from '../src/db/adapter.js';
import { TEST_ENCRYPTED_PAYLOAD, callRouter, registerProfile } from './helpers.js';

const WRAPPED = { ciphertext: 'd3JhcHBlZC1rZXk=', algorithm: 'RSA-OAEP', hash: 'SHA-256' };

async function createItem(claims, title = 'Secret') {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims,
    body: { encrypted_data: TEST_ENCRYPTED_PAYLOAD, metadata: { title } },
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

  const victimItem = await createItem(victim, 'Victim bank login');
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
  const ownItem = await createItem(mallory, 'Team wifi');
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
