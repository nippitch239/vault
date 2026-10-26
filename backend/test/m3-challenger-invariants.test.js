/**
 * Secure Vault Cloud — Challenger Empirical Verification Suite (Milestone M3)
 *
 * EMPIRICAL ADVERSARIAL STRESS TEST:
 * 1. Sole Owner Demotion Protection Invariants (self-demotion, multi-member org, system admin, non-confirmed owner)
 * 2. Sole Owner Removal Protection Invariants (self-leave, admin eviction, multi-member org)
 * 3. Multi-Owner Succession & Safe Ownership Transfer (elevation, step-down, last owner transfer)
 * 4. Cascade Cleanup on Member Removal (scoped groups, direct collection access, wrapped keys purged;
 *    personal vault items, user account, and foreign org memberships preserved intact)
 * 5. Cascade Deletion on Organization Delete (owner-only restriction, clean cascade across members,
 *    invitations, groups, group_members, collections, collection_access, collection_keys, collection_items;
 *    zero FK violations, zero orphaned records, vault items and users preserved)
 * 6. Cross-Tenant IDOR and Privilege Escalation Defenses
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

async function createOrg(claims, name = 'Invariants Org', description = 'Testing invariants', key = VALID_WRAPPED_KEY) {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body: { name, description, encryptedOrgKey: key },
  });
  assert.equal(res.statusCode, 201, `Failed to create org: ${JSON.stringify(res.data)}`);
  return res.data.organization;
}

// ============================================================================
// 1. Sole Owner Demotion Invariants
// ============================================================================
test('Challenger Invariant 1: Sole Owner Demotion Prevention across all boundary conditions', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_inv_1');
  await registerProfile('bob_inv_1');
  await registerProfile('charlie_inv_1');
  const sysAdmin = await registerProfile('sysadmin_inv_1', { admin: true });

  const org = await createOrg(alice, 'Demotion Defense Org');
  const orgId = org.org_id;

  // Add Bob as admin, Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_1', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_inv_1', role: 'member' },
  });

  // 1.1 Sole owner demotion to 'admin' rejected with 400
  const demoteToAdmin = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(demoteToAdmin.statusCode, 400, 'Demote sole owner to admin must return 400');
  assert.ok(
    demoteToAdmin.data?.error?.includes('SOLE_OWNER') || demoteToAdmin.data?.message?.includes('sole owner'),
    'Response indicates SOLE_OWNER_PROTECTION'
  );

  // 1.2 Sole owner demotion to 'member' rejected with 400
  const demoteToMember = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(demoteToMember.statusCode, 400, 'Demote sole owner to member must return 400');

  // 1.3 Sole owner demotion using alias 'user' rejected with 400
  const demoteToUser = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'user' },
  });
  assert.equal(demoteToUser.statusCode, 400, 'Demote sole owner to user alias must return 400');

  // 1.4 Even system administrator cannot demote sole owner without succession
  const sysAdminDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: sysAdmin,
    body: { role: 'admin' },
  });
  assert.equal(sysAdminDemote.statusCode, 400, 'System admin cannot demote sole owner');

  // 1.5 Sole owner demotion with unconfirmed/suspended owner record present
  // Insert an unconfirmed (invited) owner record directly into DB to test status boundary
  const dave = await registerProfile('dave_inv_1');
  const invitedOwnerId = crypto.randomUUID();
  await db.query(
    `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'owner', 'invited', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`,
    [invitedOwnerId, orgId, dave.sub]
  );

  const demoteWithInvited = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(demoteWithInvited.statusCode, 400, 'Unconfirmed/invited owner does NOT satisfy sole owner requirement');

  // Clean up synthetic row
  await db.query('DELETE FROM organization_members WHERE org_member_id = $1', [invitedOwnerId]);

  // 1.6 No-op update: Sole owner updating role to 'owner' succeeds (200 OK)
  const noopUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'owner' },
  });
  assert.equal(noopUpdate.statusCode, 200, 'No-op update to owner succeeds');

  // Verify DB state: Alice is still owner
  const aliceRow = await db.query(
    'SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, alice.sub]
  );
  assert.equal(aliceRow.rows[0].role, 'owner', 'Alice remains confirmed owner');
});

// ============================================================================
// 2. Sole Owner Removal Invariants
// ============================================================================
test('Challenger Invariant 2: Sole Owner Removal Prevention across all vectors', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_inv_2');
  const bob = await registerProfile('bob_inv_2');
  const sysAdmin = await registerProfile('sysadmin_inv_2', { admin: true });

  const org = await createOrg(alice, 'Removal Defense Org');
  const orgId = org.org_id;

  // Add Bob as admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_2', role: 'admin' },
  });

  // 2.1 Sole owner voluntary self-leave rejected with 400
  const selfLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
  });
  assert.equal(selfLeave.statusCode, 400, 'Sole owner self-leave must fail with 400');
  assert.ok(
    selfLeave.data?.error?.includes('SOLE_OWNER') || selfLeave.data?.message?.includes('sole owner'),
    'Response indicates SOLE_OWNER_PROTECTION'
  );

  // 2.2 Admin attempting to remove sole owner is blocked (403 Forbidden)
  const adminEvict = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
  });
  assert.equal(adminEvict.statusCode, 403, 'Admin cannot evict owner (403)');

  // 2.3 System admin attempting to remove sole owner is rejected (400 Bad Request)
  const sysAdminRemove = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: sysAdmin,
  });
  assert.equal(sysAdminRemove.statusCode, 400, 'System admin cannot remove sole owner (400)');

  // Verify Alice still exists in organization
  const memCheck = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, alice.sub]
  );
  assert.equal(memCheck.rows.length, 1, 'Sole owner remains in organization_members');
});

// ============================================================================
// 3. Multi-Owner Succession & Ownership Transfer
// ============================================================================
test('Challenger Invariant 3: Multi-Owner Succession, Promotion & Safe Transfer', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_inv_3');
  const bob = await registerProfile('bob_inv_3');
  const charlie = await registerProfile('charlie_inv_3');

  const org = await createOrg(alice, 'Succession Org');
  const orgId = org.org_id;

  // Add Bob as admin, Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_3', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_inv_3', role: 'member' },
  });

  // 3.1 Privilege escalation: Admin (Bob) cannot promote himself to owner
  const bobSelfPromote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'owner' },
  });
  assert.equal(bobSelfPromote.statusCode, 403, 'Admin cannot self-promote to owner');

  // 3.2 Owner (Alice) promotes Bob to Owner
  const alicePromoteBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'owner' },
  });
  assert.equal(alicePromoteBob.statusCode, 200, 'Owner can promote another user to owner');
  assert.equal(alicePromoteBob.data.member.role, 'owner');

  // Verify DB: Exactly 2 owners exist
  const ownerCountRes = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(ownerCountRes.rows[0].count), 2, 'Exactly 2 confirmed owners in DB');

  // 3.3 Now Alice can safely step down to Admin
  const aliceStepDown = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceStepDown.statusCode, 200, 'Alice can step down when second owner exists');
  assert.equal(aliceStepDown.data.member.role, 'admin');

  // Verify DB: Bob is now sole owner
  const newOwnerCount = await db.query(
    "SELECT COUNT(*) AS count FROM organization_members WHERE org_id = $1 AND role = 'owner' AND status = 'confirmed'",
    [orgId]
  );
  assert.equal(Number(newOwnerCount.rows[0].count), 1, 'Bob is now the sole confirmed owner');

  // 3.4 Bob is now protected: Bob cannot demote himself
  const bobDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'admin' },
  });
  assert.equal(bobDemote.statusCode, 400, 'New sole owner Bob cannot demote himself');

  // 3.5 Bob cannot be removed by Alice (Alice is now admin)
  const aliceRemoveBob = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
  });
  assert.equal(aliceRemoveBob.statusCode, 403, 'Demoted admin Alice cannot remove owner Bob');

  // 3.6 Bob promotes Charlie to owner, then Bob leaves voluntarily
  await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: bob,
    body: { role: 'owner' },
  });

  const bobLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
  });
  assert.equal(bobLeave.statusCode, 200, 'Bob can leave after transferring ownership to Charlie');

  // Verify Charlie is now sole owner and Bob is gone
  const bobInOrg = await db.query(
    'SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, bob.sub]
  );
  assert.equal(bobInOrg.rows.length, 0, 'Bob is removed from organization');

  const charlieRow = await db.query(
    'SELECT role FROM organization_members WHERE org_id = $1 AND user_id = $2',
    [orgId, charlie.sub]
  );
  assert.equal(charlieRow.rows[0].role, 'owner', 'Charlie is confirmed owner');
});

// ============================================================================
// 4. Member Removal Cascade Cleanup & Resource Isolation
// ============================================================================
test('Challenger Invariant 4: Member Removal clean cascade for groups/grants and preservation of personal vault', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_inv_4');
  const charlie = await registerProfile('charlie_inv_4');

  // Create Org 1
  const org1 = await createOrg(alice, 'Cascade Cleanup Org 1');
  const org1Id = org1.org_id;

  // Add Charlie to Org 1
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${org1Id}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_inv_4', role: 'member' },
  });

  // Create Groups in Org 1
  const g1Id = crypto.randomUUID();
  const g2Id = crypto.randomUUID();
  await db.query(
    `INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Group 1', $3), ($4, $2, 'Group 2', $3)`,
    [g1Id, org1Id, alice.sub, g2Id]
  );

  // Add Charlie to both groups
  await db.query(
    `INSERT INTO group_members (group_member_id, group_id, user_id, role)
     VALUES ($1, $2, $3, 'member'), ($4, $5, $3, 'member')`,
    [crypto.randomUUID(), g1Id, charlie.sub, crypto.randomUUID(), g2Id]
  );

  // Create Collections in Org 1
  const c1Id = crypto.randomUUID();
  const c2Id = crypto.randomUUID();
  await db.query(
    `INSERT INTO collections (collection_id, org_id, name, created_by) VALUES ($1, $2, 'Collection 1', $3), ($4, $2, 'Collection 2', $3)`,
    [c1Id, org1Id, alice.sub, c2Id]
  );

  // Grant Charlie direct collection access and collection key on C1
  await db.query(
    `INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission)
     VALUES ($1, $2, 'user', $3, 'write')`,
    [crypto.randomUUID(), c1Id, charlie.sub]
  );
  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), c1Id, charlie.sub, JSON.stringify(VALID_WRAPPED_KEY)]
  );

  // Create an unrelated second organization (Org 2) where Charlie is also a member
  const org2 = await createOrg(alice, 'Unrelated Org 2');
  const org2Id = org2.org_id;
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${org2Id}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_inv_4', role: 'member' },
  });

  const g3Id = crypto.randomUUID();
  await db.query(`INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Group 3', $3)`, [g3Id, org2Id, alice.sub]);
  await db.query(`INSERT INTO group_members (group_member_id, group_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [crypto.randomUUID(), g3Id, charlie.sub]);

  // Charlie has personal vault and items
  const personalVaultId = crypto.randomUUID();
  await db.query(
    `INSERT INTO vaults (vault_id, user_id, name, is_shared) VALUES ($1, $2, 'Charlie Personal Vault', false)`,
    [personalVaultId, charlie.sub]
  );
  const personalItemId = crypto.randomUUID();
  await db.query(
    `INSERT INTO vault_items (item_id, vault_id, user_id, item_type, encrypted_data)
     VALUES ($1, $2, $3, 'login', $4)`,
    [personalItemId, personalVaultId, charlie.sub, JSON.stringify({ ciphertext: 'secret_login' })]
  );

  // --- ACT: Alice removes Charlie from Org 1 ---
  const removeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${org1Id}/members/${charlie.sub}`,
    claims: alice,
  });
  assert.equal(removeRes.statusCode, 200, 'Member removal returns 200 OK');

  // --- ASSERTIONS: Cascade Cleanup within Org 1 ---
  // 1. Charlie is removed from organization_members for Org 1
  const org1Member = await db.query('SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2', [org1Id, charlie.sub]);
  assert.equal(org1Member.rows.length, 0, 'Charlie removed from Org 1 members');

  // 2. Charlie is removed from Group 1 and Group 2 (scoped to Org 1)
  const g1Mem = await db.query('SELECT * FROM group_members WHERE group_id IN ($1, $2) AND user_id = $3', [g1Id, g2Id, charlie.sub]);
  assert.equal(g1Mem.rows.length, 0, 'Charlie group memberships in Org 1 purged');

  // 3. Charlie's direct collection access in Org 1 is purged
  const cAccess = await db.query(
    `SELECT * FROM collection_access WHERE target_type = 'user' AND target_id = $1 AND collection_id IN ($2, $3)`,
    [charlie.sub, c1Id, c2Id]
  );
  assert.equal(cAccess.rows.length, 0, 'Charlie direct collection access in Org 1 purged');

  // 4. Charlie's collection keys in Org 1 are purged
  const cKeys = await db.query(
    `SELECT * FROM collection_keys WHERE user_id = $1 AND collection_id IN ($2, $3)`,
    [charlie.sub, c1Id, c2Id]
  );
  assert.equal(cKeys.rows.length, 0, 'Charlie collection keys in Org 1 purged');

  // --- ASSERTIONS: Preservation of Unrelated Resources ---
  // 5. Charlie's user profile in users table is intact
  const userCheck = await db.query('SELECT * FROM users WHERE user_id = $1', [charlie.sub]);
  assert.equal(userCheck.rows.length, 1, 'Charlie user account remains intact');

  // 6. Charlie's personal vault and items are intact
  const vaultCheck = await db.query('SELECT * FROM vaults WHERE vault_id = $1', [personalVaultId]);
  assert.equal(vaultCheck.rows.length, 1, 'Personal vault remains intact');
  const itemCheck = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [personalItemId]);
  assert.equal(itemCheck.rows.length, 1, 'Personal vault item remains intact');

  // 7. Charlie's membership and group membership in Org 2 are intact
  const org2Member = await db.query('SELECT * FROM organization_members WHERE org_id = $1 AND user_id = $2', [org2Id, charlie.sub]);
  assert.equal(org2Member.rows.length, 1, 'Charlie Org 2 membership intact');
  const g3Mem = await db.query('SELECT * FROM group_members WHERE group_id = $1 AND user_id = $2', [g3Id, charlie.sub]);
  assert.equal(g3Mem.rows.length, 1, 'Charlie Group 3 membership in Org 2 intact');
});

// ============================================================================
// 5. Organization Deletion Cascade Cleanup
// ============================================================================
test('Challenger Invariant 5: Organization Deletion complete cascade without orphaned records or FK violations', async () => {
  const db = await resetDatabase();
  const alice = await registerProfile('alice_inv_5');
  const bob = await registerProfile('bob_inv_5');
  const charlie = await registerProfile('charlie_inv_5');

  const org = await createOrg(alice, 'Doomed Org');
  const orgId = org.org_id;

  // Add Bob as admin, Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_5', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_inv_5', role: 'member' },
  });

  // Create an invitation
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: alice,
    body: { email: 'pending_contractor@partner.com', role: 'member' },
  });

  // Create scoped groups
  const g1Id = crypto.randomUUID();
  await db.query(`INSERT INTO groups (group_id, org_id, name, created_by) VALUES ($1, $2, 'Ops Group', $3)`, [g1Id, orgId, alice.sub]);
  await db.query(`INSERT INTO group_members (group_member_id, group_id, user_id, role) VALUES ($1, $2, $3, 'member')`, [crypto.randomUUID(), g1Id, bob.sub]);

  // Create scoped collections
  const c1Id = crypto.randomUUID();
  await db.query(`INSERT INTO collections (collection_id, org_id, name, created_by) VALUES ($1, $2, 'Shared Keys', $3)`, [c1Id, orgId, alice.sub]);

  // Create direct user grant and polymorphic group grant
  await db.query(
    `INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission)
     VALUES ($1, $2, 'user', $3, 'read'), ($4, $2, 'group', $5, 'write')`,
    [crypto.randomUUID(), c1Id, charlie.sub, crypto.randomUUID(), g1Id]
  );

  // Create collection key
  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient)
     VALUES ($1, $2, $3, $4)`,
    [crypto.randomUUID(), c1Id, bob.sub, JSON.stringify(VALID_WRAPPED_KEY)]
  );

  // Link a vault item to the collection
  const vaultId = crypto.randomUUID();
  await db.query(`INSERT INTO vaults (vault_id, user_id, name) VALUES ($1, $2, 'Alice Vault')`, [vaultId, alice.sub]);
  const itemId = crypto.randomUUID();
  await db.query(
    `INSERT INTO vault_items (item_id, vault_id, user_id, item_type, encrypted_data)
     VALUES ($1, $2, $3, 'server', $4)`,
    [itemId, vaultId, alice.sub, JSON.stringify({ ciphertext: 'server_credentials' })]
  );
  await db.query(
    `INSERT INTO collection_items (collection_item_id, collection_id, item_id) VALUES ($1, $2, $3)`,
    [crypto.randomUUID(), c1Id, itemId]
  );

  // 5.1 Non-owner cannot delete organization
  const charlieDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
  });
  assert.equal(charlieDelete.statusCode, 403, 'Member cannot delete organization');

  const bobDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(bobDelete.statusCode, 403, 'Admin cannot delete organization');

  // 5.2 Owner deletes organization -> succeeds with 200 OK
  const ownerDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
  });
  assert.equal(ownerDelete.statusCode, 200, 'Owner successfully deletes organization');
  assert.equal(ownerDelete.data.deleted, true);

  // 5.3 Cascade verification across all tables
  const orgRow = await db.query('SELECT * FROM organizations WHERE org_id = $1', [orgId]);
  assert.equal(orgRow.rows.length, 0, 'Organization deleted');

  const membersRows = await db.query('SELECT * FROM organization_members WHERE org_id = $1', [orgId]);
  assert.equal(membersRows.rows.length, 0, 'Organization members cascaded');

  const invRows = await db.query('SELECT * FROM organization_invitations WHERE org_id = $1', [orgId]);
  assert.equal(invRows.rows.length, 0, 'Organization invitations cascaded');

  const groupRows = await db.query('SELECT * FROM groups WHERE org_id = $1', [orgId]);
  assert.equal(groupRows.rows.length, 0, 'Groups cascaded');

  const groupMemRows = await db.query('SELECT * FROM group_members WHERE group_id = $1', [g1Id]);
  assert.equal(groupMemRows.rows.length, 0, 'Group members cascaded');

  const colRows = await db.query('SELECT * FROM collections WHERE org_id = $1', [orgId]);
  assert.equal(colRows.rows.length, 0, 'Collections cascaded');

  const colAccessRows = await db.query('SELECT * FROM collection_access WHERE collection_id = $1', [c1Id]);
  assert.equal(colAccessRows.rows.length, 0, 'Collection access cascaded');

  // Verify group-targeted polymorphic access was purged without orphan
  const orphanAccess = await db.query(
    "SELECT * FROM collection_access WHERE target_type = 'group' AND target_id = $1",
    [g1Id]
  );
  assert.equal(orphanAccess.rows.length, 0, 'Polymorphic group collection_access purged cleanly');

  const colKeyRows = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1', [c1Id]);
  assert.equal(colKeyRows.rows.length, 0, 'Collection keys cascaded');

  const colItemRows = await db.query('SELECT * FROM collection_items WHERE collection_id = $1', [c1Id]);
  assert.equal(colItemRows.rows.length, 0, 'Collection item links cascaded');

  // 5.4 Vault items and user accounts remain fully intact
  const itemCheck = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [itemId]);
  assert.equal(itemCheck.rows.length, 1, 'Underlying vault item preserved');

  const usersCheck = await db.query(
    'SELECT * FROM users WHERE user_id IN ($1, $2, $3)',
    [alice.sub, bob.sub, charlie.sub]
  );
  assert.equal(usersCheck.rows.length, 3, 'User accounts preserved');
});

// ============================================================================
// 6. Cross-Tenant IDOR and Privilege Boundaries
// ============================================================================
test('Challenger Invariant 6: Strict Cross-Tenant IDOR and Privilege Isolation', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_inv_6');
  const bob = await registerProfile('bob_inv_6');

  // Org 1 owned by Alice
  await createOrg(alice, 'Tenant One Org');
  // Org 2 owned by Bob
  const org2 = await createOrg(bob, 'Tenant Two Org');

  // Alice attempts to update Bob's organization -> 403 Forbidden
  const idorUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${org2.org_id}`,
    claims: alice,
    body: { name: 'Alice Tampered Name' },
  });
  assert.equal(idorUpdate.statusCode, 403, 'Cross-tenant update blocked');

  // Alice attempts to delete Bob's organization -> 403 Forbidden
  const idorDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${org2.org_id}`,
    claims: alice,
  });
  assert.equal(idorDelete.statusCode, 403, 'Cross-tenant delete blocked');

  // Alice attempts to add a member to Bob's organization -> 403 Forbidden
  const idorAddMember = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${org2.org_id}/members`,
    claims: alice,
    body: { usernameOrEmail: 'alice_inv_6', role: 'member' },
  });
  assert.equal(idorAddMember.statusCode, 403, 'Cross-tenant member add blocked');

  // Alice attempts to list members in Bob's organization -> 403 Forbidden
  const idorListMembers = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${org2.org_id}/members`,
    claims: alice,
  });
  assert.equal(idorListMembers.statusCode, 403, 'Cross-tenant member list blocked');
});

// ============================================================================
// 7. Mutual Demotion & Race Order Invariants
// ============================================================================
test('Challenger Invariant 7: Mutual Demotion & Sequential Race Order', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_inv_7');
  const bob = await registerProfile('bob_inv_7');

  const org = await createOrg(alice, 'Mutual Demotion Org');
  const orgId = org.org_id;

  // Alice adds Bob as Owner
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_7', role: 'owner' },
  });

  // Both Alice and Bob are owners (count = 2)
  // Alice demotes Bob to member first -> succeeds
  const aliceDemotesBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(aliceDemotesBob.statusCode, 200, 'Alice can demote Bob when 2 owners exist');

  // Now Bob is a member. Bob attempts to demote Alice -> 403 Forbidden
  const bobDemotesAlice = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(bobDemotesAlice.statusCode, 403, 'Demoted Bob cannot demote Alice (403)');

  // Alice is now the sole owner. Alice attempts to demote herself -> 400 Bad Request
  const aliceDemotesSelf = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceDemotesSelf.statusCode, 400, 'Alice cannot demote herself as sole owner');
});

// ============================================================================
// 8. Role Input Boundary Fuzzing & Normalization
// ============================================================================
test('Challenger Invariant 8: Role input boundary fuzzing, casing normalization and error handling', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_inv_8');
  const bob = await registerProfile('bob_inv_8');

  const org = await createOrg(alice, 'Role Fuzzing Org');
  const orgId = org.org_id;

  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_8', role: 'member' },
  });

  // Uppercase role 'ADMIN' is accepted and normalized to 'admin'
  const upperRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'ADMIN' },
  });
  assert.equal(upperRes.statusCode, 200, 'Uppercase ADMIN normalized');
  assert.equal(upperRes.data.member.role, 'admin');

  // Mixed case role 'oWnEr' is accepted and normalized to 'owner'
  const mixedRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'oWnEr' },
  });
  assert.equal(mixedRes.statusCode, 200, 'Mixed-case oWnEr normalized');
  assert.equal(mixedRes.data.member.role, 'owner');

  // Demote Bob back to member using 'user' synonym
  const synonymRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'user' },
  });
  assert.equal(synonymRes.statusCode, 200, 'user synonym accepted as member');
  assert.equal(synonymRes.data.member.role, 'member');

  // Fuzz with invalid roles: empty, invalid string, injection, number
  for (const badRole of ['', 'superadmin', 'root', 'owner\x00', 'admin; DROP TABLE users;', null, 123]) {
    const badRes = await callRouter({
      method: 'PUT',
      path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
      claims: alice,
      body: { role: badRole },
    });
    assert.equal(badRes.statusCode, 400, `Role '${badRole}' must be rejected with 400`);
  }
});

// ============================================================================
// 9. Case-Insensitive Lookup & Duplicate Prevention
// ============================================================================
test('Challenger Invariant 9: Case-insensitive member add and conflict detection', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_inv_9');
  await registerProfile('bob_inv_9');

  const org = await createOrg(alice, 'Lookup Org');
  const orgId = org.org_id;

  // Add Bob using mixed case username 'BoB_iNv_9'
  const addBob = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'BoB_iNv_9', role: 'member' },
  });
  assert.equal(addBob.statusCode, 201, 'Case-insensitive username lookup succeeds');

  // Attempt to add Bob again using uppercase email -> 409 Conflict
  const dupEmail = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'BOB_INV_9@SECUREVAULT.IO', role: 'member' },
  });
  assert.equal(dupEmail.statusCode, 409, 'Duplicate membership via uppercase email rejected with 409');

  // Attempt to add Bob again using exact lowercase username -> 409 Conflict
  const dupUser = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inv_9', role: 'member' },
  });
  assert.equal(dupUser.statusCode, 409, 'Duplicate membership via lowercase username rejected with 409');
});

