/**
 * Adversarial Test Probes for Milestone M3.1 (Gen 2 Challenger)
 *
 * Explicitly tests:
 * 1. IDOR Attacks (Cross-tenant boundary isolation)
 * 2. Privilege Escalation (Member -> Admin/Owner actions)
 * 3. Admin Escalation & Sole Owner Protection
 * 4. Input Boundaries & Malformed/Injection Payloads
 * 5. Non-Existent Entities & Malformed UUIDs
 * 6. Voluntary Leave & Live Access Cutoff
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetDatabase, getDatabase } from '../src/db/adapter.js';
import { callRouter, registerProfile } from './helpers.js';

const VALID_KEY = {
  ciphertext: 'd3JhcHBlZC1vcmcta2V5LWNpcGhlcnRleHQ=',
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
};

async function createOrg(claims, name = 'Test Org', description = 'Test description') {
  return await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body: { name, description, encryptedOrgKey: VALID_KEY },
  });
}

test('ADVERSARIAL SUITE 1: IDOR & Cross-Organization Boundary Defense', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_idor');
  const bob = await registerProfile('bob_idor');

  // Alice creates Org A
  const orgRes = await createOrg(alice, 'Alice Confidential Org', 'Top Secret');
  assert.equal(orgRes.statusCode, 201);
  const orgAId = orgRes.data.organization.org_id;

  // Probe 1.1: Bob attempts to GET Alice's org -> 403 Forbidden
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}`,
    claims: bob,
  });
  assert.equal(getRes.statusCode, 403, 'IDOR: Unauthorized user cannot read org');

  // Probe 1.2: Bob attempts to PUT (update) Alice's org -> 403 Forbidden
  const putRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgAId}`,
    claims: bob,
    body: { name: 'Hacked by Bob' },
  });
  assert.equal(putRes.statusCode, 403, 'IDOR: Unauthorized user cannot update org');

  // Probe 1.3: Bob attempts to DELETE Alice's org -> 403 Forbidden
  const delRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}`,
    claims: bob,
  });
  assert.equal(delRes.statusCode, 403, 'IDOR: Unauthorized user cannot delete org');

  // Probe 1.4: Bob attempts to list members of Alice's org -> 403 Forbidden
  const listMemRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/members`,
    claims: bob,
  });
  assert.equal(listMemRes.statusCode, 403, 'IDOR: Unauthorized user cannot list members');

  // Probe 1.5: Bob attempts to add himself or others to Alice's org -> 403 Forbidden
  const addMemRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/members`,
    claims: bob,
    body: { usernameOrEmail: 'bob_idor', role: 'owner' },
  });
  assert.equal(addMemRes.statusCode, 403, 'IDOR: Unauthorized user cannot add members');

  // Probe 1.6: Bob attempts to update member role in Alice's org -> 403 Forbidden
  const updateRoleRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgAId}/members/${alice.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(updateRoleRes.statusCode, 403, 'IDOR: Unauthorized user cannot update member roles');

  // Probe 1.7: Bob attempts to remove Alice from Alice's org -> 403 Forbidden
  const removeMemRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}/members/${alice.sub}`,
    claims: bob,
  });
  assert.equal(removeMemRes.statusCode, 403, 'IDOR: Unauthorized user cannot remove members');

  // Probe 1.8: Bob attempts to list or create invitations for Alice's org -> 403 Forbidden
  const listInvRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/invitations`,
    claims: bob,
  });
  assert.equal(listInvRes.statusCode, 403, 'IDOR: Unauthorized user cannot list invitations');

  const createInvRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/invitations`,
    claims: bob,
    body: { email: 'external@target.com' },
  });
  assert.equal(createInvRes.statusCode, 403, 'IDOR: Unauthorized user cannot create invitations');

  // Probe 1.9: Bob lists organizations -> Does not leak Org A
  const bobList = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations',
    claims: bob,
  });
  assert.equal(bobList.statusCode, 200);
  assert.equal(bobList.data.organizations.length, 0, 'Cross-org boundary: no org leak in list');
});

test('ADVERSARIAL SUITE 2: Privilege Escalation Probes (Member -> Admin/Owner)', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_owner');
  const charlie = await registerProfile('charlie_member');
  await registerProfile('dave_target');

  const orgRes = await createOrg(alice, 'Security Org', 'Testing member boundaries');
  const orgId = orgRes.data.organization.org_id;

  // Alice adds Charlie as standard 'member'
  const addCharlie = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_member', role: 'member' },
  });
  assert.equal(addCharlie.statusCode, 201);

  // Probe 2.1: Charlie (member) attempts to update organization metadata -> 403 Forbidden
  const updateOrg = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
    body: { name: 'Charlie Takeover' },
  });
  assert.equal(updateOrg.statusCode, 403, 'Privilege Escalation: Member cannot update org metadata');

  // Probe 2.2: Charlie (member) attempts to delete organization -> 403 Forbidden
  const deleteOrg = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: charlie,
  });
  assert.equal(deleteOrg.statusCode, 403, 'Privilege Escalation: Member cannot delete org');

  // Probe 2.3: Charlie (member) attempts to invite Dave -> 403 Forbidden
  const inviteUser = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: charlie,
    body: { usernameOrEmail: 'dave_target', role: 'member' },
  });
  assert.equal(inviteUser.statusCode, 403, 'Privilege Escalation: Member cannot invite members');

  // Probe 2.4: Charlie (member) attempts to promote himself to 'admin' -> 403 Forbidden
  const promoteSelfAdmin = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: charlie,
    body: { role: 'admin' },
  });
  assert.equal(promoteSelfAdmin.statusCode, 403, 'Privilege Escalation: Member cannot promote self to admin');

  // Probe 2.5: Charlie (member) attempts to promote himself to 'owner' -> 403 Forbidden
  const promoteSelfOwner = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: charlie,
    body: { role: 'owner' },
  });
  assert.equal(promoteSelfOwner.statusCode, 403, 'Privilege Escalation: Member cannot promote self to owner');

  // Probe 2.6: Charlie (member) attempts to demote Alice (owner) -> 403 Forbidden
  const demoteOwner = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: charlie,
    body: { role: 'member' },
  });
  assert.equal(demoteOwner.statusCode, 403, 'Privilege Escalation: Member cannot demote owner');

  // Probe 2.7: Charlie (member) attempts to remove Alice (owner) -> 403 Forbidden
  const removeOwner = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: charlie,
  });
  assert.equal(removeOwner.statusCode, 403, 'Privilege Escalation: Member cannot remove owner');

  // Probe 2.8: Charlie (member) attempts to manage invitations -> 403 Forbidden
  const invRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: charlie,
    body: { email: 'guest@example.com' },
  });
  assert.equal(invRes.statusCode, 403, 'Privilege Escalation: Member cannot issue invitations');
});

test('ADVERSARIAL SUITE 3: Admin Escalation & Sole Owner Protection Invariants', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_sole');
  const bob = await registerProfile('bob_admin');
  const charlie = await registerProfile('charlie_target');

  const orgRes = await createOrg(alice, 'Hierarchy Org', 'Testing admin constraints');
  const orgId = orgRes.data.organization.org_id;

  // Alice adds Bob as Admin and Charlie as Member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_admin', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_target', role: 'member' },
  });

  // Probe 3.1: Bob (Admin) attempts to delete organization -> 403 Forbidden (Owner only)
  const deleteOrg = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(deleteOrg.statusCode, 403, 'Admin Escalation: Admin cannot delete organization');

  // Probe 3.2: Bob (Admin) attempts to promote Charlie to 'owner' -> 403 Forbidden
  const promoteToOwner = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: bob,
    body: { role: 'owner' },
  });
  assert.equal(promoteToOwner.statusCode, 403, 'Admin Escalation: Admin cannot grant owner role');

  // Probe 3.3: Bob (Admin) attempts to invite a new user directly as 'owner' -> 403 Forbidden
  await registerProfile('dave_owner_attempt');
  const inviteAsOwner = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: bob,
    body: { usernameOrEmail: 'dave_owner_attempt', role: 'owner' },
  });
  assert.equal(inviteAsOwner.statusCode, 403, 'Admin Escalation: Admin cannot invite as owner');

  // Probe 3.4: Bob (Admin) attempts to demote Alice (Owner) to 'member' or 'admin' -> 403 Forbidden
  const demoteOwner = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(demoteOwner.statusCode, 403, 'Admin Escalation: Admin cannot modify owner role');

  // Probe 3.5: Bob (Admin) attempts to remove Alice (Owner) -> 403 Forbidden
  const removeOwner = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: bob,
  });
  assert.equal(removeOwner.statusCode, 403, 'Admin Escalation: Admin cannot remove owner');

  // Probe 3.6: Sole Owner Demotion Protection (Alice attempts to demote herself when sole owner) -> 400 Bad Request
  const selfDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(selfDemote.statusCode, 400, 'Sole Owner: Cannot demote sole owner');
  assert.equal(selfDemote.data.error, 'SOLE_OWNER_PROTECTION');

  // Probe 3.7: Sole Owner Removal Protection (Alice attempts to remove herself when sole owner) -> 400 Bad Request
  const selfRemove = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
  });
  assert.equal(selfRemove.statusCode, 400, 'Sole Owner: Cannot remove sole owner');
  assert.equal(selfRemove.data.error, 'SOLE_OWNER_PROTECTION');

  // Probe 3.8: Multi-Owner Transfer Succession:
  // Alice promotes Bob to Owner -> Now 2 owners
  const promoteBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'owner' },
  });
  assert.equal(promoteBob.statusCode, 200, 'Owner can promote another member to owner');

  // Now that there are 2 owners, Alice can demote herself to admin
  const aliceStepDown = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceStepDown.statusCode, 200, 'Step down succeeds when multi-owner');

  // Now Bob is sole owner -> Bob cannot demote himself
  const bobSelfDemote = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
    body: { role: 'member' },
  });
  assert.equal(bobSelfDemote.statusCode, 400, 'Sole owner protection kicks back in');
});

test('ADVERSARIAL SUITE 4: Input Boundaries & Injection Robustness', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_inputs');
  const bob = await registerProfile('bob_inputs');

  // Probe 4.1: Empty string name -> 400
  const r1 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: '' },
  });
  assert.equal(r1.statusCode, 400, 'Empty name rejected with 400');

  // Probe 4.2: Whitespace-only name -> 400
  const r2 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: '   \n\t  ' },
  });
  assert.equal(r2.statusCode, 400, 'Whitespace name rejected with 400');

  // Probe 4.3: Name exceeding 255 ASCII characters -> 400
  const r3 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: 'X'.repeat(256) },
  });
  assert.equal(r3.statusCode, 400, 'Name > 255 characters rejected with 400');

  // Probe 4.4: Exact boundary name (255 chars) -> 201 Created
  const r4 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: 'X'.repeat(255) },
  });
  assert.equal(r4.statusCode, 201, 'Exact 255 chars accepted');
  const orgId = r4.data.organization.org_id;

  // Probe 4.5: Unicode boundary (Thai script & Emojis)
  // 256 Unicode characters -> rejected with 400
  const unicode256 = '🔐'.repeat(256);
  const r5 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: unicode256 },
  });
  assert.equal(r5.statusCode, 400, 'Unicode code points > 255 rejected');

  // 255 Unicode characters -> accepted with 201
  const unicode255 = '🔐'.repeat(255);
  const r6 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: unicode255 },
  });
  assert.equal(r6.statusCode, 201, 'Unicode 255 code points accepted');

  // Probe 4.6: SQL Injection string in Organization Name
  const sqliPayload = "Robert'); DROP TABLE organizations; --";
  const r7 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: sqliPayload },
  });
  assert.equal(r7.statusCode, 201, 'SQL injection string handled safely as literal text');
  assert.equal(r7.data.organization.name, sqliPayload);

  // Verify database table was NOT dropped
  const db = getDatabase();
  const checkTable = await db.query('SELECT COUNT(*) AS cnt FROM organizations');
  assert.ok(Number(checkTable.rows[0].cnt) >= 3, 'Organizations table intact after injection attempt');

  // Probe 4.7: XSS script tag payload in Name & Description
  const xssPayload = '<script>alert(document.cookie)</script>';
  const r8 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: 'XSS Test', description: xssPayload },
  });
  assert.equal(r8.statusCode, 201);
  assert.equal(r8.data.organization.description, xssPayload, 'Stored safely without crash');

  // Probe 4.8: Description > 2000 chars -> 400 Bad Request
  const r9 = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: { name: 'Long Desc', description: 'D'.repeat(2001) },
  });
  assert.equal(r9.statusCode, 400, 'Description > 2000 chars rejected with 400');

  // Probe 4.9: Invalid Role strings on update member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_inputs', role: 'member' },
  });

  for (const badRole of ['superadmin', 'root', '', 1234, null, true, 'OWNER_INJECTION']) {
    const rBadRole = await callRouter({
      method: 'PUT',
      path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
      claims: alice,
      body: { role: badRole },
    });
    assert.equal(rBadRole.statusCode, 400, `Invalid role "${badRole}" rejected with 400`);
  }

  // Probe 4.10: Malformed encrypted_org_key payload
  const badKeys = [
    'plain string',
    { ciphertext: '' },
    { ciphertext: 'X'.repeat(5000) },
    { notCiphertext: 'xyz' },
    [],
    123,
  ];
  for (const badKey of badKeys) {
    const rBadKey = await callRouter({
      method: 'POST',
      path: '/api/v1/organizations',
      claims: alice,
      body: { name: 'Bad Key Org', encryptedOrgKey: badKey },
    });
    assert.equal(rBadKey.statusCode, 400, 'Malformed encryptedOrgKey rejected with 400');
  }
});

test('ADVERSARIAL SUITE 5: Non-Existent Entities & Malformed Route Parameters', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_nonexist');
  const orgRes = await createOrg(alice, 'Valid Org');
  const orgId = orgRes.data.organization.org_id;
  const unknownOrgId = crypto.randomUUID();
  const unknownUserId = crypto.randomUUID();

  // Probe 5.1: Non-existent orgId -> 404 Not Found across all routes
  const routes404 = [
    { method: 'GET', path: `/api/v1/organizations/${unknownOrgId}` },
    { method: 'PUT', path: `/api/v1/organizations/${unknownOrgId}`, body: { name: 'New Name' } },
    { method: 'DELETE', path: `/api/v1/organizations/${unknownOrgId}` },
    { method: 'GET', path: `/api/v1/organizations/${unknownOrgId}/members` },
    { method: 'POST', path: `/api/v1/organizations/${unknownOrgId}/members`, body: { usernameOrEmail: 'alice_nonexist' } },
    { method: 'PUT', path: `/api/v1/organizations/${unknownOrgId}/members/${alice.sub}`, body: { role: 'member' } },
    { method: 'DELETE', path: `/api/v1/organizations/${unknownOrgId}/members/${alice.sub}` },
    { method: 'GET', path: `/api/v1/organizations/${unknownOrgId}/invitations` },
    { method: 'POST', path: `/api/v1/organizations/${unknownOrgId}/invitations`, body: { email: 'test@example.com' } },
  ];

  for (const r of routes404) {
    const res = await callRouter({
      method: r.method,
      path: r.path,
      claims: alice,
      body: r.body,
    });
    assert.equal(res.statusCode, 404, `${r.method} ${r.path} returns 404 Not Found`);
  }

  // Probe 5.2: Non-existent member userId in valid orgId -> 404 Not Found
  const updateUnknownMem = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${unknownUserId}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(updateUnknownMem.statusCode, 404, 'Unknown member update returns 404');

  const removeUnknownMem = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${unknownUserId}`,
    claims: alice,
  });
  assert.equal(removeUnknownMem.statusCode, 404, 'Unknown member delete returns 404');

  // Probe 5.3: Inviting non-existent username/email -> 404 Not Found
  const inviteUnknown = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'ghost_user_does_not_exist' },
  });
  assert.equal(inviteUnknown.statusCode, 404, 'Invite ghost user returns 404 Not Found');

  // Probe 5.4: Malformed non-UUID parameters -> 400 Bad Request
  const badParamRoutes = [
    { method: 'GET', path: '/api/v1/organizations/not-a-valid-uuid' },
    { method: 'PUT', path: '/api/v1/organizations/not-a-valid-uuid', body: { name: 'Name' } },
    { method: 'DELETE', path: '/api/v1/organizations/not-a-valid-uuid' },
    { method: 'GET', path: '/api/v1/organizations/not-a-valid-uuid/members' },
    { method: 'POST', path: '/api/v1/organizations/not-a-valid-uuid/members', body: { usernameOrEmail: 'alice_nonexist' } },
    { method: 'PUT', path: `/api/v1/organizations/${orgId}/members/invalid-user-uuid`, body: { role: 'admin' } },
    { method: 'DELETE', path: `/api/v1/organizations/${orgId}/members/invalid-user-uuid` },
  ];

  for (const r of badParamRoutes) {
    const res = await callRouter({
      method: r.method,
      path: r.path,
      claims: alice,
      body: r.body,
    });
    assert.equal(res.statusCode, 400, `Malformed UUID on ${r.method} ${r.path} returns 400`);
    assert.equal(res.data.error, 'INVALID_ID');
  }
});

test('ADVERSARIAL SUITE 6: Voluntary Self-Leave, Cascade Cleanup & Access Revocation', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_leave_owner');
  const bob = await registerProfile('bob_leave_member');

  const orgRes = await createOrg(alice, 'Leaving Org');
  const orgId = orgRes.data.organization.org_id;

  // Alice adds Bob as Member
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_leave_member', role: 'member' },
  });

  // Bob can view org before leaving
  const bobCheckBefore = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(bobCheckBefore.statusCode, 200, 'Bob can view org while active member');

  // Bob leaves voluntarily: DELETE /api/v1/organizations/:orgId/members/:bobUserId
  const leaveRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
  });
  assert.equal(leaveRes.statusCode, 200, 'Voluntary leave returns 200 OK');
  assert.equal(leaveRes.data.removed, true);

  // Bob immediately loses access: GET -> 403 Forbidden
  const bobCheckAfter = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(bobCheckAfter.statusCode, 403, 'Immediate access cutoff after leave');

  // Bob cannot re-leave or remove anyone else -> 403 Forbidden
  const bobReLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
  });
  assert.equal(bobReLeave.statusCode, 403, 'Former member cannot execute member operations');
});


test('ADVERSARIAL SUITE 7: Suspended/Invited Status Lockout & Unconfirmed Access Probes', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_status_owner');
  const bob = await registerProfile('bob_status_target');
  const orgRes = await createOrg(alice, 'Status Check Org');
  const orgId = orgRes.data.organization.org_id;

  const db = getDatabase();

  // Insert Bob as 'invited' (not yet confirmed)
  const invitedMemberId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, created_at, updated_at)
     VALUES ($1, $2, $3, 'admin', 'invited', $4, $5)`,
    [invitedMemberId, orgId, bob.sub, now, now]
  );

  // Probe 7.1: Bob with status 'invited' cannot access organization -> 403 Forbidden
  const invitedAccess = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(invitedAccess.statusCode, 403, 'Invited member cannot access org resources');

  // Update Bob to 'suspended'
  await db.query("UPDATE organization_members SET status = 'suspended' WHERE org_member_id = $1", [invitedMemberId]);

  // Probe 7.2: Bob with status 'suspended' cannot access organization -> 403 Forbidden
  const suspendedAccess = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(suspendedAccess.statusCode, 403, 'Suspended member cannot access org resources');
});

test('ADVERSARIAL SUITE 8: Malformed Request Envelopes & Body Corruption', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_corrupt');

  // Probe 8.1: Malformed JSON body string
  const corruptRes = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims: alice,
    body: '{"name": "Broken JSON',
  });
  assert.equal(corruptRes.statusCode, 400, 'Corrupt JSON returns 400 Bad Request');

  // Probe 8.2: Empty PUT body (no name, no description)
  const orgRes = await createOrg(alice, 'Valid Org');
  const orgId = orgRes.data.organization.org_id;

  const emptyPut = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
    body: {},
  });
  assert.equal(emptyPut.statusCode, 400, 'Empty update payload returns 400 Bad Request');
});
