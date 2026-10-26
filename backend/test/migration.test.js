/**
 * Secure Vault Cloud — Personal Default Organization Migration & Backfill Unit Tests (Milestone M1)
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { resetDatabase, initSchema } from '../src/db/adapter.js';
import { insertUser } from './helpers.js';
import { migratePersonalOrganizations, migrateDefaultOrganizations } from '../src/db/migration.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

async function insertTestUser(db, username, fullName) {
  const userId = await insertUser(db, username);
  if (fullName !== undefined) {
    await db.query('UPDATE users SET full_name = $1 WHERE user_id = $2', [fullName, userId]);
  }
  return userId;
}

test('Migration M1: Empty database handles migration cleanly', async () => {
  const db = await resetDatabase();
  const res = await migratePersonalOrganizations(db);

  assert.equal(res.createdOrgs, 0);
  assert.equal(res.backfilledGroups, 0);
  assert.equal(res.backfilledCollections, 0);
  assert.ok(typeof res.durationMs === 'number');
});

test('Migration M1: Fresh migration creates default personal organization and owner membership', async () => {
  const db = await resetDatabase();
  const userId = await insertTestUser(db, 'alice', 'Alice Wonderland');

  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, 1);

  // Check organization created
  const orgRes = await db.query('SELECT * FROM organizations WHERE created_by = $1', [userId]);
  assert.equal(orgRes.rowCount, 1);
  const org = orgRes.rows[0];
  assert.equal(org.name, "Alice Wonderland's Personal Organization");
  assert.equal(org.description, 'Default personal organization');
  assert.equal(org.status, 'active');
  assert.ok(org.org_id);
  assert.ok(org.created_at);

  // Check owner membership created
  const memberRes = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [org.org_id, userId]
  );
  assert.equal(memberRes.rowCount, 1);
  const member = memberRes.rows[0];
  assert.equal(member.role, 'owner');
  assert.equal(member.status, 'confirmed');
  assert.equal(member.encrypted_org_key, null);
});

test('Migration M1: Fallback to username when full_name is empty or whitespace', async () => {
  const db = await resetDatabase();
  const user1 = await insertTestUser(db, 'bob', '');
  const user2 = await insertTestUser(db, 'charlie', '   ');

  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, 2);

  const org1 = await db.query('SELECT name FROM organizations WHERE created_by = $1', [user1]);
  assert.equal(org1.rows[0].name, "bob's Personal Organization");

  const org2 = await db.query('SELECT name FROM organizations WHERE created_by = $1', [user2]);
  assert.equal(org2.rows[0].name, "charlie's Personal Organization");
});

test('Migration M1: Standalone groups and collections are backfilled to default personal org', async () => {
  const db = await resetDatabase();
  const aliceId = await insertTestUser(db, 'alice_backfill', 'Alice Cooper');

  // Create standalone group (org_id is NULL)
  const grpRes = await db.query(
    'INSERT INTO groups (name, description, created_by) VALUES ($1, $2, $3) RETURNING group_id',
    ['Standalone Devs', 'Legacy group without org', aliceId]
  );
  const groupId = grpRes.rows[0].group_id;

  // Create standalone collection (org_id is NULL)
  const colRes = await db.query(
    'INSERT INTO collections (name, description, created_by) VALUES ($1, $2, $3) RETURNING collection_id',
    ['Standalone Secrets', 'Legacy collection without org', aliceId]
  );
  const colId = colRes.rows[0].collection_id;

  // Run migration
  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, 1);
  assert.equal(res.backfilledGroups, 1);
  assert.equal(res.backfilledCollections, 1);

  // Verify group is now linked to Alice's personal org
  const orgRes = await db.query('SELECT org_id FROM organizations WHERE created_by = $1', [aliceId]);
  const orgId = orgRes.rows[0].org_id;

  const updatedGrp = await db.query('SELECT org_id FROM groups WHERE group_id = $1', [groupId]);
  assert.equal(updatedGrp.rows[0].org_id, orgId);

  const updatedCol = await db.query('SELECT org_id FROM collections WHERE collection_id = $1', [colId]);
  assert.equal(updatedCol.rows[0].org_id, orgId);
});

test('Migration M1: 100% Idempotency — repeated executions make zero changes', async () => {
  const db = await resetDatabase();
  const aliceId = await insertTestUser(db, 'alice_idempotent', 'Alice I.');
  const bobId = await insertTestUser(db, 'bob_idempotent', 'Bob I.');

  // Seed standalone groups & collections for both users
  await db.query('INSERT INTO groups (name, created_by) VALUES ($1, $2)', ['Alice Grp', aliceId]);
  await db.query('INSERT INTO groups (name, created_by) VALUES ($1, $2)', ['Bob Grp', bobId]);
  await db.query('INSERT INTO collections (name, created_by) VALUES ($1, $2)', ['Alice Col', aliceId]);
  await db.query('INSERT INTO collections (name, created_by) VALUES ($1, $2)', ['Bob Col', bobId]);

  // Run 1
  const run1 = await migratePersonalOrganizations(db);
  assert.equal(run1.createdOrgs, 2);
  assert.equal(run1.backfilledGroups, 2);
  assert.equal(run1.backfilledCollections, 2);

  const orgsAfterRun1 = await db.query('SELECT COUNT(*) as cnt FROM organizations');
  const membersAfterRun1 = await db.query('SELECT COUNT(*) as cnt FROM organization_members');
  assert.equal(Number(orgsAfterRun1.rows[0].cnt), 2);
  assert.equal(Number(membersAfterRun1.rows[0].cnt), 2);

  // Run 2 (Must be 100% idempotent)
  const run2 = await migratePersonalOrganizations(db);
  assert.equal(run2.createdOrgs, 0, 'Second run must create 0 orgs');
  assert.equal(run2.backfilledGroups, 0, 'Second run must backfill 0 groups');
  assert.equal(run2.backfilledCollections, 0, 'Second run must backfill 0 collections');

  // Run 3
  const run3 = await migratePersonalOrganizations(db);
  assert.equal(run3.createdOrgs, 0);
  assert.equal(run3.backfilledGroups, 0);
  assert.equal(run3.backfilledCollections, 0);

  // Verify total rows unchanged
  const orgsAfterRun3 = await db.query('SELECT COUNT(*) as cnt FROM organizations');
  const membersAfterRun3 = await db.query('SELECT COUNT(*) as cnt FROM organization_members');
  assert.equal(Number(orgsAfterRun3.rows[0].cnt), 2);
  assert.equal(Number(membersAfterRun3.rows[0].cnt), 2);
});

test('Migration M1: Pre-existing owned organizations are preserved without duplicate creation', async () => {
  const db = await resetDatabase();
  const aliceId = await insertTestUser(db, 'alice_enterprise', 'Alice Boss');

  // Alice already created an enterprise organization
  const customOrgRes = await db.query(
    'INSERT INTO organizations (name, description, created_by) VALUES ($1, $2, $3) RETURNING org_id',
    ['Alice Corp', 'Pre-existing enterprise org', aliceId]
  );
  const customOrgId = customOrgRes.rows[0].org_id;

  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [customOrgId, aliceId, 'owner', 'confirmed']
  );

  // Alice has a standalone group
  const grpRes = await db.query(
    'INSERT INTO groups (name, created_by) VALUES ($1, $2) RETURNING group_id',
    ['Unlinked Group', aliceId]
  );
  const groupId = grpRes.rows[0].group_id;

  // Run migration
  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, 0, 'Should not create duplicate personal org for owner');
  assert.equal(res.backfilledGroups, 1, 'Should backfill unlinked group to existing owned org');

  // Verify group attached to Alice's existing org
  const updatedGrp = await db.query('SELECT org_id FROM groups WHERE group_id = $1', [groupId]);
  assert.equal(updatedGrp.rows[0].org_id, customOrgId);

  // Check total orgs for Alice is still 1
  const orgCount = await db.query('SELECT COUNT(*) as cnt FROM organizations WHERE created_by = $1', [aliceId]);
  assert.equal(Number(orgCount.rows[0].cnt), 1);
});

test('Migration M1: Non-owner member in another org still receives their own default personal org', async () => {
  const db = await resetDatabase();
  const ownerId = await insertTestUser(db, 'org_owner', 'Owner User');
  const memberId = await insertTestUser(db, 'org_member', 'Member User');

  // Create Owner's org and add memberId as role='member' (NOT owner)
  const orgRes = await db.query(
    'INSERT INTO organizations (name, created_by) VALUES ($1, $2) RETURNING org_id',
    ['Corporate Org', ownerId]
  );
  const orgId = orgRes.rows[0].org_id;

  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, ownerId, 'owner', 'confirmed']
  );
  await db.query(
    'INSERT INTO organization_members (org_id, user_id, role, status) VALUES ($1, $2, $3, $4)',
    [orgId, memberId, 'member', 'confirmed']
  );

  // Run migration: Owner already has owned org (0 created for owner), but memberId needs one!
  const res = await migratePersonalOrganizations(db);
  assert.equal(res.createdOrgs, 1, 'Member user must receive their own personal org');

  const memberPersonalOrg = await db.query(
    'SELECT * FROM organizations WHERE created_by = $1',
    [memberId]
  );
  assert.equal(memberPersonalOrg.rowCount, 1);
  assert.equal(memberPersonalOrg.rows[0].name, "Member User's Personal Organization");

  const memberOwnership = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [memberPersonalOrg.rows[0].org_id, memberId]
  );
  assert.equal(memberOwnership.rowCount, 1);
  assert.equal(memberOwnership.rows[0].role, 'owner');
});

test('Migration M1: initSchema runs schema DDL and executes personal org migration', async () => {
  const db = await resetDatabase();
  const userId = await insertTestUser(db, 'initschema_user', 'Init User');

  const stats = await initSchema(db);
  assert.ok(stats);
  assert.equal(stats.createdOrgs, 1);

  const orgCheck = await db.query('SELECT * FROM organizations WHERE created_by = $1', [userId]);
  assert.equal(orgCheck.rowCount, 1);

  // Calling initSchema again is idempotent
  const stats2 = await initSchema(db);
  assert.equal(stats2.createdOrgs, 0);
});

test('Migration M1: migrateDefaultOrganizations export alias functions identically', async () => {
  assert.equal(typeof migrateDefaultOrganizations, 'function');
  assert.equal(migrateDefaultOrganizations, migratePersonalOrganizations);
});
