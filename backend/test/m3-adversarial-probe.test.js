/**
 * Secure Vault Cloud — Milestone M3 Adversarial Challenge Probes
 *
 * Empirical verification of:
 * 1. IDOR Attacks (Cross-tenant boundaries across all 9 endpoints)
 * 2. Privilege Escalation - Member Level (Invite, update org, delete org, role update, member removal, invitations)
 * 3. Privilege Escalation - Admin Level (Owner creation, promotion to owner, demotion of owner, removal of owner, org deletion)
 * 4. Sole Owner Protection Invariants (Sole owner demotion & removal blocks, multi-owner transfer, post-demotion enforcement)
 * 5. Input Boundaries & Malformed Payloads (Length limits, whitespace, unicode, SQL injection strings, oversized descriptions, malformed keys, invalid roles)
 * 6. Non-Existent Entities & Malformed Identifiers (404 for unknown orgId/userId, 400 for invalid UUIDs)
 * 7. Voluntary Member Leave & Instant Access Cutoff
 * 8. Status Invariant: Unconfirmed/Invited Member cannot access org resources
 * 9. Admin Boundary: Admin cannot demote/remove Owner even when multiple owners exist
 * 10. Removal Cascade Boundary: Scoped groups, collection access, and keys purged cleanly
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetDatabase, getDatabase } from '../src/db/adapter.js';
import { callRouter, registerProfile } from './helpers.js';

const VALID_WRAPPED_KEY = {
  ciphertext: 'd3JhcHBlZC1vcmcta2V5LWNpcGhlcnRleHQ=',
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
};

async function createOrg(claims, name = 'Test Org', description = 'Org Description', encryptedOrgKey = null) {
  const body = { name, description };
  if (encryptedOrgKey) {
    body.encryptedOrgKey = encryptedOrgKey;
  }
  return callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body,
  });
}

test('CHALLENGE 1: Cross-Organization IDOR Defense across all endpoints', async () => {
  await resetDatabase();
  const userA = await registerProfile('user_a_m3');
  const userB = await registerProfile('user_b_m3');

  // User A creates Org A
  const orgARes = await createOrg(userA, 'Org Alpha', 'User A Organization', VALID_WRAPPED_KEY);
  assert.equal(orgARes.statusCode, 201);
  const orgAId = orgARes.data.organization.org_id;

  // User B creates Org B
  const orgBRes = await createOrg(userB, 'Org Beta', 'User B Organization', VALID_WRAPPED_KEY);
  assert.equal(orgBRes.statusCode, 201);
  const orgBId = orgBRes.data.organization.org_id;

  // Probe 1.1: User B attempts GET Org A
  const getOrgA = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}`,
    claims: userB,
  });
  assert.equal(getOrgA.statusCode, 403, 'IDOR GET org must return 403');

  // Probe 1.2: User B attempts PUT Org A
  const updateOrgA = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgAId}`,
    claims: userB,
    body: { name: 'Compromised Name' },
  });
  assert.equal(updateOrgA.statusCode, 403, 'IDOR PUT org must return 403');

  // Probe 1.3: User B attempts DELETE Org A
  const deleteOrgA = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}`,
    claims: userB,
  });
  assert.equal(deleteOrgA.statusCode, 403, 'IDOR DELETE org must return 403');

  // Probe 1.4: User B attempts GET Org A members
  const getMembersA = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/members`,
    claims: userB,
  });
  assert.equal(getMembersA.statusCode, 403, 'IDOR GET members must return 403');

  // Probe 1.5: User B attempts POST Org A members (add member)
  const addMemberA = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/members`,
    claims: userB,
    body: { usernameOrEmail: 'user_b_m3', role: 'member' },
  });
  assert.equal(addMemberA.statusCode, 403, 'IDOR POST members must return 403');

  // Probe 1.6: User B attempts PUT Org A member role
  const updateRoleA = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgAId}/members/${userA.sub}`,
    claims: userB,
    body: { role: 'member' },
  });
  assert.equal(updateRoleA.statusCode, 403, 'IDOR PUT member role must return 403');

  // Probe 1.7: User B attempts DELETE Org A member
  const deleteMemberA = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}/members/${userA.sub}`,
    claims: userB,
  });
  assert.equal(deleteMemberA.statusCode, 403, 'IDOR DELETE member must return 403');

  // Probe 1.8: User B attempts POST Org A invitations
  const createInvA = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/invitations`,
    claims: userB,
    body: { email: 'external@attack.com', role: 'member' },
  });
  assert.equal(createInvA.statusCode, 403, 'IDOR POST invitations must return 403');

  // Probe 1.9: User B attempts GET Org A invitations
  const listInvA = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/invitations`,
    claims: userB,
  });
  assert.equal(listInvA.statusCode, 403, 'IDOR GET invitations must return 403');

  // Probe 1.10: User B lists organizations -> Org A is completely excluded
  const listB = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations',
    claims: userB,
  });
  assert.equal(listB.statusCode, 200);
  assert.equal(listB.data.organizations.length, 1);
  assert.equal(listB.data.organizations[0].org_id, orgBId);
  assert.ok(!listB.data.organizations.some((o) => o.org_id === orgAId));
});

test('CHALLENGE 2: Privilege Escalation Guards — Standard Member Restrictions', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_crit');
  const memberUser = await registerProfile('member_user_m3');
  await registerProfile('target_user_m3');

  const orgRes = await createOrg(alice, 'Secure Corp');
  const orgId = orgRes.data.organization.org_id;

  // Alice adds memberUser as 'member'
  const addRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'member_user_m3', role: 'member' },
  });
  assert.equal(addRes.statusCode, 201);

  // Probe 2.1: Member attempts to invite user -> 403
  const inviteRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: memberUser,
    body: { usernameOrEmail: 'target_user_m3', role: 'member' },
  });
  assert.equal(inviteRes.statusCode, 403, 'Member cannot add/invite users');

  // Probe 2.2: Member attempts to update organization metadata -> 403
  const updateOrgRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: memberUser,
    body: { name: 'Member Hijacked Org' },
  });
  assert.equal(updateOrgRes.statusCode, 403, 'Member cannot update organization');

  // Probe 2.3: Member attempts to delete organization -> 403
  const deleteOrgRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: memberUser,
  });
  assert.equal(deleteOrgRes.statusCode, 403, 'Member cannot delete organization');

  // Probe 2.4: Member attempts to promote self or alter roles -> 403
  const alterRoleRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${memberUser.sub}`,
    claims: memberUser,
    body: { role: 'admin' },
  });
  assert.equal(alterRoleRes.statusCode, 403, 'Member cannot promote self');

  // Probe 2.5: Member attempts to remove another member -> 403
  const removeOtherRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: memberUser,
  });
  assert.equal(removeOtherRes.statusCode, 403, 'Member cannot remove other members');

  // Probe 2.6: Member attempts to create invitations -> 403
  const invCreateRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: memberUser,
    body: { email: 'external_invite@test.com', role: 'member' },
  });
  assert.equal(invCreateRes.statusCode, 403, 'Member cannot create invitations');

  // Probe 2.7: Member attempts to list invitations -> 403
  const invListRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: memberUser,
  });
  assert.equal(invListRes.statusCode, 403, 'Member cannot list invitations');
});

test('CHALLENGE 3: Privilege Escalation Guards — Admin Restrictions & Boundaries', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_adm');
  const adminUser = await registerProfile('admin_user_m3');
  const victimUser = await registerProfile('victim_user_m3');

  const orgRes = await createOrg(alice, 'Admin Corp');
  const orgId = orgRes.data.organization.org_id;

  // Alice adds adminUser as 'admin' and victimUser as 'member'
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'admin_user_m3', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'victim_user_m3', role: 'member' },
  });

  // Probe 3.1: Admin attempts to directly add new member with role 'owner' -> 403
  const newOwnerRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: adminUser,
    body: { usernameOrEmail: 'target_new@example.com', role: 'owner' },
  });
  assert.equal(newOwnerRes.statusCode, 403, 'Admin cannot add member as owner');

  // Probe 3.2: Admin attempts to promote victimUser to 'owner' -> 403
  const promoteRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${victimUser.sub}`,
    claims: adminUser,
    body: { role: 'owner' },
  });
  assert.equal(promoteRes.statusCode, 403, 'Admin cannot promote member to owner');

  // Probe 3.3: Admin attempts to demote owner Alice to 'member' -> 403
  const demoteOwnerRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: adminUser,
    body: { role: 'member' },
  });
  assert.equal(demoteOwnerRes.statusCode, 403, 'Admin cannot demote owner');

  // Probe 3.4: Admin attempts to remove owner Alice -> 403
  const removeOwnerRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: adminUser,
  });
  assert.equal(removeOwnerRes.statusCode, 403, 'Admin cannot remove owner');

  // Probe 3.5: Admin attempts to delete the organization -> 403
  const deleteOrgRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: adminUser,
  });
  assert.equal(deleteOrgRes.statusCode, 403, 'Admin cannot delete organization');
});

test('CHALLENGE 4: Sole Owner Invariant Protection & Safe Succession', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_sole');
  const bob = await registerProfile('bob_m3_sole');

  const orgRes = await createOrg(alice, 'Succession Corp');
  const orgId = orgRes.data.organization.org_id;

  // Probe 4.1: Sole owner Alice attempts to demote herself -> 400 Bad Request
  const selfDemoteRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(selfDemoteRes.statusCode, 400, 'Demoting sole owner must return 400');
  assert.equal(selfDemoteRes.data.error, 'SOLE_OWNER_PROTECTION');

  // Probe 4.2: Sole owner Alice attempts to remove herself -> 400 Bad Request
  const selfRemoveRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
  });
  assert.equal(selfRemoveRes.statusCode, 400, 'Removing sole owner must return 400');
  assert.equal(selfRemoveRes.data.error, 'SOLE_OWNER_PROTECTION');

  // Succession: Alice adds Bob as Owner
  const addBobOwner = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_sole', role: 'owner' },
  });
  assert.equal(addBobOwner.statusCode, 201);
  assert.equal(addBobOwner.data.member.role, 'owner');

  // Probe 4.3: With two active owners, Alice can now step down to admin -> 200 OK
  const stepDownRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(stepDownRes.statusCode, 200, 'Owner can step down when another owner exists');
  assert.equal(stepDownRes.data.member.role, 'admin');

  // Probe 4.4: Now Bob is sole owner -> Bob cannot demote himself
  const bobDemoteRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(bobDemoteRes.statusCode, 400, 'New sole owner cannot demote self');

  // Probe 4.5: Bob cannot be removed by Alice (who is now admin) -> 403
  const aliceRemoveBob = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
  });
  assert.equal(aliceRemoveBob.statusCode, 403, 'Demoted admin cannot remove remaining owner');
});

test('CHALLENGE 5: Input Boundary, Malformed Payload & Injection Robustness', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_input');

  // Probe 5.1: Empty name -> 400
  const emptyName = await createOrg(alice, '');
  assert.equal(emptyName.statusCode, 400);

  // Probe 5.2: Whitespace-only name -> 400
  const wsName = await createOrg(alice, '   \t\r\n   ');
  assert.equal(wsName.statusCode, 400);

  // Probe 5.3: Name > 255 chars -> 400
  const overName = await createOrg(alice, 'X'.repeat(256));
  assert.equal(overName.statusCode, 400);

  // Probe 5.4: Name exactly 255 chars -> 201 Created
  const maxName = 'Y'.repeat(255);
  const maxNameRes = await createOrg(alice, maxName);
  assert.equal(maxNameRes.statusCode, 201);
  assert.equal(maxNameRes.data.organization.name, maxName);
  const testOrgId = maxNameRes.data.organization.org_id;

  // Probe 5.5: Unicode / Emoji / International name -> 201 Created
  const unicodeName = '🔒 บริษัททดสอบ SecureOrg องค์กรปลอดภัย 日本語 🏢';
  const unicodeRes = await createOrg(alice, unicodeName);
  assert.equal(unicodeRes.statusCode, 201);
  assert.equal(unicodeRes.data.organization.name, unicodeName);

  // Probe 5.6: SQL Injection characters in organization name and description -> Stored safely
  const sqliName = "Acme'; DROP TABLE organizations; --";
  const sqliDesc = "Description'; SELECT * FROM users WHERE '1'='1";
  const sqliRes = await createOrg(alice, sqliName, sqliDesc);
  assert.equal(sqliRes.statusCode, 201);
  assert.equal(sqliRes.data.organization.name, sqliName);
  assert.equal(sqliRes.data.organization.description, sqliDesc);

  // Verify database integrity: organizations table still intact
  const db = getDatabase();
  const checkDb = await db.query('SELECT COUNT(*) AS count FROM organizations');
  assert.ok(Number(checkDb.rows[0].count) >= 3);

  // Probe 5.7: Description > 2000 chars -> 400
  const overDesc = await createOrg(alice, 'Valid Name', 'D'.repeat(2001));
  assert.equal(overDesc.statusCode, 400);

  // Probe 5.8: Malformed wrapped key payloads -> 400
  const badKey1 = await createOrg(alice, 'Bad Key 1', 'Desc', { ciphertext: 12345 });
  assert.equal(badKey1.statusCode, 400);

  const badKey2 = await createOrg(alice, 'Bad Key 2', 'Desc', { ciphertext: '' });
  assert.equal(badKey2.statusCode, 400);

  const badKey3 = await createOrg(alice, 'Bad Key 3', 'Desc', 'string-not-an-object');
  assert.equal(badKey3.statusCode, 400);

  // Probe 5.9: Invalid member role on add -> 400
  const invalidRoleAdd = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${testOrgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'alice_m3_input', role: 'superadmin_invalid' },
  });
  assert.equal(invalidRoleAdd.statusCode, 400);

  // Probe 5.10: Invalid member role on update -> 400
  const invalidRoleUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${testOrgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'superuser_unsupported' },
  });
  assert.equal(invalidRoleUpdate.statusCode, 400);

  // Probe 5.11: Malformed JSON body in POST -> 400
  const malformedJson = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: '{ invalid_json_syntax: true ',
  });
  assert.equal(malformedJson.statusCode, 400);
});

test('CHALLENGE 6: Non-Existent Entities & Malformed Identifiers', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_nonexist');
  const randomOrgId = crypto.randomUUID();
  const randomUserId = crypto.randomUUID();

  // Probe 6.1: Non-existent orgId on GET -> 404
  const get404 = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${randomOrgId}`,
    claims: alice,
  });
  assert.equal(get404.statusCode, 404);

  // Probe 6.2: Non-existent orgId on PUT -> 404
  const put404 = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${randomOrgId}`,
    claims: alice,
    body: { name: 'Update Ghost' },
  });
  assert.equal(put404.statusCode, 404);

  // Probe 6.3: Non-existent orgId on DELETE -> 404
  const del404 = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${randomOrgId}`,
    claims: alice,
  });
  assert.equal(del404.statusCode, 404);

  // Probe 6.4: Non-existent orgId on members list -> 404
  const members404 = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${randomOrgId}/members`,
    claims: alice,
  });
  assert.equal(members404.statusCode, 404);

  // Probe 6.5: Non-existent orgId on add member -> 404
  const addMem404 = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${randomOrgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'alice_m3_nonexist', role: 'member' },
  });
  assert.equal(addMem404.statusCode, 404);

  // Create valid org to test non-existent member
  const validOrg = await createOrg(alice, 'Valid Org');
  const orgId = validOrg.data.organization.org_id;

  // Probe 6.6: Non-existent userId on update member role -> 404
  const updateMem404 = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${randomUserId}`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(updateMem404.statusCode, 404);

  // Probe 6.7: Non-existent userId on delete member -> 404
  const deleteMem404 = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${randomUserId}`,
    claims: alice,
  });
  assert.equal(deleteMem404.statusCode, 404);

  // Probe 6.8: Malformed UUID in orgId -> 400
  const malformedOrgId = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations/not-a-valid-uuid',
    claims: alice,
  });
  assert.equal(malformedOrgId.statusCode, 400);

  // Probe 6.9: Malformed UUID in userId -> 400
  const malformedUserId = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/invalid-uuid-format`,
    claims: alice,
    body: { role: 'member' },
  });
  assert.equal(malformedUserId.statusCode, 400);

  // Probe 6.10: Path traversal attempt -> 400
  const pathTraversal = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations/..%2f..%2fetc%2fpasswd',
    claims: alice,
  });
  assert.ok(pathTraversal.statusCode === 400 || pathTraversal.statusCode === 404);
});

test('CHALLENGE 7: Voluntary Member Leave & Instant Access Cutoff', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_leave');
  const charlie = await registerProfile('charlie_m3_leave');

  const orgRes = await createOrg(alice, 'Leave Org');
  const orgId = orgRes.data.organization.org_id;

  // Add Charlie as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_m3_leave', role: 'member' },
  });

  // Verify Charlie has access
  const charlieAccessBefore = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
  });
  assert.equal(charlieAccessBefore.statusCode, 200);

  // Charlie voluntarily leaves (removes self) -> 200 OK
  const leaveRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: charlie,
  });
  assert.equal(leaveRes.statusCode, 200);
  assert.equal(leaveRes.data.removed, true);

  // Probe 7.1: Immediate GET org details by Charlie -> 403 Forbidden
  const cutOffOrg = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
  });
  assert.equal(cutOffOrg.statusCode, 403, 'Cutoff: member cannot view org after leaving');

  // Probe 7.2: Immediate GET member list by Charlie -> 403 Forbidden
  const cutOffMembers = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: charlie,
  });
  assert.equal(cutOffMembers.statusCode, 403, 'Cutoff: member cannot view members after leaving');
});

test('CHALLENGE 8: Status Invariant — Unconfirmed/Invited Member cannot access org resources', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_status');
  const invitedUser = await registerProfile('invited_user_m3');

  const orgRes = await createOrg(alice, 'Status Org');
  const orgId = orgRes.data.organization.org_id;

  // Manually insert an 'invited' status membership (or simulate pending invitation acceptance)
  const db = getDatabase();
  const memberId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'member', 'invited', $4, $5)`,
    [memberId, orgId, invitedUser.sub, now, now]
  );

  // Probe 8.1: Invited (unconfirmed) user attempts to get org -> 403 Forbidden
  const invitedGetOrg = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: invitedUser,
  });
  assert.equal(invitedGetOrg.statusCode, 403, 'Invited unconfirmed member must receive 403');

  // Probe 8.2: Invited user attempts to list members -> 403 Forbidden
  const invitedGetMembers = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: invitedUser,
  });
  assert.equal(invitedGetMembers.statusCode, 403, 'Invited unconfirmed member cannot list members');
});

test('CHALLENGE 9: Admin Boundary — Admin cannot demote/remove Owner even when multiple owners exist', async () => {
  await resetDatabase();
  const owner1 = await registerProfile('owner1_m3');
  const owner2 = await registerProfile('owner2_m3');
  const admin = await registerProfile('admin_boundary_m3');

  const orgRes = await createOrg(owner1, 'Multi-Owner Corp');
  const orgId = orgRes.data.organization.org_id;

  // Owner 1 adds Owner 2
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: owner1,
    body: { usernameOrEmail: 'owner2_m3', role: 'owner' },
  });

  // Owner 1 adds Admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: owner1,
    body: { usernameOrEmail: 'admin_boundary_m3', role: 'admin' },
  });

  // Probe 9.1: Admin attempts to demote Owner 2 (even though 2 owners exist) -> 403 Forbidden
  const demoteAttempt = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${owner2.sub}`,
    claims: admin,
    body: { role: 'member' },
  });
  assert.equal(demoteAttempt.statusCode, 403, 'Admin cannot demote Owner even when multiple owners exist');

  // Probe 9.2: Admin attempts to remove Owner 2 (even though 2 owners exist) -> 403 Forbidden
  const removeAttempt = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${owner2.sub}`,
    claims: admin,
  });
  assert.equal(removeAttempt.statusCode, 403, 'Admin cannot remove Owner even when multiple owners exist');
});

test('CHALLENGE 10: Removal Cascade Boundary — Member removal purges group memberships and collection access', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_cascade');
  const bob = await registerProfile('bob_m3_cascade');

  const orgRes = await createOrg(alice, 'Cascade Scope Org');
  const orgId = orgRes.data.organization.org_id;

  // Add Bob as member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_cascade', role: 'member' },
  });

  // Setup database records simulating group and collection access in this org
  const db = getDatabase();
  const groupId = crypto.randomUUID();
  const colId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    'INSERT INTO groups (group_id, org_id, name, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [groupId, orgId, 'Scope Group', alice.sub, now, now]
  );
  await db.query(
    'INSERT INTO group_members (group_id, user_id, role, created_at) VALUES ($1, $2, $3, $4)',
    [groupId, bob.sub, 'member', now]
  );
  await db.query(
    'INSERT INTO collections (collection_id, org_id, name, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [colId, orgId, 'Scope Col', alice.sub, now, now]
  );
  await db.query(
    'INSERT INTO collection_access (collection_id, target_type, target_id, permission, created_at) VALUES ($1, $2, $3, $4, $5)',
    [colId, 'user', bob.sub, 'read', now]
  );
  const keyId = crypto.randomUUID();
  await db.query(
    'INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [keyId, colId, bob.sub, '{"ciphertext":"dummy"}', now, now]
  );

  // Bob is removed by Alice
  const removeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
  });
  assert.equal(removeRes.statusCode, 200);

  // Probe 10.1: Verify group membership purged
  const gmCheck = await db.query('SELECT * FROM group_members WHERE user_id = $1 AND group_id = $2', [bob.sub, groupId]);
  assert.equal(gmCheck.rows.length, 0, 'Group membership purged upon org member removal');

  // Probe 10.2: Verify direct collection access purged
  const caCheck = await db.query('SELECT * FROM collection_access WHERE target_type = $1 AND target_id = $2', ['user', bob.sub]);
  assert.equal(caCheck.rows.length, 0, 'Collection access grant purged upon org member removal');

  // Probe 10.3: Verify wrapped collection key purged
  const ckCheck = await db.query('SELECT * FROM collection_keys WHERE user_id = $1 AND collection_id = $2', [bob.sub, colId]);
  assert.equal(ckCheck.rows.length, 0, 'Collection key purged upon org member removal');
});
