/**
 * Secure Vault Cloud — backend tests (router, handlers, DB adapter, local simulator)
 *
 * Requests are built as API Gateway REST API (payload v1) events with Cognito authorizer
 * claims, exactly what the Lambda receives in production.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabase } from '../src/db/adapter.js';
import { TEST_ENCRYPTED_PAYLOAD, TEST_SALT, claimsFor, callRouter, registerProfile, insertUser } from './helpers.js';
import { handler } from '../src/lambda.js';
import { startLocalServer } from '../local/local-runner.js';
import { resetLocalAuthStore } from '../local/local-auth.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

test('Database Adapter: Initialization, Constraints and JSONB query translation', async () => {
  const db = await resetDatabase();
  const healthCheck = await db.query('SELECT 1 as live');
  assert.equal(healthCheck.rows[0].live, 1);

  // Insert test row into users
  const adapterUserId = await insertUser(db, 'adapter_user');
  const userRow = await db.query('SELECT * FROM users WHERE user_id = $1', [adapterUserId]);
  assert.equal(userRow.rowCount, 1);
  assert.equal(userRow.rows[0].encrypted_vault_key.algorithm, 'AES-256-GCM');

  // Insert vault item with JSONB
  const insertVault = await db.query(
    'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
    [adapterUserId, 'Test Vault']
  );
  const insertItem = await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      insertVault.rows[0].vault_id,
      adapterUserId,
      TEST_ENCRYPTED_PAYLOAD,
      { title: 'Database Adapter Key', tags: ['db', 'adapter'] },
    ]
  );
  assert.equal(insertItem.rowCount, 1);
  assert.equal(typeof insertItem.rows[0].encrypted_data, 'object');
  assert.equal(insertItem.rows[0].encrypted_data.algorithm, 'AES-256-GCM');

  // JSON extract translation: metadata->>'title'
  const extractQuery = await db.query(
    "SELECT item_id, metadata->>'title' as title FROM vault_items WHERE user_id = $1",
    [adapterUserId]
  );
  assert.equal(extractQuery.rows[0].title, 'Database Adapter Key');
});

test('Milestone 1 — Data Model & Schema Layer: 6 New Tables, Queryability & Defaults', async () => {
  const db = await resetDatabase();

  // 1. Verify all 6 new tables exist in SQLite master catalog
  const tableCheck = await db.query(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (
      'groups', 'group_members', 'collections', 'collection_access', 'collection_items', 'collection_keys'
    )`
  );
  const existingTableNames = new Set(tableCheck.rows.map((r) => r.name));
  const expectedTables = [
    'groups',
    'group_members',
    'collections',
    'collection_access',
    'collection_items',
    'collection_keys',
  ];
  for (const table of expectedTables) {
    assert.ok(existingTableNames.has(table), `Table '${table}' must exist in SQLite schema`);
  }

  // 2. Verify all tables are queryable and initially empty
  for (const table of expectedTables) {
    const countRes = await db.query(`SELECT COUNT(*) as cnt FROM ${table}`);
    assert.equal(Number(countRes.rows[0].cnt), 0, `Table '${table}' should be empty on reset`);
  }

  // 3. Seed User and Vault Item
  const userId = await insertUser(db, 'm1_user');

  const vaultRes = await db.query(
    'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
    [userId, 'M1 Vault']
  );
  const vaultId = vaultRes.rows[0].vault_id;

  const itemRes = await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING item_id`,
    [vaultId, userId, TEST_ENCRYPTED_PAYLOAD, { title: 'M1 Item' }]
  );
  const itemId = itemRes.rows[0].item_id;

  // 4. Test table insertion with default UUID generation (gen_random_uuid)
  const groupRes = await db.query(
    `INSERT INTO groups (name, description, created_by)
     VALUES ($1, $2, $3) RETURNING *`,
    ['Engineering Group', 'Devs and Ops', userId]
  );
  assert.equal(groupRes.rowCount, 1);
  const groupId = groupRes.rows[0].group_id;
  assert.ok(groupId && groupId.length >= 32, 'groups must auto-generate UUID primary key');
  assert.ok(groupRes.rows[0].created_at, 'groups must have created_at default timestamp');

  const memberRes = await db.query(
    `INSERT INTO group_members (group_id, user_id, role)
     VALUES ($1, $2, $3) RETURNING *`,
    [groupId, userId, 'admin']
  );
  assert.equal(memberRes.rowCount, 1);
  assert.ok(memberRes.rows[0].group_member_id, 'group_members must auto-generate UUID');
  assert.equal(memberRes.rows[0].role, 'admin');

  const colRes = await db.query(
    `INSERT INTO collections (name, description, created_by)
     VALUES ($1, $2, $3) RETURNING *`,
    ['Prod Credentials', 'Shared Production Keys', userId]
  );
  assert.equal(colRes.rowCount, 1);
  const colId = colRes.rows[0].collection_id;
  assert.ok(colId && colId.length >= 32, 'collections must auto-generate UUID');

  const accessRes = await db.query(
    `INSERT INTO collection_access (collection_id, target_type, target_id, permission)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [colId, 'group', groupId, 'read']
  );
  assert.equal(accessRes.rowCount, 1);
  assert.ok(accessRes.rows[0].access_id, 'collection_access must auto-generate UUID');

  const colItemRes = await db.query(
    `INSERT INTO collection_items (collection_id, item_id)
     VALUES ($1, $2) RETURNING *`,
    [colId, itemId]
  );
  assert.equal(colItemRes.rowCount, 1);
  assert.ok(colItemRes.rows[0].collection_item_id, 'collection_items must auto-generate UUID');

  const WRAPPED_KEY_SAMPLE = {
    ciphertext: 'sampleBase64WrappedKeyData==',
    algorithm: 'RSA-OAEP',
    hash: 'SHA-256',
  };
  const keyRes = await db.query(
    `INSERT INTO collection_keys (collection_id, user_id, encrypted_key_for_recipient)
     VALUES ($1, $2, $3) RETURNING *`,
    [colId, userId, WRAPPED_KEY_SAMPLE]
  );
  assert.equal(keyRes.rowCount, 1);
  assert.ok(keyRes.rows[0].key_id, 'collection_keys must auto-generate UUID');
  assert.equal(typeof keyRes.rows[0].encrypted_key_for_recipient, 'object');
  assert.equal(keyRes.rows[0].encrypted_key_for_recipient.algorithm, 'RSA-OAEP');

  // 5. Test CTE query and comment query handling (adapter hardening)
  const cteRes = await db.query(`
    -- CTE to query group members
    WITH grp_users AS (
      SELECT user_id FROM group_members WHERE group_id = $1
    )
    SELECT * FROM grp_users
  `, [groupId]);
  assert.equal(cteRes.rowCount, 1);
  assert.equal(cteRes.rows[0].user_id, userId);
});

test('Milestone 1 — Data Model & Schema Layer: Cascading Deletes, Unique & CHECK Constraints', async () => {
  const db = await resetDatabase();

  // 1. Seed two users and one vault item
  const u1 = await insertUser(db, 'cascader1');

  const u2 = await insertUser(db, 'cascader2');

  const vault = (await db.query(
    'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
    [u1, 'V1']
  )).rows[0].vault_id;

  const item1 = (await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING item_id`,
    [vault, u1, TEST_ENCRYPTED_PAYLOAD, { title: 'Cascade Item 1' }]
  )).rows[0].item_id;

  // 2. Create Group and Group Members
  const g1 = (await db.query(
    'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING group_id',
    ['Group One', u1]
  )).rows[0].group_id;

  await db.query(
    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
    [g1, u2, 'member']
  );

  // 3. Verify UNIQUE constraint on group_members (group_id, user_id)
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [g1, u2, 'manager']
      );
    },
    /UNIQUE constraint failed/i,
    'Duplicate (group_id, user_id) must be rejected by UNIQUE constraint'
  );

  // 4. Verify CHECK constraint on group_members role
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
        [g1, u1, 'invalid_role']
      );
    },
    /CHECK constraint failed/i,
    'Invalid role value must be rejected by CHECK constraint'
  );

  // 5. Create Collection, Access, Items, Keys
  const c1 = (await db.query(
    'INSERT INTO collections (name, created_by) VALUES ($1, $2) RETURNING collection_id',
    ['Collection One', u1]
  )).rows[0].collection_id;

  await db.query(
    'INSERT INTO collection_access (collection_id, target_type, target_id, permission) VALUES ($1, $2, $3, $4)',
    [c1, 'group', g1, 'write']
  );

  await db.query(
    'INSERT INTO collection_items (collection_id, item_id) VALUES ($1, $2)',
    [c1, item1]
  );

  await db.query(
    'INSERT INTO collection_keys (collection_id, user_id, encrypted_key_for_recipient) VALUES ($1, $2, $3)',
    [c1, u2, { ciphertext: 'key_data', algorithm: 'RSA-OAEP', hash: 'SHA-256' }]
  );

  // 6. Verify UNIQUE constraints on collection_items, collection_keys, collection_access
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collection_items (collection_id, item_id) VALUES ($1, $2)',
        [c1, item1]
      );
    },
    /UNIQUE constraint failed/i,
    'Duplicate (collection_id, item_id) must be rejected'
  );

  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collection_keys (collection_id, user_id, encrypted_key_for_recipient) VALUES ($1, $2, $3)',
        [c1, u2, { ciphertext: 'dup', algorithm: 'RSA-OAEP', hash: 'SHA-256' }]
      );
    },
    /UNIQUE constraint failed/i,
    'Duplicate (collection_id, user_id) must be rejected'
  );

  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collection_access (collection_id, target_type, target_id, permission) VALUES ($1, $2, $3, $4)',
        [c1, 'group', g1, 'admin']
      );
    },
    /UNIQUE constraint failed/i,
    'Duplicate (collection_id, target_type, target_id) must be rejected'
  );

  // 7. Verify CHECK constraint on collection_access (target_type & permission)
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collection_access (collection_id, target_type, target_id, permission) VALUES ($1, $2, $3, $4)',
        [c1, 'invalid_target', g1, 'read']
      );
    },
    /CHECK constraint failed/i,
    'Invalid target_type must be rejected'
  );

  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collection_access (collection_id, target_type, target_id, permission) VALUES ($1, $2, $3, $4)',
        [c1, 'group', g1, 'invalid_perm']
      );
    },
    /CHECK constraint failed/i,
    'Invalid permission must be rejected'
  );

  // 8. Test Cascading Delete on Collections:
  // Deleting collection c1 must cascade to collection_items, collection_keys, collection_access
  await db.query('DELETE FROM collections WHERE collection_id = $1', [c1]);

  const postDelItems = await db.query(
    'SELECT COUNT(*) as cnt FROM collection_items WHERE collection_id = $1',
    [c1]
  );
  assert.equal(Number(postDelItems.rows[0].cnt), 0, 'collection_items must be wiped on collection delete');

  const postDelKeys = await db.query(
    'SELECT COUNT(*) as cnt FROM collection_keys WHERE collection_id = $1',
    [c1]
  );
  assert.equal(Number(postDelKeys.rows[0].cnt), 0, 'collection_keys must be wiped on collection delete');

  const postDelAccess = await db.query(
    'SELECT COUNT(*) as cnt FROM collection_access WHERE collection_id = $1',
    [c1]
  );
  assert.equal(Number(postDelAccess.rows[0].cnt), 0, 'collection_access must be wiped on collection delete');

  // Verify parent vault_item and user were NOT deleted by cascade
  const itemCheck = await db.query('SELECT COUNT(*) as cnt FROM vault_items WHERE item_id = $1', [item1]);
  assert.equal(Number(itemCheck.rows[0].cnt), 1, 'vault_items must NOT be deleted when collection is deleted');

  // 9. Test Cascading Delete on Groups:
  // Deleting group g1 must cascade to group_members
  await db.query('DELETE FROM groups WHERE group_id = $1', [g1]);

  const postDelMembers = await db.query(
    'SELECT COUNT(*) as cnt FROM group_members WHERE group_id = $1',
    [g1]
  );
  assert.equal(Number(postDelMembers.rows[0].cnt), 0, 'group_members must be wiped on group delete');

  // Verify member user was NOT deleted
  const userCheck = await db.query('SELECT COUNT(*) as cnt FROM users WHERE user_id = $1', [u2]);
  assert.equal(Number(userCheck.rows[0].cnt), 1, 'users must NOT be deleted when group is deleted');
});

test('Lambda entry: REST API v1 events, Cognito claims guard and uniform errors', async () => {
  await resetDatabase();

  // Missing authorizer claims -> 401 (defense in depth behind the API Gateway authorizer)
  const noClaims = await callRouter({ method: 'GET', path: '/api/v1/users/me' });
  assert.equal(noClaims.statusCode, 401);
  assert.equal(noClaims.data.status, 'fail');
  assert.equal(noClaims.data.error, 'UNAUTHORIZED');

  // Access tokens are rejected: the Cognito authorizer is configured for ID tokens
  const accessToken = await callRouter({
    method: 'GET',
    path: '/api/v1/users/me',
    claims: { ...claimsFor('access_user'), token_use: 'access' },
  });
  assert.equal(accessToken.statusCode, 401);

  // Unknown route -> uniform 404 envelope with CORS headers
  const unknown = await callRouter({ method: 'GET', path: '/api/v1/does-not-exist' });
  assert.equal(unknown.statusCode, 404);
  assert.equal(unknown.data.error, 'ROUTE_NOT_FOUND');
  assert.ok(unknown.headers['access-control-allow-origin']);

  // CORS preflight
  const preflight = await callRouter({ method: 'OPTIONS', path: '/api/v1/collections' });
  assert.equal(preflight.statusCode, 204);
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH/);

  // Malformed JSON -> 400 INVALID_JSON instead of a silent {}
  const claims = claimsFor('json_user');
  const badJson = await callRouter({ method: 'POST', path: '/api/v1/users/me', claims, body: '{not json' });
  assert.equal(badJson.statusCode, 400);
  assert.equal(badJson.data.error, 'INVALID_JSON');

  // lambda.handler delegates to the router
  const health = await handler(
    { httpMethod: 'GET', path: '/health', headers: {}, requestContext: { identity: { sourceIp: '10.0.0.1' } } },
    { getRemainingTimeInMillis: () => 3000 }
  );
  assert.equal(health.statusCode, 200);
});

test('Router: unexpected errors are logged and returned without internal details', async () => {
  await resetDatabase();
  const claims = await registerProfile('err_user');
  const db = getDatabase();
  const original = db.query.bind(db);
  db.query = async () => {
    throw new Error('SQLite Query Error: secret table layout\nSQL: SELECT * FROM users');
  };
  const originalConsoleError = console.error;
  const logged = [];
  console.error = (line) => logged.push(line);
  try {
    const res = await callRouter({ method: 'GET', path: '/api/v1/users/me', claims });
    assert.equal(res.statusCode, 500);
    assert.equal(res.data.status, 'error');
    assert.equal(res.data.error, 'INTERNAL_SERVER_ERROR');
    assert.doesNotMatch(res.data.message, /SQL|SQLite|users/);
    assert.equal(logged.length, 1);
    assert.match(logged[0], /secret table layout/);
  } finally {
    db.query = original;
    console.error = originalConsoleError;
  }
});

test('Router: requests are cut off with 504 before the Lambda timeout', async () => {
  await resetDatabase();
  const claims = await registerProfile('slow_user');
  const db = getDatabase();
  const original = db.query.bind(db);
  db.query = () => new Promise(() => {});
  try {
    const res = await callRouter({
      method: 'GET',
      path: '/api/v1/users/me',
      claims,
      context: { getRemainingTimeInMillis: () => 600 },
    });
    assert.equal(res.statusCode, 504);
    assert.equal(res.data.error, 'TIMEOUT');
  } finally {
    db.query = original;
  }
});

test('UC-1: KDF salt lookup and vault profile creation (Cognito sub as user_id)', async () => {
  await resetDatabase();

  // Salt for an unknown identifier is deterministic (used for sign-up, prevents enumeration)
  const s1 = await callRouter({ method: 'GET', path: '/api/v1/auth/salt', queryStringParameters: { identifier: 'Alice' } });
  const s2 = await callRouter({ method: 'GET', path: '/api/v1/auth/salt', queryStringParameters: { identifier: 'alice' } });
  assert.equal(s1.statusCode, 200);
  assert.equal(s1.data.data.salt, s2.data.data.salt);
  assert.ok(Buffer.from(s1.data.data.salt, 'base64').length >= 16);

  const missing = await callRouter({ method: 'GET', path: '/api/v1/auth/salt' });
  assert.equal(missing.statusCode, 400);

  // Profile does not exist yet
  const alice = claimsFor('alice');
  const before = await callRouter({ method: 'GET', path: '/api/v1/users/me', claims: alice });
  assert.equal(before.statusCode, 404);
  assert.equal(before.data.error, 'PROFILE_NOT_FOUND');

  // Validation
  const invalid = await callRouter({ method: 'POST', path: '/api/v1/users/me', claims: alice, body: { full_name: 'Alice' } });
  assert.equal(invalid.statusCode, 400);
  assert.equal(invalid.data.error, 'VALIDATION_FAILED');
  assert.ok(invalid.data.details.some((d) => d.field === 'encrypted_vault_key'));

  // Create profile; role comes from Cognito groups, never from the request body
  const created = await callRouter({
    method: 'POST',
    path: '/api/v1/users/me',
    claims: alice,
    body: {
      full_name: 'Alice Smith',
      role: 'admin',
      kdf_salt: s1.data.data.salt,
      public_key: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA_ALICE',
      encrypted_private_key: TEST_ENCRYPTED_PAYLOAD,
      encrypted_vault_key: TEST_ENCRYPTED_PAYLOAD,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.data.data.user_id, alice.sub);
  assert.equal(created.data.data.role, 'user');
  assert.equal(created.data.data.encrypted_vault_key.ciphertext, TEST_ENCRYPTED_PAYLOAD.ciphertext);

  // Duplicate -> 409
  const dup = await callRouter({
    method: 'POST',
    path: '/api/v1/users/me',
    claims: alice,
    body: {
      full_name: 'Alice Smith',
      kdf_salt: TEST_SALT,
      public_key: 'pk',
      encrypted_private_key: TEST_ENCRYPTED_PAYLOAD,
      encrypted_vault_key: TEST_ENCRYPTED_PAYLOAD,
    },
  });
  assert.equal(dup.statusCode, 409);

  // A default personal vault was created
  const vaults = await callRouter({ method: 'GET', path: '/api/v1/vaults', claims: alice });
  assert.equal(vaults.statusCode, 200);

  // Salt lookup now returns the stored salt, by username or email
  const byEmail = await callRouter({ method: 'GET', path: '/api/v1/auth/salt', queryStringParameters: { identifier: 'alice@securevault.io' } });
  assert.equal(byEmail.data.data.salt, s1.data.data.salt);

  // GET /users/me; admin role follows the Cognito group
  const me = await callRouter({ method: 'GET', path: '/api/v1/users/me', claims: { ...alice, 'cognito:groups': 'admin' } });
  assert.equal(me.statusCode, 200);
  assert.equal(me.data.data.role, 'admin');
  assert.equal(me.data.data.kdf_salt, s1.data.data.salt);
});

test('UC-2/UC-3/UC-7 support: session log, MFA flag and key rotation', async () => {
  await resetDatabase();
  const bob = await registerProfile('bob');

  const session = await callRouter({ method: 'POST', path: '/api/v1/auth/session', claims: bob });
  assert.equal(session.statusCode, 200);

  const mfa = await callRouter({ method: 'PATCH', path: '/api/v1/users/me', claims: bob, body: { mfa_enabled: true } });
  assert.equal(mfa.statusCode, 200);
  assert.equal(mfa.data.data.mfa_enabled, true);

  const badMfa = await callRouter({ method: 'PATCH', path: '/api/v1/users/me', claims: bob, body: { mfa_enabled: 'yes' } });
  assert.equal(badMfa.statusCode, 400);

  const rotated = { ...TEST_ENCRYPTED_PAYLOAD, ciphertext: 'rotatedVaultKeyCiphertext==' };
  const keys = await callRouter({
    method: 'PUT',
    path: '/api/v1/users/me/keys',
    claims: bob,
    body: { kdf_salt: 'AAAAAAAAAAAAAAAAAAAAAA==', encrypted_vault_key: rotated, encrypted_private_key: TEST_ENCRYPTED_PAYLOAD, reason: 'change' },
  });
  assert.equal(keys.statusCode, 200);
  assert.equal(keys.data.data.encrypted_vault_key.ciphertext, 'rotatedVaultKeyCiphertext==');
  assert.equal(keys.data.data.kdf_salt, 'AAAAAAAAAAAAAAAAAAAAAA==');

  const activity = await callRouter({ method: 'GET', path: '/api/v1/user/activity-logs', claims: bob });
  const actions = activity.data.data.map((a) => a.action_type);
  assert.ok(actions.includes('LOGIN_SUCCESS'));
  assert.ok(actions.includes('MFA_ENABLED'));
});

test('UC-4, UC-5, UC-6: Vault CRUD with Zero-Knowledge Encryption Enforcement', async () => {
  await resetDatabase();
  const bobClaims = await registerProfile('bob');
  const vaultsRes = await callRouter({ method: 'GET', path: '/api/v1/vaults', claims: bobClaims });
  const defaultVaultId = vaultsRes.data.data[0].vault_id;

  // --- UC-4: Add Item ---
  // 1. Reject unencrypted / plaintext payload
  const rejectUnencrypted = await callRouter({
    method: 'POST',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    claims: bobClaims,
    body: {
      title: 'Leak Attempt',
      password: 'plainTextPassword123', // Server must reject!
    },
  });
  assert.equal(rejectUnencrypted.statusCode, 400);
  assert.equal(rejectUnencrypted.data.error, 'INVALID_ENCRYPTED_PAYLOAD');

  // 2. Add valid encrypted item
  const addItemRes = await callRouter({
    method: 'POST',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    claims: bobClaims,
    body: {
      item_type: 'login',
      encrypted_data: TEST_ENCRYPTED_PAYLOAD,
      metadata: { favorite: true },
    },
  });

  assert.equal(addItemRes.statusCode, 201);

  // Sensitive fields as plaintext metadata are rejected (zero knowledge)
  const leak = await callRouter({
    method: 'POST',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    claims: bobClaims,
    body: { encrypted_data: TEST_ENCRYPTED_PAYLOAD, metadata: { title: 'Bank', username_preview: 'bob' } },
  });
  assert.equal(leak.statusCode, 400);
  assert.equal(leak.data.error, 'METADATA_NOT_ALLOWED');
  assert.ok(addItemRes.data.data.item_id);
  assert.equal(addItemRes.data.data.version, 1);
  const itemId = addItemRes.data.data.item_id;

  // 3. List items in vault
  const listRes = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    claims: bobClaims,
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.data.data.length, 1);
  assert.equal(listRes.data.data[0].metadata.favorite, true);
  assert.equal(listRes.data.data[0].encrypted_data.ciphertext, TEST_ENCRYPTED_PAYLOAD.ciphertext);

  // --- UC-5: Update Item ---
  const updatedPayload = {
    ...TEST_ENCRYPTED_PAYLOAD,
    ciphertext: 'updatedCiphertextSampleVersion2===',
    iv: 'freshNonceIv1234',
  };

  const updateRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    claims: bobClaims,
    body: {
      version: 1, // Current version
      encrypted_data: updatedPayload,
      metadata: { favorite: false },
    },
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.data.data.version, 2);

  // Optimistic concurrency check: stale update with version 1 must return 409
  const conflictRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    claims: bobClaims,
    body: {
      version: 1, // Stale version! (Now it's 2)
      encrypted_data: updatedPayload,
    },
  });
  assert.equal(conflictRes.statusCode, 409);

  // --- UC-11: Verify Version History was automatically recorded ---
  const historyRes = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}/history`,
    claims: bobClaims,
  });
  assert.equal(historyRes.statusCode, 200);
  assert.equal(historyRes.data.history.length, 1);
  assert.equal(historyRes.data.history[0].version, 1);
  assert.equal(
    historyRes.data.history[0].encrypted_data.ciphertext,
    TEST_ENCRYPTED_PAYLOAD.ciphertext
  );

  // --- UC-11: Rollback to Version 1 ---
  const rollbackRes = await callRouter({
    method: 'POST',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}/rollback`,
    claims: bobClaims,
    body: { version: 1 },
  });
  assert.equal(rollbackRes.statusCode, 200);
  assert.equal(rollbackRes.data.data.version, 3);

  // Verify item now has restored ciphertext
  const getItem = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    claims: bobClaims,
  });
  assert.equal(
    getItem.data.data.encrypted_data.ciphertext,
    TEST_ENCRYPTED_PAYLOAD.ciphertext
  );

  // --- UC-6: Delete Item ---
  const deleteRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    claims: bobClaims,
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.data.data.item_id, itemId);

  // Verify item is gone
  const afterDelete = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    claims: bobClaims,
  });
  assert.equal(afterDelete.statusCode, 404);
});

test('UC-10: Granular Password Sharing & Asymmetric Key Wrapping', async () => {
  await resetDatabase();
  const bobClaims = await registerProfile('bob');
  const charlieClaims = await registerProfile('charlie');

  // 1. Bob creates an item to share
  const bobItem = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims: bobClaims,
    body: {
      encrypted_data: TEST_ENCRYPTED_PAYLOAD,
      metadata: { favorite: false },
    },
  });
  const itemId = bobItem.data.data.item_id;

  // 2. Bob looks up Charlie public key
  const lookupRes = await callRouter({
    method: 'GET',
    path: '/api/v1/users/lookup',
    claims: bobClaims,
    queryStringParameters: { email: 'charlie@securevault.io' },
  });
  assert.equal(lookupRes.statusCode, 200);
  assert.ok(lookupRes.data.data.public_key);

  // 3. Bob attempts to share with self (Must be rejected)
  const selfShare = await callRouter({
    method: 'POST',
    path: `/api/v1/items/${itemId}/share`,
    claims: bobClaims,
    body: {
      recipient_email: 'bob@securevault.io',
      permission_level: 'read',
      encrypted_key_for_recipient: { wrapped_key: 'abc', algorithm: 'RSA-OAEP-SHA256' },
    },
  });
  assert.equal(selfShare.statusCode, 400);

  // 4. Bob shares item with Charlie with READ permission
  const shareRes = await callRouter({
    method: 'POST',
    path: `/api/v1/items/${itemId}/share`,
    claims: bobClaims,
    body: {
      recipient_email: 'charlie@securevault.io',
      permission_level: 'read',
      encrypted_key_for_recipient: {
        wrapped_key: 'bXlfc2hhcmVkX2l0ZW1fa2V5X3dyYXBwZWRfYnlfY2hhcmxpZV9wdWJsaWNfa2V5',
        algorithm: 'RSA-OAEP-SHA256',
      },
    },
  });
  assert.equal(shareRes.statusCode, 201);
  assert.ok(shareRes.data.data.share_id);

  // 5. Charlie lists shared items
  const sharedList = await callRouter({
    method: 'GET',
    path: '/api/v1/shared-items',
    claims: charlieClaims,
  });
  assert.equal(sharedList.statusCode, 200);
  assert.equal(sharedList.data.data.length, 1);
  assert.equal(sharedList.data.data[0].item_id, itemId);
  assert.equal(sharedList.data.data[0].permission_level, 'read');

  // 6. Charlie gets item directly
  const charlieGet = await callRouter({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
    claims: charlieClaims,
  });
  assert.equal(charlieGet.statusCode, 200);
  assert.ok(charlieGet.data.data.share_info);

  // 7. Charlie cannot update (has only READ permission)
  const charlieUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/items/${itemId}`,
    claims: charlieClaims,
    body: { metadata: { favorite: true } },
  });
  assert.equal(charlieUpdate.statusCode, 403);

  // 8. Bob revokes share
  const revokeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/vaults/any/items/${itemId}/share/${charlieClaims.sub}`,
    claims: bobClaims,
  });
  assert.equal(revokeRes.statusCode, 200);

  // 9. After revocation, Charlie cannot access
  const charlieDenied = await callRouter({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
    claims: charlieClaims,
  });
  assert.equal(charlieDenied.statusCode, 403);
});

test('UC-8, UC-9, UC-12, UC-13: Security Notifications, Audit, Activity & Monitoring', async () => {
  const adminClaims = await registerProfile('admin', { admin: true });
  const regularClaims = claimsFor('charlie');

  // --- UC-8: Security Notifications ---
  // Regular user is rejected with 403
  const userSecurityForbidden = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/security/notifications',
    claims: regularClaims,
  });
  assert.equal(userSecurityForbidden.statusCode, 403);

  // Admin simulates security event
  const simulateRes = await callRouter({
    method: 'POST',
    path: '/api/v1/admin/security/simulate-event',
    claims: adminClaims,
    body: {
      severity: 'CRITICAL',
      type: 'GuardDuty:PortProbeUnusual',
      description: 'Port probe from malicious actor',
    },
  });
  assert.equal(simulateRes.statusCode, 201);

  // Admin lists notifications
  const adminNotifications = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/security/notifications',
    claims: adminClaims,
  });
  assert.equal(adminNotifications.statusCode, 200);
  assert.ok(adminNotifications.data.data.length >= 1);

  // --- UC-9: Admin Audit Logs (JSON & CSV Export) ---
  // Regular user rejected
  const userAuditForbidden = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    claims: regularClaims,
  });
  assert.equal(userAuditForbidden.statusCode, 403);

  // Admin queries audit logs (JSON)
  const auditJson = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    claims: adminClaims,
  });
  assert.equal(auditJson.statusCode, 200);
  assert.ok(auditJson.data.data.length > 0);
  assert.ok(auditJson.data.pagination.total > 0);

  // Admin exports audit logs as CSV
  const auditCsv = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    claims: adminClaims,
    queryStringParameters: { format: 'csv' },
  });
  assert.equal(auditCsv.statusCode, 200);
  assert.equal(auditCsv.headers['content-type'], 'text/csv');
  assert.ok(auditCsv.data.includes('audit_id,created_at,actor_user_id'));

  // --- UC-12: User Activity Logs ---
  const activityRes = await callRouter({
    method: 'GET',
    path: '/api/v1/user/activity-logs',
    claims: regularClaims,
  });
  assert.equal(activityRes.statusCode, 200);
  assert.ok(Array.isArray(activityRes.data.data));

  // --- UC-13: System Monitoring & Health Check ---
  // Public Health probe
  const health = await callRouter({ method: 'GET', path: '/health' });
  assert.equal(health.statusCode, 200);
  assert.equal(health.data.status, 'healthy');
  assert.equal(health.data.database, 'connected');

  // Admin queries metrics dashboard
  const metricsRes = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/monitoring/metrics',
    claims: adminClaims,
  });
  assert.equal(metricsRes.statusCode, 200);
  assert.equal(metricsRes.data.metrics.system_health, 'HEALTHY');
  assert.ok(metricsRes.data.metrics.uptime_seconds >= 0);
  assert.ok(metricsRes.data.metrics.inventory.total_users >= 3);
});

test('Local Simulation HTTP Server: End-to-End Live HTTP Network Parity', async () => {
  await resetDatabase();
  resetLocalAuthStore();
  // Start server on ephemeral port (port 0)
  const sim = await startLocalServer(0);
  const baseUrl = `http://127.0.0.1:${sim.port}`;

  try {
    // 1. Live health check over HTTP
    const resHealth = await fetch(`${baseUrl}/health`);
    assert.equal(resHealth.status, 200);
    const dataHealth = await resHealth.json();
    assert.equal(dataHealth.status, 'healthy');
    assert.equal(dataHealth.database, 'connected');

    // 2. Requests without a Cognito ID token are rejected like the API Gateway authorizer does
    const anonymous = await fetch(`${baseUrl}/api/v1/items`);
    assert.equal(anonymous.status, 401);

    // 3. Local Cognito: sign-up -> confirm -> sign-in -> ID token
    const post = (path, body, token) =>
      fetch(`${baseUrl}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify(body),
      });
    const signUp = await (await post('/local-auth/sign-up', { username: 'netuser', email: 'network_test@securevault.io', password: 'Aa1!local-password' })).json();
    assert.equal(signUp.nextStep, 'CONFIRM_SIGN_UP');
    const confirm = await post('/local-auth/confirm-sign-up', { username: 'netuser', code: signUp.devCode });
    assert.equal(confirm.status, 200);
    const signIn = await (await post('/local-auth/sign-in', { username: 'network_test@securevault.io', password: 'Aa1!local-password' })).json();
    assert.equal(signIn.nextStep, 'DONE');
    const token = signIn.idToken;

    // 4. Create vault profile and an item through the simulated API Gateway
    const profile = await post(
      '/api/v1/users/me',
      {
        full_name: 'Network User',
        kdf_salt: TEST_SALT,
        public_key: 'pk',
        encrypted_private_key: TEST_ENCRYPTED_PAYLOAD,
        encrypted_vault_key: TEST_ENCRYPTED_PAYLOAD,
      },
      token
    );
    assert.equal(profile.status, 201);
    const itemRes = await post('/api/v1/items', { encrypted_data: TEST_ENCRYPTED_PAYLOAD, metadata: { favorite: false } }, token);
    assert.equal(itemRes.status, 201);
    const itemData = await itemRes.json();
    assert.ok(itemData.data.item_id);

    // 5. CORS OPTIONS request
    const optionsRes = await fetch(`${baseUrl}/api/v1/items`, { method: 'OPTIONS' });
    assert.equal(optionsRes.status, 204);
    assert.equal(optionsRes.headers.get('access-control-allow-origin'), '*');
  } finally {
    await sim.close();
  }
});
