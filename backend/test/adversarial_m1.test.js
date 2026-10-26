/**
 * Secure Vault Cloud — Milestone M1 Empirical Adversarial & Stress Testing Suite
 *
 * Verifies the database schema, SQLite adapter parity, and idempotent personal
 * organization migration against adversarial conditions:
 * 1. High Volume & Concurrency / Rapid Sequential Execution (100 users, hundreds of groups/collections)
 * 2. Malicious & Boundary Inputs (SQL injection, Unicode/emojis, boundary lengths, null/empty)
 * 3. Schema Mutation & Legacy SQLite Database Upgrade
 * 4. Deep Deletion Cascades & Non-Regression Invariants (Users & Vault Items preserved)
 * 5. Resource Attribution & Multi-Org Ownership Priority Oracles
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  resetDatabase,
  SqliteDatabase,
  initSchema,
  readSchema,
  pgToSqliteSchema,
} from '../src/db/adapter.js';
import { migratePersonalOrganizations } from '../src/db/migration.js';
import { insertUser, TEST_ENCRYPTED_PAYLOAD, TEST_SALT } from './helpers.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

// =============================================================================
// CHALLENGE 1: High Volume (100 Users) & Rapid Sequential / Concurrency Stress
// =============================================================================

test('Adversarial M1: High volume (100 users) stress test with mixed ownership, groups & collections', async () => {
  const db = await resetDatabase();

  const userIds = [];
  const TOTAL_USERS = 100;

  // 1. Create 100 users
  for (let i = 0; i < TOTAL_USERS; i++) {
    const uid = crypto.randomUUID();
    const username = `stress_user_${i}`;
    const fullName = i % 2 === 0 ? `Stress User ${i}` : '';
    await db.query(
      `INSERT INTO users (user_id, email, username, full_name, kdf_salt, public_key, encrypted_private_key, encrypted_vault_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uid, `${username}@example.com`, username, fullName, TEST_SALT, 'pk', TEST_ENCRYPTED_PAYLOAD, TEST_ENCRYPTED_PAYLOAD]
    );
    userIds.push(uid);
  }

  // 2. Pre-seed organizations for Users 0..29 (30 users already own an org)
  // Users 0..9 will own TWO organizations
  const preExistingOrgs = [];
  for (let i = 0; i < 30; i++) {
    const orgId = crypto.randomUUID();
    const isDefaultDesc = i === 0; // User 0 has a pre-existing "Default personal organization"
    const desc = isDefaultDesc ? 'Default personal organization' : `Enterprise Org ${i}`;
    await db.query(
      `INSERT INTO organizations (org_id, name, description, created_by, status)
       VALUES ($1, $2, $3, $4, 'active')`,
      [orgId, `Pre-seeded Org ${i}`, desc, userIds[i]]
    );
    await db.query(
      `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status)
       VALUES ($1, $2, $3, 'owner', 'confirmed')`,
      [crypto.randomUUID(), orgId, userIds[i]]
    );
    preExistingOrgs.push(orgId);

    if (i < 10) {
      const secondOrgId = crypto.randomUUID();
      await db.query(
        `INSERT INTO organizations (org_id, name, description, created_by, status)
         VALUES ($1, $2, $3, $4, 'active')`,
        [secondOrgId, `Secondary Org ${i}`, `Secondary Org Description ${i}`, userIds[i]]
      );
      await db.query(
        `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status)
         VALUES ($1, $2, $3, 'owner', 'confirmed')`,
        [crypto.randomUUID(), secondOrgId, userIds[i]]
      );
    }
  }

  // 3. Users 30..59 are non-owner members in User 0's pre-existing org
  for (let i = 30; i < 60; i++) {
    await db.query(
      `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status)
       VALUES ($1, $2, $3, 'member', 'confirmed')`,
      [crypto.randomUUID(), preExistingOrgs[0], userIds[i]]
    );
  }
  // Users 60..99 have NO organization memberships at all.

  // 4. Create 150 standalone groups distributed across random users
  let expectedStandaloneGroups = 0;
  for (let g = 0; g < 150; g++) {
    const creator = userIds[g % TOTAL_USERS];
    await db.query(
      `INSERT INTO groups (name, description, created_by, org_id)
       VALUES ($1, $2, $3, NULL)`,
      [`Standalone Group ${g}`, `Desc ${g}`, creator]
    );
    expectedStandaloneGroups++;
  }

  // 5. Create 150 standalone collections distributed across random users
  let expectedStandaloneCols = 0;
  for (let c = 0; c < 150; c++) {
    const creator = userIds[c % TOTAL_USERS];
    await db.query(
      `INSERT INTO collections (name, description, created_by, org_id)
       VALUES ($1, $2, $3, NULL)`,
      [`Standalone Collection ${c}`, `Desc ${c}`, creator]
    );
    expectedStandaloneCols++;
  }

  // 6. Create 50 ALREADY-ASSIGNED groups and collections (must NOT be touched)
  for (let a = 0; a < 50; a++) {
    const creator = userIds[a % 30]; // creator from owners
    const targetOrg = preExistingOrgs[a % preExistingOrgs.length];
    await db.query(
      `INSERT INTO groups (name, description, created_by, org_id)
       VALUES ($1, $2, $3, $4)`,
      [`Assigned Group ${a}`, `Desc ${a}`, creator, targetOrg]
    );
    await db.query(
      `INSERT INTO collections (name, description, created_by, org_id)
       VALUES ($1, $2, $3, $4)`,
      [`Assigned Collection ${a}`, `Desc ${a}`, creator, targetOrg]
    );
  }

  // Expected calculations:
  // 30 users already own at least one org -> 0 new orgs needed for them
  // 30 users are non-owners in an org -> 30 new personal orgs needed for them
  // 40 users have 0 orgs -> 40 new personal orgs needed for them
  // Total expected orgs created = 30 + 40 = 70.
  const expectedNewOrgs = 70;

  // Run 1: Primary migration execution
  const res1 = await migratePersonalOrganizations(db);
  assert.equal(res1.createdOrgs, expectedNewOrgs, `Must create exactly ${expectedNewOrgs} personal orgs`);
  assert.equal(res1.backfilledGroups, expectedStandaloneGroups, `Must backfill all ${expectedStandaloneGroups} groups`);
  assert.equal(res1.backfilledCollections, expectedStandaloneCols, `Must backfill all ${expectedStandaloneCols} collections`);
  assert.ok(res1.durationMs >= 0);

  // Verification Oracle: Zero unassigned groups or collections remain
  const unassignedGroups = await db.query('SELECT COUNT(*) as cnt FROM groups WHERE org_id IS NULL');
  assert.equal(Number(unassignedGroups.rows[0].cnt), 0, 'Zero unassigned groups allowed');

  const unassignedCols = await db.query('SELECT COUNT(*) as cnt FROM collections WHERE org_id IS NULL');
  assert.equal(Number(unassignedCols.rows[0].cnt), 0, 'Zero unassigned collections allowed');

  // Verification Oracle: Every user now owns at least one organization
  for (const uid of userIds) {
    const ownership = await db.query(
      `SELECT COUNT(*) as cnt FROM organization_members om
       WHERE om.user_id = $1 AND om.role = 'owner'`,
      [uid]
    );
    assert.ok(Number(ownership.rows[0].cnt) >= 1, `User ${uid} must own at least one organization`);
  }

  // Verification Oracle: Every backfilled group's org_id belongs to an organization owned by the creator
  const allGroups = await db.query('SELECT group_id, created_by, org_id FROM groups');
  for (const row of allGroups.rows) {
    assert.ok(row.org_id, 'Group org_id must not be null');
    const ownerCheck = await db.query(
      `SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2`,
      [row.org_id, row.created_by]
    );
    assert.ok(ownerCheck.rowCount >= 1, 'Group creator must be a member of the assigned org');
  }

  // Record baseline counts
  const totalOrgsBefore = Number((await db.query('SELECT COUNT(*) as cnt FROM organizations')).rows[0].cnt);
  const totalMembersBefore = Number((await db.query('SELECT COUNT(*) as cnt FROM organization_members')).rows[0].cnt);

  // Rapid Sequential Stress: Run 5 times in rapid succession
  for (let run = 2; run <= 6; run++) {
    const sequentialRes = await migratePersonalOrganizations(db);
    assert.equal(sequentialRes.createdOrgs, 0, `Run ${run}: must create 0 orgs`);
    assert.equal(sequentialRes.backfilledGroups, 0, `Run ${run}: must backfill 0 groups`);
    assert.equal(sequentialRes.backfilledCollections, 0, `Run ${run}: must backfill 0 collections`);
  }

  // Confirm row counts are 100% stable
  const totalOrgsAfter = Number((await db.query('SELECT COUNT(*) as cnt FROM organizations')).rows[0].cnt);
  const totalMembersAfter = Number((await db.query('SELECT COUNT(*) as cnt FROM organization_members')).rows[0].cnt);
  assert.equal(totalOrgsAfter, totalOrgsBefore, 'Total organizations count must remain strictly invariant');
  assert.equal(totalMembersAfter, totalMembersBefore, 'Total members count must remain strictly invariant');
});

test('Adversarial M1: Transactional integrity under concurrent execution attempts', async () => {
  const db = await resetDatabase();
  const uid = await insertUser(db, 'concurrency_user');
  await db.query('INSERT INTO groups (name, created_by) VALUES ($1, $2)', ['Group 1', uid]);

  // Attempt concurrent execution
  const results = await Promise.allSettled([
    migratePersonalOrganizations(db),
    migratePersonalOrganizations(db),
  ]);

  // Check results: At least one succeeded, and the final state has exactly 1 organization for uid
  const fulfilled = results.filter((r) => r.status === 'fulfilled');
  assert.ok(fulfilled.length >= 1, 'At least one migration transaction must complete');

  const orgs = await db.query('SELECT * FROM organizations WHERE created_by = $1', [uid]);
  assert.equal(orgs.rowCount, 1, 'Must have exactly 1 organization created, no duplicates');

  const groups = await db.query('SELECT * FROM groups WHERE created_by = $1', [uid]);
  assert.equal(groups.rows[0].org_id, orgs.rows[0].org_id, 'Group must be linked to the single created org');
});

// =============================================================================
// CHALLENGE 2: Malicious & Boundary Inputs
// =============================================================================

test('Adversarial M1: Malicious & boundary inputs (SQL injection, Unicode, 255 chars, nulls)', async () => {
  const db = await resetDatabase();

  const testCases = [
    {
      label: 'SQL injection in full_name',
      username: 'sqli_user1',
      fullName: "'; DROP TABLE users; --",
      expectedOrgName: "'; DROP TABLE users; --'s Personal Organization",
    },
    {
      label: 'SQL injection with quotes and UNION in full_name',
      username: 'sqli_user2',
      fullName: "' UNION SELECT 1, 'injected', 3, 4, 5, 6, 7 --",
      expectedOrgName: "' UNION SELECT 1, 'injected', 3, 4, 5, 6, 7 --'s Personal Organization",
    },
    {
      label: 'Unicode emojis and complex graphemes',
      username: 'unicode_user',
      fullName: '🔑 🛡️ 🚀 👨‍👩‍👧‍👦 テスト',
      expectedOrgName: '🔑 🛡️ 🚀 👨‍👩‍👧‍👦 テスト\'s Personal Organization',
    },
    {
      label: 'RTL and zero-width characters',
      username: 'rtl_user',
      fullName: 'مرحبا\u200B\u200E\uFEFF',
      expectedOrgName: 'مرحبا\u200B\u200E\'s Personal Organization',
    },
    {
      label: 'HTML and Script tags',
      username: 'xss_user',
      fullName: '<script>alert("pwnd")</script>',
      expectedOrgName: '<script>alert("pwnd")</script>\'s Personal Organization',
    },
    {
      label: 'Empty string full_name (fallback to username)',
      username: 'empty_fn_user',
      fullName: '',
      expectedOrgName: "empty_fn_user's Personal Organization",
    },
    {
      label: 'Whitespace-only full_name (fallback to username)',
      username: 'whitespace_fn_user',
      fullName: '   \t  \n  ',
      expectedOrgName: "whitespace_fn_user's Personal Organization",
    },
    {
      label: 'Boundary 200 characters string',
      username: 'boundary_user',
      fullName: 'A'.repeat(200),
      expectedOrgName: `${'A'.repeat(200)}'s Personal Organization`,
    },
  ];

  for (const tc of testCases) {
    const uid = crypto.randomUUID();
    await db.query(
      `INSERT INTO users (user_id, email, username, full_name, kdf_salt, public_key, encrypted_private_key, encrypted_vault_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [uid, `${tc.username}@example.com`, tc.username, tc.fullName, TEST_SALT, 'pk', TEST_ENCRYPTED_PAYLOAD, TEST_ENCRYPTED_PAYLOAD]
    );

    await db.query('INSERT INTO groups (name, created_by) VALUES ($1, $2)', [`${tc.username}_group`, uid]);
    await db.query('INSERT INTO collections (name, created_by) VALUES ($1, $2)', [`${tc.username}_col`, uid]);
  }

  // Run migration
  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, testCases.length);
  assert.equal(res.backfilledGroups, testCases.length);
  assert.equal(res.backfilledCollections, testCases.length);

  // Verify database schema intact (users table NOT dropped by SQL injection!)
  const usersCheck = await db.query('SELECT COUNT(*) as cnt FROM users');
  assert.equal(Number(usersCheck.rows[0].cnt), testCases.length);

  // Verify each test case generated the expected organization name
  for (const tc of testCases) {
    const orgRes = await db.query(
      `SELECT o.name, o.description, om.role
       FROM organizations o
       JOIN organization_members om ON om.org_id = o.org_id
       JOIN users u ON u.user_id = o.created_by
       WHERE u.username = $1`,
      [tc.username]
    );
    assert.equal(orgRes.rowCount, 1, `Org must exist for ${tc.username}`);
    assert.equal(orgRes.rows[0].name, tc.expectedOrgName, `Org name mismatch for ${tc.label}`);
    assert.equal(orgRes.rows[0].description, 'Default personal organization');
    assert.equal(orgRes.rows[0].role, 'owner');
  }
});

// =============================================================================
// CHALLENGE 3: Schema Mutation & Legacy SQLite Database Upgrade
// =============================================================================

test('Adversarial M1: Schema upgrade of simulated legacy SQLite file with missing columns & indices', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-legacy-test-'));
  const dbFile = path.join(tmpDir, 'legacy.sqlite');

  try {
    // 1. Synthesize a legacy schema WITHOUT organizations, organization_members, or org_id
    const ddl = readSchema();
    const legacyDdl = pgToSqliteSchema(ddl)
      .replace(/CREATE TABLE IF NOT EXISTS organizations[\s\S]*?;\n\n/gi, '')
      .replace(/CREATE TABLE IF NOT EXISTS organization_members[\s\S]*?;\n\n/gi, '')
      .replace(/CREATE TABLE IF NOT EXISTS organization_invitations[\s\S]*?;\n\n/gi, '')
      .replace(/org_id UUID DEFAULT NULL,\r?\n/gi, '')
      .replace(/CONSTRAINT fk_groups_org[^\n]*\r?\n/gi, '')
      .replace(/CONSTRAINT fk_collections_org[^\n]*\r?\n/gi, '')
      .replace(/CREATE INDEX IF NOT EXISTS idx_groups_org_id[^\n]*\r?\n/gi, '')
      .replace(/CREATE INDEX IF NOT EXISTS idx_collections_org_id[^\n]*\r?\n/gi, '')
      .replace(/CREATE INDEX IF NOT EXISTS idx_organizations[^\n]*\r?\n/gi, '')
      .replace(/CREATE INDEX IF NOT EXISTS idx_org_members[^\n]*\r?\n/gi, '')
      .replace(/CREATE INDEX IF NOT EXISTS idx_org_invitations[^\n]*\r?\n/gi, '');

    // 2. Open legacy database directly with raw DatabaseSync and insert legacy records
    const rawDb = new DatabaseSync(dbFile);
    rawDb.function('gen_random_uuid', () => crypto.randomUUID());
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec(legacyDdl);

    // Verify org_id column does NOT exist in legacy groups/collections
    const legacyGroupCols = rawDb.prepare('PRAGMA table_info(groups)').all().map((c) => c.name);
    assert.ok(!legacyGroupCols.includes('org_id'), 'Legacy groups must not have org_id');

    // Seed 3 legacy users
    const legacyUids = [];
    for (let i = 1; i <= 3; i++) {
      const uid = crypto.randomUUID();
      legacyUids.push(uid);
      rawDb.prepare(
        `INSERT INTO users (user_id, email, username, full_name, kdf_salt, public_key, encrypted_private_key, encrypted_vault_key)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        uid,
        `legacy${i}@example.com`,
        `legacy_user_${i}`,
        `Legacy User ${i}`,
        TEST_SALT,
        'pk',
        JSON.stringify(TEST_ENCRYPTED_PAYLOAD),
        JSON.stringify(TEST_ENCRYPTED_PAYLOAD)
      );

      // Legacy vault & vault item
      const vaultId = crypto.randomUUID();
      rawDb.prepare('INSERT INTO vaults (vault_id, user_id, name) VALUES (?, ?, ?)').run(vaultId, uid, 'Legacy Vault');
      rawDb.prepare(
        'INSERT INTO vault_items (item_id, vault_id, user_id, encrypted_data, metadata) VALUES (?, ?, ?, ?, ?)'
      ).run(crypto.randomUUID(), vaultId, uid, JSON.stringify(TEST_ENCRYPTED_PAYLOAD), JSON.stringify({ title: `Item ${i}` }));

      // Legacy standalone groups & collections (without org_id)
      rawDb.prepare('INSERT INTO groups (name, created_by) VALUES (?, ?)').run(`Legacy Group ${i}`, uid);
      rawDb.prepare('INSERT INTO collections (name, created_by) VALUES (?, ?)').run(`Legacy Col ${i}`, uid);
    }

    rawDb.close();

    // 3. Open with SqliteDatabase and run initSchema
    const upgradedDb = new SqliteDatabase(dbFile);
    await upgradedDb.ready;

    // Verify pre-DDL upgrade injected org_id column
    const upgradedGroupCols = upgradedDb.db.prepare('PRAGMA table_info(groups)').all().map((c) => c.name);
    const upgradedColCols = upgradedDb.db.prepare('PRAGMA table_info(collections)').all().map((c) => c.name);
    assert.ok(upgradedGroupCols.includes('org_id'), 'Upgraded groups must have org_id');
    assert.ok(upgradedColCols.includes('org_id'), 'Upgraded collections must have org_id');

    // Run initSchema which executes migration
    const stats = await initSchema(upgradedDb);
    assert.equal(stats.createdOrgs, 3, 'Must create personal org for all 3 legacy users');
    assert.equal(stats.backfilledGroups, 3, 'Must backfill all 3 legacy groups');
    assert.equal(stats.backfilledCollections, 3, 'Must backfill all 3 legacy collections');

    // Check all legacy groups have valid org_id
    const groupsCheck = await upgradedDb.query('SELECT group_id, org_id, created_by FROM groups');
    for (const g of groupsCheck.rows) {
      assert.ok(g.org_id, 'Every legacy group must have an assigned org_id');
    }

    // Verify vault items were completely untouched
    const vaultItems = await upgradedDb.query('SELECT COUNT(*) as cnt FROM vault_items');
    assert.equal(Number(vaultItems.rows[0].cnt), 3, 'All 3 legacy vault items must remain intact');

    await upgradedDb.close();

    // 4. Reopen again to ensure idempotency and stability across restarts
    const reopenedDb = new SqliteDatabase(dbFile);
    await reopenedDb.ready;
    const statsReopen = await initSchema(reopenedDb);
    assert.equal(statsReopen.createdOrgs, 0, 'Reopen must be 100% idempotent');
    assert.equal(statsReopen.backfilledGroups, 0);
    assert.equal(statsReopen.backfilledCollections, 0);
    await reopenedDb.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

// =============================================================================
// CHALLENGE 4: Deep Deletion Cascades & Non-Regression Invariant
// =============================================================================

test('Adversarial M1: Deletion cascades clean up org resources while strictly preserving users & vault items', async () => {
  const db = await resetDatabase();

  // 1. Create 3 users: Alice (Owner), Bob (Admin), Charlie (Member)
  const aliceId = await insertUser(db, 'cascade_alice');
  const bobId = await insertUser(db, 'cascade_bob');
  const charlieId = await insertUser(db, 'cascade_charlie');

  // 2. Create personal vaults and personal items for each user
  const aliceVaultRes = await db.query(
    'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
    [aliceId, "Alice's Vault"]
  );
  const aliceVaultId = aliceVaultRes.rows[0].vault_id;

  const item1Res = await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING item_id`,
    [aliceVaultId, aliceId, TEST_ENCRYPTED_PAYLOAD, { title: 'Personal Secret 1' }]
  );
  const item2Res = await db.query(
    `INSERT INTO vault_items (vault_id, user_id, encrypted_data, metadata)
     VALUES ($1, $2, $3, $4) RETURNING item_id`,
    [aliceVaultId, aliceId, TEST_ENCRYPTED_PAYLOAD, { title: 'Shared Secret 2' }]
  );
  const item1Id = item1Res.rows[0].item_id;
  const item2Id = item2Res.rows[0].item_id;

  // 3. Create Organization "Acme Corp"
  const orgRes = await db.query(
    'INSERT INTO organizations (name, description, created_by) VALUES ($1, $2, $3) RETURNING org_id',
    ['Acme Corp', 'Enterprise Org for Cascade Test', aliceId]
  );
  const orgId = orgRes.rows[0].org_id;

  // Add members
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, aliceId, 'owner', 'confirmed']
  );
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, bobId, 'admin', 'confirmed']
  );
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, charlieId, 'member', 'confirmed']
  );

  // Add invitation
  await db.query(
    `INSERT INTO organization_invitations (org_id, email, role, invited_by, token, status, expires_at)
     VALUES ($1, $2, $3, $4, $5, 'pending', $6)`,
    [orgId, 'external@example.com', 'member', aliceId, 'tok_12345', new Date(Date.now() + 86400000).toISOString()]
  );

  // 4. Create Scoped Groups and Group Members
  const grpRes = await db.query(
    'INSERT INTO groups (name, org_id, created_by) VALUES ($1, $2, $3) RETURNING group_id',
    ['Engineering Group', orgId, aliceId]
  );
  const groupId = grpRes.rows[0].group_id;

  await db.query(
    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
    [groupId, bobId, 'member']
  );

  // 5. Create Scoped Collection, Collection Access, Collection Items, and Collection Keys
  const colRes = await db.query(
    'INSERT INTO collections (name, org_id, created_by) VALUES ($1, $2, $3) RETURNING collection_id',
    ['Engineering Secrets', orgId, aliceId]
  );
  const colId = colRes.rows[0].collection_id;

  await db.query(
    'INSERT INTO collection_access (collection_id, target_type, target_id, permission) VALUES ($1, $2, $3, $4)',
    [colId, 'group', groupId, 'admin']
  );

  await db.query(
    'INSERT INTO collection_items (collection_id, item_id) VALUES ($1, $2)',
    [colId, item2Id]
  );

  await db.query(
    'INSERT INTO collection_keys (collection_id, user_id, encrypted_key_for_recipient) VALUES ($1, $2, $3)',
    [colId, aliceId, { ciphertext: 'enc_key' }]
  );

  // 6. Execute DELETION OF ORGANIZATION
  await db.query('DELETE FROM organizations WHERE org_id = $1', [orgId]);

  // 7. Verify Cascade Cleanups
  const orgCheck = await db.query('SELECT * FROM organizations WHERE org_id = $1', [orgId]);
  assert.equal(orgCheck.rowCount, 0, 'Organization must be deleted');

  const membersCheck = await db.query('SELECT * FROM organization_members WHERE org_id = $1', [orgId]);
  assert.equal(membersCheck.rowCount, 0, 'Organization members must cascade-delete');

  const invitesCheck = await db.query('SELECT * FROM organization_invitations WHERE org_id = $1', [orgId]);
  assert.equal(invitesCheck.rowCount, 0, 'Organization invitations must cascade-delete');

  const groupsCheck = await db.query('SELECT * FROM groups WHERE org_id = $1', [orgId]);
  assert.equal(groupsCheck.rowCount, 0, 'Scoped groups must cascade-delete');

  const groupMembersCheck = await db.query('SELECT * FROM group_members WHERE group_id = $1', [groupId]);
  assert.equal(groupMembersCheck.rowCount, 0, 'Group members must cascade-delete');

  const colsCheck = await db.query('SELECT * FROM collections WHERE org_id = $1', [orgId]);
  assert.equal(colsCheck.rowCount, 0, 'Scoped collections must cascade-delete');

  const colAccessCheck = await db.query('SELECT * FROM collection_access WHERE collection_id = $1', [colId]);
  assert.equal(colAccessCheck.rowCount, 0, 'Collection access entries must cascade-delete');

  const colItemsCheck = await db.query('SELECT * FROM collection_items WHERE collection_id = $1', [colId]);
  assert.equal(colItemsCheck.rowCount, 0, 'Collection items links must cascade-delete');

  const colKeysCheck = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1', [colId]);
  assert.equal(colKeysCheck.rowCount, 0, 'Collection keys must cascade-delete');

  // 8. CRITICAL NON-REGRESSION INVARIANTS: Users and Vault Items MUST remain 100% intact!
  const usersCheck = await db.query('SELECT COUNT(*) as cnt FROM users WHERE user_id IN ($1, $2, $3)', [aliceId, bobId, charlieId]);
  assert.equal(Number(usersCheck.rows[0].cnt), 3, 'User accounts must NEVER be deleted when an organization is deleted');

  const item1Check = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [item1Id]);
  assert.equal(item1Check.rowCount, 1, 'Personal vault item must remain intact');

  const item2Check = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [item2Id]);
  assert.equal(item2Check.rowCount, 1, 'Shared vault item payload must remain intact in personal vault');

  const vaultCheck = await db.query('SELECT * FROM vaults WHERE vault_id = $1', [aliceVaultId]);
  assert.equal(vaultCheck.rowCount, 1, 'Personal vault container must remain intact');
});

// =============================================================================
// CHALLENGE 5: Edge Cases & Cross-User Attribution Oracles
// =============================================================================

test('Adversarial M1: Standalone group backfill assigns strictly to creator even if another user is group manager', async () => {
  const db = await resetDatabase();
  const creatorId = await insertUser(db, 'creator_user');
  const managerId = await insertUser(db, 'manager_user');

  // Creator has a standalone group
  const grpRes = await db.query(
    'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING group_id',
    ['Cross User Group', creatorId]
  );
  const groupId = grpRes.rows[0].group_id;

  // Manager is added to group_members with role 'admin'
  await db.query(
    'INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, $3)',
    [groupId, managerId, 'admin']
  );

  // Run migration
  await migratePersonalOrganizations(db);

  // Group must be assigned to creatorId's personal organization, NEVER managerId's
  const creatorOrg = (await db.query('SELECT org_id FROM organizations WHERE created_by = $1', [creatorId])).rows[0].org_id;
  const managerOrg = (await db.query('SELECT org_id FROM organizations WHERE created_by = $1', [managerId])).rows[0].org_id;

  const updatedGroup = (await db.query('SELECT org_id FROM groups WHERE group_id = $1', [groupId])).rows[0];
  assert.equal(updatedGroup.org_id, creatorOrg, 'Group must be assigned to creator personal org');
  assert.notEqual(updatedGroup.org_id, managerOrg, 'Group must NOT be assigned to group manager');
});

test('Adversarial M1: Migration handles users with NULL full_name cleanly via username fallback', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vault-nullname-test-'));
  const dbFile = path.join(tmpDir, 'nullname.sqlite');
  try {
    const ddl = readSchema();
    // Create schema where full_name is nullable
    const nullableDdl = pgToSqliteSchema(ddl).replace('full_name VARCHAR(128) NOT NULL,', 'full_name VARCHAR(128) DEFAULT NULL,');
    const rawDb = new DatabaseSync(dbFile);
    rawDb.function('gen_random_uuid', () => crypto.randomUUID());
    rawDb.exec('PRAGMA foreign_keys = ON;');
    rawDb.exec(nullableDdl);

    const uid = crypto.randomUUID();
    rawDb.prepare(
      `INSERT INTO users (user_id, email, username, full_name, kdf_salt, public_key, encrypted_private_key, encrypted_vault_key)
       VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`
    ).run(uid, 'null_name@example.com', 'null_user', TEST_SALT, 'pk', JSON.stringify(TEST_ENCRYPTED_PAYLOAD), JSON.stringify(TEST_ENCRYPTED_PAYLOAD));
    rawDb.close();

    const db = new SqliteDatabase(dbFile);
    await db.ready;
    const res = await migratePersonalOrganizations(db);
    assert.equal(res.createdOrgs, 1);

    const org = (await db.query('SELECT * FROM organizations WHERE created_by = $1', [uid])).rows[0];
    assert.equal(org.name, "null_user's Personal Organization");
    assert.equal(org.description, 'Default personal organization');
    await db.close();
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});
