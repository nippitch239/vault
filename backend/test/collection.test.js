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
