/**
 * Secure Vault Cloud — Comprehensive Server Tests (UC-1 through UC-13)
 *
 * Validates:
 * 1. Database adapter with in-memory SQLite and JSONB translation.
 * 2. Pure Lambda Handlers and API Gateway v2 event router.
 * 3. Local HTTP simulation server via real network fetch.
 * 4. End-to-end coverage of all 13 Use Cases with zero regressions.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { getDatabase, resetDatabase } from './db/adapter.js';
import { router } from './router.js';
import { startLocalServer } from './local-runner.js';
import { signJwt, verifyJwt } from './middleware/auth-guard.js';
import { generateTotp } from './handlers/auth.js';
import { hashAuthHash } from '../shared/crypto.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// Helper to invoke router with synthetic API Gateway v2 event
async function callRouter({
  method = 'GET',
  path = '/health',
  headers = {},
  body = null,
  queryStringParameters = {},
}) {
  const event = {
    version: '2.0',
    rawPath: path,
    rawQueryString: new URLSearchParams(queryStringParameters).toString(),
    queryStringParameters,
    headers: {
      'content-type': 'application/json',
      ...headers,
    },
    requestContext: {
      http: {
        method: method.toUpperCase(),
        path,
        sourceIp: '127.0.0.1',
        userAgent: 'test-runner',
      },
    },
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
  };

  const response = await router(event);
  let parsedBody = null;
  if (response.body) {
    try {
      parsedBody = JSON.parse(response.body);
    } catch {
      parsedBody = response.body;
    }
  }

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    data: parsedBody,
  };
}

// Re-usable test fixtures
const TEST_SALT = 'rK9v1k7Y5w4/1Z5b8lX9dQ==';
const TEST_AUTH_HASH = 'a591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e';
const TEST_ENCRYPTED_PAYLOAD = {
  ciphertext: 'pL38Kz0987654321+secureCiphertextSample==',
  iv: '3d9FaK21L+xR7n4m',
  auth_tag: 'q9Xm5h6Jk2L9p3Z0==',
  algorithm: 'AES-256-GCM',
  key_version: 1,
};

test('Database Adapter: Initialization, Constraints and JSONB query translation', async () => {
  const db = await resetDatabase();
  const healthCheck = await db.query('SELECT 1 as live');
  assert.equal(healthCheck.rows[0].live, 1);

  // Insert test row into users
  const insertUser = await db.query(
    `INSERT INTO users (email, username, full_name, auth_hash, auth_salt)
     VALUES ($1, $2, $3, $4, $5) RETURNING *`,
    ['adapter_test@example.com', 'adapter_user', 'Adapter User', 'hash', 'salt']
  );
  assert.equal(insertUser.rowCount, 1);
  assert.ok(insertUser.rows[0].user_id);

  // Insert vault item with JSONB
  const insertVault = await db.query(
    'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
    [insertUser.rows[0].user_id, 'Test Vault']
  );
  const insertItem = await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [
      insertVault.rows[0].vault_id,
      insertUser.rows[0].user_id,
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
    [insertUser.rows[0].user_id]
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
  const userRes = await db.query(
    `INSERT INTO users (email, username, full_name, auth_hash, auth_salt)
     VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
    ['m1_user@example.com', 'm1_user', 'M1 User', 'hash', 'salt']
  );
  const userId = userRes.rows[0].user_id;

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
  const u1 = (await db.query(
    `INSERT INTO users (email, username, full_name, auth_hash, auth_salt)
     VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
    ['cascade1@example.com', 'cascader1', 'User 1', 'h', 's']
  )).rows[0].user_id;

  const u2 = (await db.query(
    `INSERT INTO users (email, username, full_name, auth_hash, auth_salt)
     VALUES ($1, $2, $3, $4, $5) RETURNING user_id`,
    ['cascade2@example.com', 'cascader2', 'User 2', 'h', 's']
  )).rows[0].user_id;

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

test('JWT Middleware & RBAC: Token signing, verification, and role guard', () => {
  const userPayload = {
    sub: '11111111-2222-3333-4444-555555555555',
    email: 'jwt_user@example.com',
    username: 'jwt_user',
    role: 'user',
  };

  const token = signJwt(userPayload, undefined, 60);
  assert.ok(token);

  const decoded = verifyJwt(token);
  assert.equal(decoded.sub, userPayload.sub);
  assert.equal(decoded.email, userPayload.email);
  assert.equal(decoded.role, 'user');

  // Tampered token throws error
  const parts = token.split('.');
  const tamperedToken = `${parts[0]}.${parts[1]}.tamperedSignature`;
  assert.throws(() => verifyJwt(tamperedToken), /INVALID_SIGNATURE/);
});

test('UC-1: Registration & Pre-Login Salt Retrieval', async () => {
  await resetDatabase();

  // 1. Missing fields should return 400
  const badReq = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: { email: 'bad@example.com' },
  });
  assert.equal(badReq.statusCode, 400);
  assert.equal(badReq.data.status, 'fail');

  // 2. Successful Registration
  const regRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'alice@securevault.io',
      username: 'alice',
      fullName: 'Alice Smith',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
      publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA...',
      role: 'user',
    },
  });

  assert.equal(regRes.statusCode, 201);
  assert.equal(regRes.data.status, 'success');
  assert.ok(regRes.data.data.user_id);
  assert.ok(regRes.data.data.default_vault_id);
  assert.equal(regRes.data.data.email, 'alice@securevault.io');

  // 3. Duplicate email returns 409
  const dupEmail = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'alice@securevault.io',
      username: 'alice_different',
      fullName: 'Alice Clone',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
    },
  });
  assert.equal(dupEmail.statusCode, 409);

  // 4. Duplicate username returns 409
  const dupUser = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'another@securevault.io',
      username: 'alice',
      fullName: 'Bob Smith',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
    },
  });
  assert.equal(dupUser.statusCode, 409);

  // 5. Pre-login Salt Lookup
  const saltRes = await callRouter({
    method: 'GET',
    path: '/api/v1/auth/salt',
    queryStringParameters: { email: 'alice@securevault.io' },
  });
  assert.equal(saltRes.statusCode, 200);
  assert.equal(saltRes.data.data.salt, TEST_SALT);

  // 6. Salt lookup for unknown user returns 404
  const unknownSalt = await callRouter({
    method: 'GET',
    path: '/api/v1/auth/salt',
    queryStringParameters: { email: 'nonexistent@example.com' },
  });
  assert.equal(unknownSalt.statusCode, 404);
});

test('UC-2: User Login & JWT Issuance', async () => {
  // 1. Successful login
  const loginRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: {
      email: 'alice@securevault.io',
      authHash: TEST_AUTH_HASH,
    },
  });

  assert.equal(loginRes.statusCode, 200);
  assert.equal(loginRes.data.status, 'success');
  assert.ok(loginRes.data.token);
  assert.equal(loginRes.data.user.email, 'alice@securevault.io');
  assert.equal(loginRes.data.user.mfa_enabled, false);

  // 2. Wrong authHash returns 401
  const wrongPass = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: {
      email: 'alice@securevault.io',
      authHash: '0000000000000000000000000000000000000000000000000000000000000000',
    },
  });
  assert.equal(wrongPass.statusCode, 401);

  // 3. Unknown user returns 401
  const unknownUser = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: {
      email: 'ghost@securevault.io',
      authHash: TEST_AUTH_HASH,
    },
  });
  assert.equal(unknownUser.statusCode, 401);
});

test('UC-3: Multi-Factor Authentication (MFA Setup, Verify & Login Challenge)', async () => {
  // Login to obtain JWT
  const login = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'alice@securevault.io', authHash: TEST_AUTH_HASH },
  });
  const token = login.data.token;

  // 1. MFA Setup
  const setupRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/mfa/setup',
    headers: { authorization: `Bearer ${token}` },
  });
  assert.equal(setupRes.statusCode, 200);
  assert.ok(setupRes.data.data.secret);
  assert.ok(setupRes.data.data.otpauth_url.includes('otpauth://totp/'));

  const mfaSecret = setupRes.data.data.secret;

  // 2. Verify with wrong code returns 400
  const wrongCode = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/mfa/verify',
    headers: { authorization: `Bearer ${token}` },
    body: { token: '000000' },
  });
  assert.equal(wrongCode.statusCode, 400);

  // 3. Verify with valid TOTP code enables MFA
  const validOtp = generateTotp(mfaSecret);
  const verifyRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/mfa/verify',
    headers: { authorization: `Bearer ${token}` },
    body: { token: validOtp },
  });
  assert.equal(verifyRes.statusCode, 200);
  assert.equal(verifyRes.data.status, 'success');

  // 4. Next login requires MFA challenge
  const mfaLogin = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'alice@securevault.io', authHash: TEST_AUTH_HASH },
  });
  assert.equal(mfaLogin.statusCode, 200);
  assert.equal(mfaLogin.data.status, 'mfa_required');
  assert.ok(mfaLogin.data.mfa_session_token);

  const sessionToken = mfaLogin.data.mfa_session_token;

  // 5. Validate login challenge with invalid code returns 400
  const badChallenge = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/mfa/validate',
    body: { mfa_session_token: sessionToken, token: '999999' },
  });
  assert.equal(badChallenge.statusCode, 400);

  // 6. Validate login challenge with valid code returns full JWT
  const newValidOtp = generateTotp(mfaSecret);
  const goodChallenge = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/mfa/validate',
    body: { mfa_session_token: sessionToken, token: newValidOtp },
  });
  assert.equal(goodChallenge.statusCode, 200);
  assert.ok(goodChallenge.data.token);
  assert.equal(goodChallenge.data.user.mfa_enabled, true);
});

test('UC-4, UC-5, UC-6: Vault CRUD with Zero-Knowledge Encryption Enforcement', async () => {
  // Register Bob to have clean vault
  const regBob = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'bob@securevault.io',
      username: 'bob',
      fullName: 'Bob Builder',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
    },
  });
  const defaultVaultId = regBob.data.data.default_vault_id;

  const loginBob = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'bob@securevault.io', authHash: TEST_AUTH_HASH },
  });
  const bobToken = loginBob.data.token;
  const bobHeaders = { authorization: `Bearer ${bobToken}` };

  // --- UC-4: Add Item ---
  // 1. Reject unencrypted / plaintext payload
  const rejectUnencrypted = await callRouter({
    method: 'POST',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    headers: bobHeaders,
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
    headers: bobHeaders,
    body: {
      item_type: 'login',
      encrypted_data: TEST_ENCRYPTED_PAYLOAD,
      metadata: {
        title: 'Production AWS Console',
        url: 'https://aws.amazon.com',
        username_preview: 'bob_cloud',
        favorite: true,
        tags: ['cloud', 'aws'],
      },
    },
  });

  assert.equal(addItemRes.statusCode, 201);
  assert.ok(addItemRes.data.data.item_id);
  assert.equal(addItemRes.data.data.version, 1);
  const itemId = addItemRes.data.data.item_id;

  // 3. List items in vault
  const listRes = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items`,
    headers: bobHeaders,
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.data.data.length, 1);
  assert.equal(listRes.data.data[0].metadata.title, 'Production AWS Console');
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
    headers: bobHeaders,
    body: {
      version: 1, // Current version
      encrypted_data: updatedPayload,
      metadata: {
        title: 'Production AWS Console (Updated)',
        tags: ['cloud', 'aws', 'prod'],
      },
    },
  });

  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.data.data.version, 2);

  // Optimistic concurrency check: stale update with version 1 must return 409
  const conflictRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    headers: bobHeaders,
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
    headers: bobHeaders,
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
    headers: bobHeaders,
    body: { version: 1 },
  });
  assert.equal(rollbackRes.statusCode, 200);
  assert.equal(rollbackRes.data.data.version, 3);

  // Verify item now has restored ciphertext
  const getItem = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    headers: bobHeaders,
  });
  assert.equal(
    getItem.data.data.encrypted_data.ciphertext,
    TEST_ENCRYPTED_PAYLOAD.ciphertext
  );

  // --- UC-6: Delete Item ---
  const deleteRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    headers: bobHeaders,
  });
  assert.equal(deleteRes.statusCode, 200);
  assert.equal(deleteRes.data.data.item_id, itemId);

  // Verify item is gone
  const afterDelete = await callRouter({
    method: 'GET',
    path: `/api/v1/vaults/${defaultVaultId}/items/${itemId}`,
    headers: bobHeaders,
  });
  assert.equal(afterDelete.statusCode, 404);
});

test('UC-7: Password Reset Flow (OTP & New Auth Hash)', async () => {
  // 1. Request password reset
  const reqRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/reset-password/request',
    body: { email: 'bob@securevault.io' },
  });
  assert.equal(reqRes.statusCode, 200);
  const otpCode = reqRes.data.data?.debug_otp;
  assert.ok(otpCode);

  // 2. Confirm reset with wrong OTP returns 400
  const wrongOtp = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/reset-password/confirm',
    body: {
      email: 'bob@securevault.io',
      otpCode: '000000',
      newAuthHash: 'b591a6d40bf420404a011733cfb7b190d62c65bf0bcda32b57b277d9ad9f146e',
      newAuthSalt: 'newSalt1234567890==',
    },
  });
  assert.equal(wrongOtp.statusCode, 400);

  // 3. Confirm reset with valid OTP
  const NEW_HASH = '111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000';
  const NEW_SALT = 'freshNewSaltBytes32==';
  const confirmRes = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/reset-password/confirm',
    body: {
      email: 'bob@securevault.io',
      otpCode,
      newAuthHash: NEW_HASH,
      newAuthSalt: NEW_SALT,
    },
  });
  assert.equal(confirmRes.statusCode, 200);
  assert.equal(confirmRes.data.status, 'success');

  // 4. Old password hash cannot login
  const oldLogin = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'bob@securevault.io', authHash: TEST_AUTH_HASH },
  });
  assert.equal(oldLogin.statusCode, 401);

  // 5. New password hash logs in successfully
  const newLogin = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'bob@securevault.io', authHash: NEW_HASH },
  });
  assert.equal(newLogin.statusCode, 200);
  assert.ok(newLogin.data.token);
});

test('UC-10: Granular Password Sharing & Asymmetric Key Wrapping', async () => {
  // Register Charlie (recipient)
  const regCharlie = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'charlie@securevault.io',
      username: 'charlie',
      fullName: 'Charlie Delta',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
      publicKey: 'MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA_CHARLIE_PUBLIC_KEY...',
    },
  });

  const loginBob = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: {
      email: 'bob@securevault.io',
      authHash: '111122223333444455556666777788889999aaaabbbbccccddddeeeeffff0000',
    },
  });
  const bobHeaders = { authorization: `Bearer ${loginBob.data.token}` };

  const loginCharlie = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'charlie@securevault.io', authHash: TEST_AUTH_HASH },
  });
  const charlieHeaders = { authorization: `Bearer ${loginCharlie.data.token}` };

  // 1. Bob creates an item to share
  const bobItem = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    headers: bobHeaders,
    body: {
      encrypted_data: TEST_ENCRYPTED_PAYLOAD,
      metadata: { title: 'Shared Server Key' },
    },
  });
  const itemId = bobItem.data.data.item_id;

  // 2. Bob looks up Charlie public key
  const lookupRes = await callRouter({
    method: 'GET',
    path: '/api/v1/users/lookup',
    headers: bobHeaders,
    queryStringParameters: { email: 'charlie@securevault.io' },
  });
  assert.equal(lookupRes.statusCode, 200);
  assert.ok(lookupRes.data.data.public_key);

  // 3. Bob attempts to share with self (Must be rejected)
  const selfShare = await callRouter({
    method: 'POST',
    path: `/api/v1/items/${itemId}/share`,
    headers: bobHeaders,
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
    headers: bobHeaders,
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
    headers: charlieHeaders,
  });
  assert.equal(sharedList.statusCode, 200);
  assert.equal(sharedList.data.data.length, 1);
  assert.equal(sharedList.data.data[0].metadata.title, 'Shared Server Key');
  assert.equal(sharedList.data.data[0].permission_level, 'read');

  // 6. Charlie gets item directly
  const charlieGet = await callRouter({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
    headers: charlieHeaders,
  });
  assert.equal(charlieGet.statusCode, 200);
  assert.ok(charlieGet.data.data.share_info);

  // 7. Charlie cannot update (has only READ permission)
  const charlieUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/items/${itemId}`,
    headers: charlieHeaders,
    body: { metadata: { title: 'Hacked by Charlie' } },
  });
  assert.equal(charlieUpdate.statusCode, 403);

  // 8. Bob revokes share
  const revokeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/vaults/any/items/${itemId}/share/${regCharlie.data.data.user_id}`,
    headers: bobHeaders,
  });
  assert.equal(revokeRes.statusCode, 200);

  // 9. After revocation, Charlie cannot access
  const charlieDenied = await callRouter({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
    headers: charlieHeaders,
  });
  assert.equal(charlieDenied.statusCode, 403);
});

test('UC-8, UC-9, UC-12, UC-13: Security Notifications, Audit, Activity & Monitoring', async () => {
  // Register Admin User
  const regAdmin = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/register',
    body: {
      email: 'admin@securevault.io',
      username: 'admin',
      fullName: 'Super Admin',
      authHash: TEST_AUTH_HASH,
      authSalt: TEST_SALT,
      role: 'admin',
    },
  });
  assert.equal(regAdmin.statusCode, 201);

  const loginAdmin = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'admin@securevault.io', authHash: TEST_AUTH_HASH },
  });
  const adminHeaders = { authorization: `Bearer ${loginAdmin.data.token}` };

  const loginRegular = await callRouter({
    method: 'POST',
    path: '/api/v1/auth/login',
    body: { email: 'charlie@securevault.io', authHash: TEST_AUTH_HASH },
  });
  const regularHeaders = { authorization: `Bearer ${loginRegular.data.token}` };

  // --- UC-8: Security Notifications ---
  // Regular user is rejected with 403
  const userSecurityForbidden = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/security/notifications',
    headers: regularHeaders,
  });
  assert.equal(userSecurityForbidden.statusCode, 403);

  // Admin simulates security event
  const simulateRes = await callRouter({
    method: 'POST',
    path: '/api/v1/admin/security/simulate-event',
    headers: adminHeaders,
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
    headers: adminHeaders,
  });
  assert.equal(adminNotifications.statusCode, 200);
  assert.ok(adminNotifications.data.data.length >= 1);

  // --- UC-9: Admin Audit Logs (JSON & CSV Export) ---
  // Regular user rejected
  const userAuditForbidden = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    headers: regularHeaders,
  });
  assert.equal(userAuditForbidden.statusCode, 403);

  // Admin queries audit logs (JSON)
  const auditJson = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    headers: adminHeaders,
  });
  assert.equal(auditJson.statusCode, 200);
  assert.ok(auditJson.data.data.length > 0);
  assert.ok(auditJson.data.pagination.total > 0);

  // Admin exports audit logs as CSV
  const auditCsv = await callRouter({
    method: 'GET',
    path: '/api/v1/admin/audit-logs',
    headers: adminHeaders,
    queryStringParameters: { format: 'csv' },
  });
  assert.equal(auditCsv.statusCode, 200);
  assert.equal(auditCsv.headers['content-type'], 'text/csv');
  assert.ok(auditCsv.data.includes('audit_id,created_at,actor_user_id'));

  // --- UC-12: User Activity Logs ---
  const activityRes = await callRouter({
    method: 'GET',
    path: '/api/v1/user/activity-logs',
    headers: regularHeaders,
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
    headers: adminHeaders,
  });
  assert.equal(metricsRes.statusCode, 200);
  assert.equal(metricsRes.data.metrics.system_health, 'HEALTHY');
  assert.ok(metricsRes.data.metrics.uptime_seconds >= 0);
  assert.ok(metricsRes.data.metrics.inventory.total_users >= 3);
});

test('Local Simulation HTTP Server: End-to-End Live HTTP Network Parity', async () => {
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

    // 2. Live registration over HTTP
    const regRes = await fetch(`${baseUrl}/api/v1/auth/register`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'network_test@securevault.io',
        username: 'netuser',
        fullName: 'Network User',
        authHash: TEST_AUTH_HASH,
        authSalt: TEST_SALT,
      }),
    });
    assert.equal(regRes.status, 201);
    const regData = await regRes.json();
    assert.equal(regData.status, 'success');

    // 3. Live login over HTTP
    const loginRes = await fetch(`${baseUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'network_test@securevault.io',
        authHash: TEST_AUTH_HASH,
      }),
    });
    assert.equal(loginRes.status, 200);
    const loginData = await loginRes.json();
    assert.ok(loginData.token);

    // 4. Live vault item create over HTTP
    const itemRes = await fetch(`${baseUrl}/api/v1/items`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${loginData.token}`,
      },
      body: JSON.stringify({
        encrypted_data: TEST_ENCRYPTED_PAYLOAD,
        metadata: { title: 'Network Vault Item' },
      }),
    });
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
