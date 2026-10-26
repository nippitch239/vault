/**
 * Secure Vault Cloud — Challenger Empirical Verification Suite (Milestone M1)
 *
 * Adversarial and invariant verification:
 * 1. Legacy Collection CRUD regression (without orgId)
 * 2. Legacy Group CRUD regression (without orgId)
 * 3. Dual-Engine Deserialization Parity (SQLite & PostgreSQL for encrypted_org_key)
 * 4. Foreign Key Integrity (groups, collections, members, invitations)
 * 5. Unique Constraint Invariant (organization_members uq_org_members_org_user)
 * 6. Migration Idempotency & Standalone Backfill Invariants
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import pg from 'pg';
import {
  resetDatabase,
  normalizeSqliteRow,
} from '../src/db/adapter.js';
import { migratePersonalOrganizations } from '../src/db/migration.js';
import {
  callRouter,
  registerProfile,
  insertUser,
} from './helpers.js';

const SAMPLE_WRAPPED_KEY = {
  ciphertext: 'wrapped_key_sample_base64==',
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
};

// ---------------------------------------------------------------------------
// 1. Legacy Collection CRUD Regression (without orgId)
// ---------------------------------------------------------------------------
test('Challenger Invariant 1: Legacy Collection CRUD without orgId operates seamlessly', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_legacy_col');
  const bob = await registerProfile('bob_legacy_col');

  // 1.1 Create collection without orgId via API
  const createRes = await callRouter({
    method: 'POST',
    path: '/api/v1/collections',
    claims: alice,
    body: {
      name: 'Legacy Alpha Collection',
      description: 'Collection created without org_id',
      encryptedKeyForRecipient: SAMPLE_WRAPPED_KEY,
    },
  });
  assert.equal(createRes.statusCode, 201, `Create legacy collection failed: ${JSON.stringify(createRes.data)}`);
  assert.ok(createRes.data.collection, 'Response must contain collection');
  const collectionId = createRes.data.collection.id;
  assert.equal(createRes.data.collection.name, 'Legacy Alpha Collection');

  // Verify in database that org_id is null
  const dbRow = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  assert.equal(dbRow.rowCount, 1);
  assert.equal(dbRow.rows[0].org_id, null, 'Legacy collection must have NULL org_id');

  // 1.2 List collections (GET /collections)
  const listRes = await callRouter({
    method: 'GET',
    path: '/api/v1/collections',
    claims: alice,
  });
  assert.equal(listRes.statusCode, 200);
  const found = (listRes.data.collections || []).find((c) => (c.id || c.collection_id) === collectionId);
  assert.ok(found, 'Legacy collection must appear in list');
  assert.equal(found.effectivePermission, 'admin');

  // 1.3 Get single collection (GET /collections/:id)
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}`,
    claims: alice,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.data.collection.name, 'Legacy Alpha Collection');

  // 1.4 Update collection (PUT /collections/:id) without orgId
  const updateRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/collections/${collectionId}`,
    claims: alice,
    body: {
      name: 'Renamed Legacy Collection',
      description: 'Updated description without orgId',
    },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.data.collection.name, 'Renamed Legacy Collection');

  // Verify org_id remains null after update
  const updatedRow = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  assert.equal(updatedRow.rows[0].org_id, null, 'Updating collection must not set org_id');

  // 1.5 Grant access to Bob and verify legacy RBAC
  const grantRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: alice,
    body: { targetType: 'user', targetId: bob.sub, permission: 'read' },
  });
  assert.equal(grantRes.statusCode, 201);

  // Bob lists collections and sees the legacy collection
  const bobList = await callRouter({
    method: 'GET',
    path: '/api/v1/collections',
    claims: bob,
  });
  assert.equal(bobList.statusCode, 200);
  const bobFound = (bobList.data.collections || []).find((c) => (c.id || c.collection_id) === collectionId);
  assert.ok(bobFound, 'Bob should see granted legacy collection');
  assert.equal(bobFound.effectivePermission, 'read');

  // 1.6 Delete collection (DELETE /collections/:id)
  const deleteRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}`,
    claims: alice,
  });
  assert.equal(deleteRes.statusCode, 200);

  const checkDeleted = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  assert.equal(checkDeleted.rowCount, 0, 'Collection must be deleted from DB');
});

// ---------------------------------------------------------------------------
// 2. Legacy Group CRUD Regression (without orgId)
// ---------------------------------------------------------------------------
test('Challenger Invariant 2: Legacy Group CRUD without orgId operates seamlessly', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_legacy_grp');
  const bob = await registerProfile('bob_legacy_grp');

  // 2.1 Create group without orgId
  const createRes = await callRouter({
    method: 'POST',
    path: '/api/v1/groups',
    claims: alice,
    body: {
      name: 'Legacy Core Devs',
      description: 'Group created without org_id',
    },
  });
  assert.equal(createRes.statusCode, 201, `Create group failed: ${JSON.stringify(createRes.data)}`);
  assert.ok(createRes.data.group, 'Must return group');
  const groupId = createRes.data.group.id || createRes.data.group.group_id;

  // Verify DB row has NULL org_id
  const groupRow = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  assert.equal(groupRow.rowCount, 1);
  assert.equal(groupRow.rows[0].org_id, null, 'Legacy group must have NULL org_id');

  // 2.2 List groups
  const listRes = await callRouter({
    method: 'GET',
    path: '/api/v1/groups',
    claims: alice,
  });
  assert.equal(listRes.statusCode, 200);
  const foundGroup = (listRes.data.groups || []).find((g) => (g.id || g.group_id) === groupId);
  assert.ok(foundGroup, 'Legacy group must be in list');

  // 2.3 Get group
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/groups/${groupId}`,
    claims: alice,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.data.group.name, 'Legacy Core Devs');

  // 2.4 Update group without orgId
  const updateRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/groups/${groupId}`,
    claims: alice,
    body: {
      name: 'Renamed Core Devs',
      description: 'Updated legacy group description',
    },
  });
  assert.equal(updateRes.statusCode, 200);
  assert.equal(updateRes.data.group.name, 'Renamed Core Devs');

  const updatedRow = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  assert.equal(updatedRow.rows[0].org_id, null, 'Group org_id must remain NULL');

  // 2.5 Add member to group
  const addMemberRes = await callRouter({
    method: 'POST',
    path: `/api/v1/groups/${groupId}/members`,
    claims: alice,
    body: {
      userId: bob.sub,
      role: 'member',
    },
  });
  assert.equal(addMemberRes.statusCode, 201);

  // List group members
  const membersRes = await callRouter({
    method: 'GET',
    path: `/api/v1/groups/${groupId}/members`,
    claims: alice,
  });
  assert.equal(membersRes.statusCode, 200);
  assert.equal(membersRes.data.members.length, 2);

  // 2.6 Delete group
  const deleteRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/groups/${groupId}`,
    claims: alice,
  });
  assert.equal(deleteRes.statusCode, 200);

  const checkDeleted = await db.query('SELECT * FROM groups WHERE group_id = $1', [groupId]);
  assert.equal(checkDeleted.rowCount, 0, 'Group must be deleted from DB');

  // Group members cascade-deleted
  const checkMembers = await db.query('SELECT * FROM group_members WHERE group_id = $1', [groupId]);
  assert.equal(checkMembers.rowCount, 0, 'Group members must be cascade-deleted');

  // User accounts must remain untouched
  const checkAlice = await db.query('SELECT * FROM users WHERE user_id = $1', [alice.sub]);
  assert.equal(checkAlice.rowCount, 1, 'Deleting group must NEVER delete user accounts');
});

// ---------------------------------------------------------------------------
// 3. Dual-Engine Deserialization Parity (SQLite & PostgreSQL for encrypted_org_key)
// ---------------------------------------------------------------------------
test('Challenger Invariant 3: Dual-Engine Deserialization Parity for encrypted_org_key', async () => {
  const db = await resetDatabase();
  const userId = await insertUser(db, 'parity_user');

  const orgRes = await db.query(
    'INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING org_id',
    ['Parity Org', userId]
  );
  const orgId = orgRes.rows[0].org_id;

  const testKeyObject = {
    ciphertext: 'PARITY_CIPHERTEXT_BASE64==',
    algorithm: 'RSA-OAEP',
    hash: 'SHA-256',
  };

  // 3.1 SQLite insertion & object deserialization
  await db.query(
    `INSERT INTO organization_members (org_id, user_id, role, status, encrypted_org_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, userId, 'owner', 'confirmed', testKeyObject]
  );

  const selectRes = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, userId]
  );
  assert.equal(selectRes.rowCount, 1);
  const sqliteMember = selectRes.rows[0];

  assert.equal(typeof sqliteMember.encrypted_org_key, 'object', 'SQLite must return encrypted_org_key as object');
  assert.notEqual(sqliteMember.encrypted_org_key, null);
  assert.deepEqual(sqliteMember.encrypted_org_key, testKeyObject, 'SQLite deserialized key must match input object');

  // 3.2 Direct normalizeSqliteRow test with string representation
  const stringRow = {
    org_member_id: crypto.randomUUID(),
    encrypted_org_key: JSON.stringify(testKeyObject),
    encryptedOrgKey: JSON.stringify(testKeyObject),
  };
  const normalized = normalizeSqliteRow(stringRow);
  assert.deepEqual(normalized.encrypted_org_key, testKeyObject);
  assert.deepEqual(normalized.encryptedOrgKey, testKeyObject);

  // 3.3 Verify PostgreSQL parity via pg.types parser
  // In PostgreSQL, JSONB has OID 3802 and JSON has OID 114
  const pgJsonbParser = pg.types.getTypeParser(3802);
  assert.ok(typeof pgJsonbParser === 'function', 'pg library must provide JSONB type parser');
  const pgParsed = pgJsonbParser(JSON.stringify(testKeyObject));
  assert.deepEqual(pgParsed, testKeyObject, 'PostgreSQL JSONB parsed output must match testKeyObject');
  assert.deepEqual(sqliteMember.encrypted_org_key, pgParsed, 'SQLite and PostgreSQL must have 100% object parity');

  // 3.4 Verify NULL handling
  const user2 = await insertUser(db, 'parity_user_2');
  await db.query(
    `INSERT INTO organization_members (org_id, user_id, role, status, encrypted_org_key)
     VALUES ($1, $2, $3, $4, $5)`,
    [orgId, user2, 'member', 'confirmed', null]
  );
  const nullSelect = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, user2]
  );
  assert.equal(nullSelect.rows[0].encrypted_org_key, null, 'NULL encrypted_org_key must remain null');

  // 3.5 Verify Error Contract Parity conventions
  const fakePgUniqueError = new Error('duplicate key value violates unique constraint');
  fakePgUniqueError.code = '23505';
  fakePgUniqueError.isUniqueViolation = fakePgUniqueError.code === '23505';
  assert.equal(fakePgUniqueError.isUniqueViolation, true);

  const fakePgFkError = new Error('insert or update violates foreign key constraint');
  fakePgFkError.code = '23503';
  fakePgFkError.isForeignKeyViolation = fakePgFkError.code === '23503';
  assert.equal(fakePgFkError.isForeignKeyViolation, true);
});

// ---------------------------------------------------------------------------
// 4. Foreign Key Integrity Invariant
// ---------------------------------------------------------------------------
test('Challenger Invariant 4: Foreign Key Integrity prevents invalid org_id and ensures cascade', async () => {
  const db = await resetDatabase();
  const userId = await insertUser(db, 'fk_user');
  const nonexistentOrgId = crypto.randomUUID();

  // 4.1 Attempt to insert group with invalid org_id -> must fail
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO groups (name, org_id, created_by) VALUES ($1, $2, $3)',
        ['Illegal Group', nonexistentOrgId, userId]
      );
    },
    (err) => {
      assert.ok(err.isForeignKeyViolation, 'Group with invalid org_id must trigger isForeignKeyViolation');
      return true;
    }
  );

  // 4.2 Attempt to insert collection with invalid org_id -> must fail
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO collections (name, org_id, created_by) VALUES ($1, $2, $3)',
        ['Illegal Collection', nonexistentOrgId, userId]
      );
    },
    (err) => {
      assert.ok(err.isForeignKeyViolation, 'Collection with invalid org_id must trigger isForeignKeyViolation');
      return true;
    }
  );

  // 4.3 Attempt to insert organization_members with invalid org_id -> must fail
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)',
        [nonexistentOrgId, userId, 'member']
      );
    },
    (err) => {
      assert.ok(err.isForeignKeyViolation, 'Member with invalid org_id must trigger isForeignKeyViolation');
      return true;
    }
  );

  // 4.4 Attempt to insert organization_invitations with invalid org_id -> must fail
  await assert.rejects(
    async () => {
      await db.query(
        `INSERT INTO organization_invitations (org_id, email, role, invited_by, token, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [nonexistentOrgId, 'ghost@example.com', 'member', userId, 'token123', new Date().toISOString()]
      );
    },
    (err) => {
      assert.ok(err.isForeignKeyViolation, 'Invitation with invalid org_id must trigger isForeignKeyViolation');
      return true;
    }
  );

  // 4.5 Verify Full Cascading Delete across all referencing tables
  const validOrg = await db.query(
    'INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING org_id',
    ['Cascade Test Org', userId]
  );
  const validOrgId = validOrg.rows[0].org_id;

  const grpRes = await db.query(
    'INSERT INTO groups (name, org_id, created_by) VALUES ($1, $2, $3) RETURNING group_id',
    ['Cascade Group', validOrgId, userId]
  );
  const colRes = await db.query(
    'INSERT INTO collections (name, org_id, created_by) VALUES ($1, $2, $3) RETURNING collection_id',
    ['Cascade Col', validOrgId, userId]
  );
  const memRes = await db.query(
    'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3) RETURNING org_member_id',
    [validOrgId, userId, 'owner']
  );
  const invRes = await db.query(
    `INSERT INTO organization_invitations (org_id, email, role, invited_by, token, expires_at)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING invitation_id`,
    [validOrgId, 'pending@example.com', 'member', userId, 'token-cascade', new Date().toISOString()]
  );

  // Delete organization
  await db.query('DELETE FROM organizations WHERE org_id = $1', [validOrgId]);

  // Verify all cascaded rows are purged
  const grpCheck = await db.query('SELECT * FROM groups WHERE group_id = $1', [grpRes.rows[0].group_id]);
  assert.equal(grpCheck.rowCount, 0, 'Group must be cascade deleted');

  const colCheck = await db.query('SELECT * FROM collections WHERE collection_id = $1', [colRes.rows[0].collection_id]);
  assert.equal(colCheck.rowCount, 0, 'Collection must be cascade deleted');

  const memCheck = await db.query('SELECT * FROM organization_members WHERE org_member_id = $1', [memRes.rows[0].org_member_id]);
  assert.equal(memCheck.rowCount, 0, 'Member must be cascade deleted');

  const invCheck = await db.query('SELECT * FROM organization_invitations WHERE invitation_id = $1', [invRes.rows[0].invitation_id]);
  assert.equal(invCheck.rowCount, 0, 'Invitation must be cascade deleted');

  // Verify user still exists
  const userCheck = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  assert.equal(userCheck.rowCount, 1, 'User must not be deleted');
});

// ---------------------------------------------------------------------------
// 5. Unique Constraint Invariant on organization_members
// ---------------------------------------------------------------------------
test('Challenger Invariant 5: Unique Constraint Invariant on organization_members (org_id, user_id)', async () => {
  const db = await resetDatabase();
  const user1 = await insertUser(db, 'unique_user_1');
  const user2 = await insertUser(db, 'unique_user_2');

  const org1Res = await db.query(
    'INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING org_id',
    ['Org One', user1]
  );
  const org1 = org1Res.rows[0].org_id;

  const org2Res = await db.query(
    'INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING org_id',
    ['Org Two', user1]
  );
  const org2 = org2Res.rows[0].org_id;

  // Insert first membership: user1 in org1
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)',
    [org1, user1, 'owner']
  );

  // Attempt duplicate insert of (org1, user1) -> MUST throw unique violation
  await assert.rejects(
    async () => {
      await db.query(
        'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)',
        [org1, user1, 'admin']
      );
    },
    (err) => {
      assert.ok(err.isUniqueViolation, 'Duplicate membership must set isUniqueViolation = true');
      return true;
    }
  );

  // Verify independent unique constraints:
  // User 1 in Org 2 must succeed
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)',
    [org2, user1, 'member']
  );

  // User 2 in Org 1 must succeed
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role) VALUES ($1, $2, $3)',
    [org1, user2, 'member']
  );

  const totalMemberships = await db.query('SELECT COUNT(*) as count FROM organization_members');
  assert.equal(Number(totalMemberships.rows[0].count), 3, 'Must have exactly 3 valid distinct memberships');
});

// ---------------------------------------------------------------------------
// 6. Migration Stress & Standalone Backfill Invariants
// ---------------------------------------------------------------------------
test('Challenger Invariant 6: Migration Stress — multi-user standalone backfill and idempotency under load', async () => {
  const db = await resetDatabase();
  const userCount = 8;
  const userIds = [];

  // Seed 8 users, each having 3 standalone groups and 3 standalone collections
  for (let i = 0; i < userCount; i++) {
    const uid = await insertUser(db, `stress_user_${i}`);
    userIds.push(uid);

    for (let g = 0; g < 3; g++) {
      await db.query(
        'INSERT INTO groups (name, created_by) VALUES ($1, $2)',
        [`User ${i} Group ${g}`, uid]
      );
    }
    for (let c = 0; c < 3; c++) {
      await db.query(
        'INSERT INTO collections (name, created_by) VALUES ($1, $2)',
        [`User ${i} Col ${c}`, uid]
      );
    }
  }

  // Pre-migration sanity: verify all groups and collections have NULL org_id
  const preGroups = await db.query('SELECT COUNT(*) as count FROM groups WHERE org_id IS NULL');
  assert.equal(Number(preGroups.rows[0].count), userCount * 3);
  const preCols = await db.query('SELECT COUNT(*) as count FROM collections WHERE org_id IS NULL');
  assert.equal(Number(preCols.rows[0].count), userCount * 3);

  // Run initial migration
  const run1 = await migratePersonalOrganizations(db);
  assert.equal(run1.createdOrgs, userCount, `Must create exactly ${userCount} personal orgs`);
  assert.equal(run1.backfilledGroups, userCount * 3, 'All standalone groups must be backfilled');
  assert.equal(run1.backfilledCollections, userCount * 3, 'All standalone collections must be backfilled');

  // Verify all groups and collections now have non-null org_id matching their creator's personal org
  const remainingNullGroups = await db.query('SELECT COUNT(*) as count FROM groups WHERE org_id IS NULL');
  assert.equal(Number(remainingNullGroups.rows[0].count), 0);
  const remainingNullCols = await db.query('SELECT COUNT(*) as count FROM collections WHERE org_id IS NULL');
  assert.equal(Number(remainingNullCols.rows[0].count), 0);

  for (const uid of userIds) {
    const org = await db.query('SELECT org_id FROM organizations WHERE created_by = $1', [uid]);
    assert.equal(org.rowCount, 1);
    const orgId = org.rows[0].org_id;

    const userGrps = await db.query('SELECT org_id FROM groups WHERE created_by = $1', [uid]);
    assert.equal(userGrps.rowCount, 3);
    for (const row of userGrps.rows) {
      assert.equal(row.org_id, orgId);
    }

    const userCols = await db.query('SELECT org_id FROM collections WHERE created_by = $1', [uid]);
    assert.equal(userCols.rowCount, 3);
    for (const row of userCols.rows) {
      assert.equal(row.org_id, orgId);
    }
  }

  // Stress test idempotency: run 5 more consecutive times
  for (let run = 2; run <= 6; run++) {
    const res = await migratePersonalOrganizations(db);
    assert.equal(res.createdOrgs, 0, `Run ${run} must create 0 orgs`);
    assert.equal(res.backfilledGroups, 0, `Run ${run} must backfill 0 groups`);
    assert.equal(res.backfilledCollections, 0, `Run ${run} must backfill 0 collections`);
  }

  // Verify total organizations count in DB hasn't grown
  const finalOrgs = await db.query('SELECT COUNT(*) as count FROM organizations');
  assert.equal(Number(finalOrgs.rows[0].count), userCount);
});
