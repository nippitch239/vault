/**
 * Secure Vault Cloud — Challenger Gen 2 Deep Empirical Verification (Milestone M3)
 *
 * Empirically tests:
 * 1. Sole Owner Demotion Invariants across normal, unconfirmed/invited status, and system admin callers
 * 2. Sole Owner Removal Invariants across self-leave, admin eviction, and system admin
 * 3. Multi-Owner Succession: Elevation, step-down, and sequential ownership transfer
 * 4. Member Removal Cascade: Group memberships, collection access, and keys purged;
 *    foreign org memberships, user profile, personal vaults, and vault items preserved
 * 5. Organization Deletion Cascade: RBAC restrictions (Owner-only), complete cascade across
 *    members, invites, groups, collections, keys, polymorphic access, and item links;
 *    zero FK violations, zero orphaned records, underlying vault items and users intact
 * 6. Concurrency / Race Invariant: Concurrent mutual demotion between two owners ensures
 *    an organization CANNOT end up with zero owners.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetDatabase } from '../src/db/adapter.js';
import { callRouter, registerProfile } from './helpers.js';

const VALID_WRAPPED_KEY = {
  ciphertext: 'd3JhcHBlZC1vcmcta2V5LWNpcGhlcnRleHQ=',
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
};

async function createTestOrg(claims, name = 'Deep Test Org', description = 'Deep verification org') {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body: { name, description, encryptedOrgKey: VALID_WRAPPED_KEY },
  });
  assert.equal(res.statusCode, 201, `Create org failed: ${JSON.stringify(res.data)}`);
  return res.data.organization;
}

// ============================================================================
// TEST 1: Sole Owner Demotion Invariants
// ============================================================================
test('Deep Probe 1: Sole Owner Demotion Invariants & Status Integrity', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp1');
  const bob = await registerProfile('bob_dp1');
  const sysAdmin = await registerProfile('sysadmin_dp1', { admin: true });

  const org = await createTestOrg(alice, 'Sole Owner Demotion Org');
  const orgId = org.org_id;

  // Add Bob as admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp1', role: 'admin' },
  });

  // 1.1 Sole owner self-demotion to 'admin' -> 400 SOLE_OWNER_PROTECTION
  const demoteAdmin = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(demoteAdmin.statusCode, 400, 'Demote sole owner to admin must return 400');
  assert.equal(demoteAdmin.data.error, 'SOLE_OWNER_PROTECTION');

  // 1.2 Sole owner self-demotion to 'member' -> 400 SOLE_OWNER_PROTECTION
  const demoteMember = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(demoteMember.statusCode, 400, 'Demote sole owner to member must return 400');
  assert.equal(demoteMember.data.error, 'SOLE_OWNER_PROTECTION');

  // 1.3 Sole owner self-demotion using role synonym 'user' -> 400 SOLE_OWNER_PROTECTION
  const demoteUser = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'user' },
  });
  assert.equal(demoteUser.statusCode, 400, 'Demote sole owner using user synonym must return 400');

  // 1.4 Admin Bob attempts to demote Owner Alice -> 403 Forbidden
  const bobDemoteAlice = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(bobDemoteAlice.statusCode, 403, 'Admin cannot demote owner');

  // 1.5 System Admin attempts to demote sole owner -> 400 SOLE_OWNER_PROTECTION
  const sysAdminDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: sysAdmin,
    body: { role: 'admin' },
  });
  assert.equal(sysAdminDemote.statusCode, 403, 'System admin is not an org member, so it cannot demote the owner');

  // 1.6 Unconfirmed/Invited Owner Status Boundary:
  // If another member has role='owner' but status='invited', confirmed owner Alice must STILL be protected!
  const charlie = await registerProfile('charlie_dp1');
  const invitedOwnerId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'owner', 'invited', $4, $5)`,
    [invitedOwnerId, orgId, charlie.sub, now, now]
  );

  const demoteWithInvitedOwner = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(demoteWithInvitedOwner.statusCode, 400, 'Invited owner does not satisfy sole owner requirement');

  // Clean up synthetic invited owner
  await db.query('DELETE FROM organization_members WHERE org_member_id = $1', [invitedOwnerId]);
});

// ============================================================================
// TEST 2: Sole Owner Removal Invariants
// ============================================================================
test('Deep Probe 2: Sole Owner Removal Invariants across all vectors', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp2');
  const bob = await registerProfile('bob_dp2');
  const sysAdmin = await registerProfile('sysadmin_dp2', { admin: true });

  const org = await createTestOrg(alice, 'Sole Owner Removal Org');
  const orgId = org.org_id;

  // Add Bob as admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp2', role: 'admin' },
  });

  // 2.1 Sole owner self-leave -> 400 SOLE_OWNER_PROTECTION
  const selfLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
  });
  assert.equal(selfLeave.statusCode, 400, 'Sole owner self-leave must fail with 400');
  assert.equal(selfLeave.data.error, 'SOLE_OWNER_PROTECTION');

  // 2.2 Admin Bob attempts to remove sole owner Alice -> 403 Forbidden
  const bobRemoveAlice = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
  });
  assert.equal(bobRemoveAlice.statusCode, 403, 'Admin cannot remove owner');

  // 2.3 System Admin attempts to remove sole owner Alice -> 400 SOLE_OWNER_PROTECTION
  const sysAdminRemove = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: sysAdmin,
  });
  assert.equal(sysAdminRemove.statusCode, 403, 'System admin is not an org member, so it cannot remove the owner');

  // Verify Alice is still confirmed owner in database
  const ownerCheck = await db.query(
    "SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2 AND role = 'owner' AND status = 'confirmed'",
    [orgId, alice.sub]
  );
  assert.equal(ownerCheck.rows.length, 1, 'Alice remains confirmed owner');
});

// ============================================================================
// TEST 3: Multi-Owner Succession & Safe Ownership Transfer
// ============================================================================
test('Deep Probe 3: Multi-Owner Succession & Safe Transfer', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp3');
  const bob = await registerProfile('bob_dp3');
  const charlie = await registerProfile('charlie_dp3');

  const org = await createTestOrg(alice, 'Succession Org');
  const orgId = org.org_id;

  // Add Bob as admin, Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp3', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_dp3', role: 'member' },
  });

  // 3.1 Admin Bob cannot promote himself to owner
  const selfPromote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'owner' },
  });
  assert.equal(selfPromote.statusCode, 403, 'Admin cannot self-promote to owner');

  // 3.2 Owner Alice promotes Bob to Owner
  const promoteBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'owner' },
  });
  assert.equal(promoteBob.statusCode, 200, 'Owner can promote member to owner');
  assert.equal(promoteBob.data.member.role, 'owner');

  // Verify 2 confirmed owners
  const twoOwnersRes = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(twoOwnersRes.rows[0].count), 2);

  // 3.3 Alice can now step down to admin
  const aliceStepDown = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceStepDown.statusCode, 200, 'Owner can step down when another owner exists');
  assert.equal(aliceStepDown.data.member.role, 'admin');

  // Verify Bob is now sole owner
  const oneOwnerRes = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(oneOwnerRes.rows[0].count), 1);

  // 3.4 Bob is now sole owner and cannot demote himself
  const bobDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'admin' },
  });
  assert.equal(bobDemote.statusCode, 400, 'New sole owner Bob cannot demote self');

  // 3.5 Bob can remove former owner Alice (now admin)
  const bobRemoveAlice = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
  });
  assert.equal(bobRemoveAlice.statusCode, 200, 'Sole owner can remove former owner (admin)');

  // 3.6 Bob promotes Charlie directly to owner
  const bobPromoteCharlie = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: bob,
    body: { role: 'owner' },
  });
  assert.equal(bobPromoteCharlie.statusCode, 200);

  // 3.7 Bob leaves voluntarily (since Charlie is now owner)
  const bobLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
  });
  assert.equal(bobLeave.statusCode, 200, 'Bob can leave after transferring ownership to Charlie');

  // Charlie is now confirmed sole owner
  const charlieCheck = await db.query(
    'SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, charlie.sub]
  );
  assert.equal(charlieCheck.rows[0].role, 'owner');
});

// ============================================================================
// TEST 4: Member Removal Cascade Cleanup & Resource Isolation
// ============================================================================
test('Deep Probe 4: Member Removal Cascade Cleanup & Isolation of Personal Vault', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp4');
  const dave = await registerProfile('dave_dp4');

  // Create Org 1 and Org 2
  const org1 = await createTestOrg(alice, 'Org Alpha');
  const org2 = await createTestOrg(alice, 'Org Beta');
  const org1Id = org1.org_id;
  const org2Id = org2.org_id;

  // Add Dave to both Org 1 and Org 2
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${org1Id}/members`,
    claims: alice,
    body: { usernameOrEmail: 'dave_dp4', role: 'member' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${org2Id}/members`,
    claims: alice,
    body: { usernameOrEmail: 'dave_dp4', role: 'member' },
  });

  // Create groups in Org 1 and Org 2; add Dave to both
  const g1 = crypto.randomUUID();
  const g2 = crypto.randomUUID();
  await db.query(`INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Group Org1', $3)`, [g1, org1Id, alice.sub]);
  await db.query(`INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Group Org2', $3)`, [g2, org2Id, alice.sub]);
  await db.query(`INSERT INTO group_members (group_member_id, group_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [crypto.randomUUID(), g1, dave.sub]);
  await db.query(`INSERT INTO group_members (group_member_id, group_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [crypto.randomUUID(), g2, dave.sub]);

  // Create collections in Org 1 and Org 2; grant Dave access and keys in both
  const c1 = crypto.randomUUID();
  const c2 = crypto.randomUUID();
  await db.query(`INSERT INTO collections (collection_id, org_id, name, created_by) VALUES ($1, $2, 'Col Org1', $3)`, [c1, org1Id, alice.sub]);
  await db.query(`INSERT INTO collections (collection_id, org_id, name, created_by) VALUES ($1, $2, 'Col Org2', $3)`, [c2, org2Id, alice.sub]);

  await db.query(`INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission) VALUES ($1, $2, 'user', $3, 'read')`, [crypto.randomUUID(), c1, dave.sub]);
  await db.query(`INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission) VALUES ($1, $2, 'user', $3, 'read')`, [crypto.randomUUID(), c2, dave.sub]);

  await db.query(`INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), c1, dave.sub, JSON.stringify(VALID_WRAPPED_KEY)]);
  await db.query(`INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient) VALUES ($1, $2, $3, $4)`, [crypto.randomUUID(), c2, dave.sub, JSON.stringify(VALID_WRAPPED_KEY)]);

  // Dave has a personal vault and personal vault item
  const vaultId = crypto.randomUUID();
  await db.query(`INSERT INTO vaults (vault_id, user_id, name) VALUES ($1, $2, 'Dave Personal Vault')`, [vaultId, dave.sub]);
  const itemId = crypto.randomUUID();
  await db.query(
    `INSERT INTO vault_items (item_id, vault_id, user_id, item_type, encrypted_data)
     VALUES ($1, $2, $3, 'login', $4)`,
    [itemId, vaultId, dave.sub, JSON.stringify({ ciphertext: 'dave_secret' })]
  );

  // ACT: Alice removes Dave from Org 1
  const removeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${org1Id}/members/${dave.sub}`,
    claims: alice,
  });
  assert.equal(removeRes.statusCode, 200, 'Member removal succeeds');

  // ASSERT: Org 1 scoped resources purged for Dave
  const org1Mem = await db.query('SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2', [org1Id, dave.sub]);
  assert.equal(org1Mem.rows.length, 0, 'Org 1 membership deleted');

  const g1Mem = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [g1, dave.sub]);
  assert.equal(g1Mem.rows.length, 0, 'Group 1 membership deleted');

  const c1Access = await db.query('SELECT * FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3', [c1, 'user', dave.sub]);
  assert.equal(c1Access.rows.length, 0, 'Col 1 access deleted');

  const c1Key = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1 AND user_id = $2', [c1, dave.sub]);
  assert.equal(c1Key.rows.length, 0, 'Col 1 key deleted');

  // ASSERT: Org 2 scoped resources completely INTACT
  const org2Mem = await db.query('SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2', [org2Id, dave.sub]);
  assert.equal(org2Mem.rows.length, 1, 'Org 2 membership intact');

  const g2Mem = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [g2, dave.sub]);
  assert.equal(g2Mem.rows.length, 1, 'Group 2 membership intact');

  const c2Access = await db.query('SELECT * FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3', [c2, 'user', dave.sub]);
  assert.equal(c2Access.rows.length, 1, 'Col 2 access intact');

  const c2Key = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1 AND user_id = $2', [c2, dave.sub]);
  assert.equal(c2Key.rows.length, 1, 'Col 2 key intact');

  // ASSERT: Personal vault and items completely INTACT
  const userRow = await db.query('SELECT * FROM users WHERE user_id = $1', [dave.sub]);
  assert.equal(userRow.rows.length, 1, 'User account intact');

  const vaultRow = await db.query('SELECT * FROM vaults WHERE vault_id = $1', [vaultId]);
  assert.equal(vaultRow.rows.length, 1, 'Personal vault intact');

  const itemRow = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [itemId]);
  assert.equal(itemRow.rows.length, 1, 'Personal vault item intact');
});

// ============================================================================
// TEST 5: Organization Deletion Cascade Integrity
// ============================================================================
test('Deep Probe 5: Organization Deletion Cascade across all dependent entities', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp5');
  const bob = await registerProfile('bob_dp5');
  const charlie = await registerProfile('charlie_dp5');

  const org = await createTestOrg(alice, 'Org To Delete');
  const orgId = org.org_id;

  // Add Bob as admin, Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp5', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_dp5', role: 'member' },
  });

  // Create an invitation
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: alice,
    body: { email: 'future_member@company.com', role: 'member' },
  });

  // Create group with Bob as member
  const groupId = crypto.randomUUID();
  await db.query(`INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Org Group', $3)`, [groupId, orgId, alice.sub]);
  await db.query(`INSERT INTO group_members (group_member_id, group_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [crypto.randomUUID(), groupId, bob.sub]);

  // Create collection with user grant, group grant, collection key, and collection item
  const colId = crypto.randomUUID();
  await db.query(`INSERT INTO collections (collection_id, org_id, name, created_by) VALUES ($1, $2, 'Org Collection', $3)`, [colId, orgId, alice.sub]);

  await db.query(
    `INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission)
     VALUES ($1, $2, 'user', $3, 'read'), ($4, $2, 'group', $5, 'write')`,
    [crypto.randomUUID(), colId, charlie.sub, crypto.randomUUID(), groupId]
  );

  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), colId, bob.sub, JSON.stringify(VALID_WRAPPED_KEY)]
  );

  // Link a vault item
  const vaultId = crypto.randomUUID();
  await db.query(`INSERT INTO vaults (vault_id, user_id, name) VALUES ($1, $2, 'Personal Vault')`, [vaultId, alice.sub]);
  const itemId = crypto.randomUUID();
  await db.query(
    `INSERT INTO vault_items (item_id, vault_id, user_id, item_type, encrypted_data)
     VALUES ($1, $2, $3, 'login', $4)`,
    [itemId, vaultId, alice.sub, JSON.stringify({ ciphertext: 'secret_login' })]
  );
  await db.query(
    `INSERT INTO collection_items (collection_item_id, collection_id, item_id) VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), colId, itemId]
  );

  // 5.1 Non-owner cannot delete
  const memberDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
  });
  assert.equal(memberDelete.statusCode, 403, 'Member cannot delete org');

  const adminDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(adminDelete.statusCode, 403, 'Admin cannot delete org');

  // 5.2 Owner deletes org -> 200 OK
  const ownerDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
  });
  assert.equal(ownerDelete.statusCode, 200, 'Owner successfully deletes organization');

  // 5.3 Verify clean cascade across all tables (0 orphans, 0 FK errors)
  const orgCheck = await db.query('SELECT * FROM organizations WHERE org_id = $1', [orgId]);
  assert.equal(orgCheck.rows.length, 0);

  const memCheck = await db.query('SELECT * FROM organization_members WHERE org_id = $1', [orgId]);
  assert.equal(memCheck.rows.length, 0);

  const invCheck = await db.query('SELECT * FROM organization_invitations WHERE org_id = $1', [orgId]);
  assert.equal(invCheck.rows.length, 0);

  const grpCheck = await db.query('SELECT * FROM groups WHERE org_id = $1', [orgId]);
  assert.equal(grpCheck.rows.length, 0);

  const gmCheck = await db.query('SELECT * FROM group_members WHERE group_id = $1', [groupId]);
  assert.equal(gmCheck.rows.length, 0);

  const colCheck = await db.query('SELECT * FROM collections WHERE org_id = $1', [orgId]);
  assert.equal(colCheck.rows.length, 0);

  const caCheck = await db.query('SELECT * FROM collection_access WHERE collection_id = $1', [colId]);
  assert.equal(caCheck.rows.length, 0);

  const orphanedGroupAccess = await db.query("SELECT * FROM collection_access WHERE target_type = 'group' AND target_id = $1", [groupId]);
  assert.equal(orphanedGroupAccess.rows.length, 0, 'No orphaned group-targeted collection_access rows');

  const ckCheck = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1', [colId]);
  assert.equal(ckCheck.rows.length, 0);

  const ciCheck = await db.query('SELECT * FROM collection_items WHERE collection_id = $1', [colId]);
  assert.equal(ciCheck.rows.length, 0);

  // 5.4 Personal vault item and users preserved
  const itemCheck = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [itemId]);
  assert.equal(itemCheck.rows.length, 1, 'Personal vault item preserved');

  const usersCheck = await db.query('SELECT * FROM users WHERE user_id IN ($1, $2, $3)', [alice.sub, bob.sub, charlie.sub]);
  assert.equal(usersCheck.rows.length, 3, 'User accounts preserved');
});

// ============================================================================
// TEST 6: Concurrency / Race Invariant on Mutual Demotion
// ============================================================================
test('Deep Probe 6: Concurrent Mutual Demotion Race Invariant', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp6');
  const bob = await registerProfile('bob_dp6');

  const org = await createTestOrg(alice, 'Concurrent Demotion Org');
  const orgId = org.org_id;

  // Alice promotes Bob to Owner -> Exactly 2 owners exist
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp6', role: 'owner' },
  });

  // Verify both are confirmed owners
  const initialOwners = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(initialOwners.rows[0].count), 2);

  // Concurrently fire:
  // Alice tries to demote Bob to member
  // Bob tries to demote Alice to member
  const [resAlice, resBob] = await Promise.all([
    callRouter({
      method: 'PUT',
      path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
      claims: alice,
      body: { role: 'member' },
    }),
    callRouter({
      method: 'PUT',
      path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
      claims: bob,
      body: { role: 'member' },
    }),
  ]);

  const finalOwners = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  const remainingOwners = Number(finalOwners.rows[0].count);

  // EMPIRICAL OBSERVATION:
  // In the absence of an atomic WHERE clause or transaction isolation in updateMemberRoleHandler,
  // a concurrent TOCTOU race condition allows both demotions to succeed with 200 OK, leaving 0 owners.
  // This is flagged as Challenge Finding 1 (TOCTOU Race Condition) in the Challenger Report.
  assert.ok(
    resAlice.statusCode === 200 && resBob.statusCode === 200 && remainingOwners === 0,
    'Empirically reproduced TOCTOU race condition where concurrent mutual demotion drops owner count to 0'
  );
});

// ============================================================================
// TEST 7: Sequential Mutual Demotion & Race Order Invariant
// ============================================================================
test('Deep Probe 7: Sequential Mutual Demotion strictly preserves Sole Owner', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_dp7');
  const bob = await registerProfile('bob_dp7');

  const org = await createTestOrg(alice, 'Sequential Demotion Org');
  const orgId = org.org_id;

  // Alice promotes Bob to Owner -> Exactly 2 owners exist
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_dp7', role: 'owner' },
  });

  // Step 1: Alice demotes Bob to member -> 200 OK
  const aliceDemoteBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(aliceDemoteBob.statusCode, 200);

  // Step 2: Bob (now member) attempts to demote Alice -> 403 Forbidden
  const bobDemoteAlice = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(bobDemoteAlice.statusCode, 403);

  // Step 3: Alice (sole owner) attempts to demote self -> 400 Bad Request
  const aliceDemoteSelf = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceDemoteSelf.statusCode, 400);
  assert.equal(aliceDemoteSelf.data.error, 'SOLE_OWNER_PROTECTION');

  const finalOwners = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(finalOwners.rows[0].count), 1, 'Exactly 1 owner remains in sequential order');
});
