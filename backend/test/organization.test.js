/**
 * Secure Vault Cloud — Organizations & Membership Unit & Regression Tests (Milestone M3)
 *
 * Exercises:
 * 1. Organization CRUD (create, list, get, update, delete)
 * 2. Member Management (invite/add, list, update role, remove/leave)
 * 3. Multi-tier RBAC & IDOR defenses (Owner, Admin, Member, Cross-tenant isolation)
 * 4. Sole Owner Protection invariants (demotion & removal defenses)
 * 5. Input validation & error boundaries (whitespace, >255 chars, invalid roles, invalid UUIDs, duplicates)
 * 6. Cryptographic wrapped key payload handling (encrypted_org_key)
 * 7. Cascade cleanup upon organization and member removal
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

async function createOrg(claims, name = 'Acme Corp', description = 'Acme enterprise org', encryptedOrgKey = null) {
  const body = { name, description };
  if (encryptedOrgKey) {
    body.encryptedOrgKey = encryptedOrgKey;
  }
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body,
  });
  return res;
}

test('M3.1: Organization Creation: validates name boundaries, stores encrypted_org_key and assigns owner', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_1');

  // 1. Success with valid payload and encrypted_org_key
  const res = await createOrg(alice, 'Engineering', 'Core engineering team', VALID_WRAPPED_KEY);
  assert.equal(res.statusCode, 201, JSON.stringify(res.data));
  const org = res.data?.organization;
  assert.ok(org?.org_id, 'org_id UUID present');
  assert.equal(org.name, 'Engineering');
  assert.equal(org.role, 'owner');
  assert.equal(org.member_count, 1);
  assert.equal(org.status, 'active');
  assert.ok(org.encrypted_org_key || org.encryptedOrgKey, 'encrypted_org_key stored');

  // 2. Reject empty name
  const emptyRes = await createOrg(alice, '', 'Empty test');
  assert.equal(emptyRes.statusCode, 400);

  // 3. Reject whitespace-only name
  const wsRes = await createOrg(alice, '   \t  ', 'Whitespace test');
  assert.equal(wsRes.statusCode, 400);

  // 4. Reject name exceeding 255 chars
  const longRes = await createOrg(alice, 'A'.repeat(256), 'Too long');
  assert.equal(longRes.statusCode, 400);

  // 5. Reject invalid encrypted_org_key payload
  const badKeyRes = await createOrg(alice, 'Bad Key Org', 'Bad key', { ciphertext: '' });
  assert.equal(badKeyRes.statusCode, 400);
});

test('M3.2: Organization Listing & Retrieval: lists caller memberships and returns single org details', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_2');
  const bob = await registerProfile('bob_m3_2');

  const orgRes = await createOrg(alice, 'Alice Org', 'Alice primary org');
  const orgId = orgRes.data.organization.org_id;

  // Alice lists orgs -> finds Alice Org with role owner
  const aliceList = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations',
    claims: alice,
  });
  assert.equal(aliceList.statusCode, 200);
  const orgs = aliceList.data.organizations;
  assert.equal(orgs.length, 1);
  assert.equal(orgs[0].org_id, orgId);
  assert.equal(orgs[0].role, 'owner');
  assert.equal(orgs[0].member_count, 1);

  // Bob lists orgs -> receives empty array (not yet a member)
  const bobList = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations',
    claims: bob,
  });
  assert.equal(bobList.statusCode, 200);
  assert.equal(bobList.data.organizations.length, 0);

  // Alice gets single org details -> 200 OK
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.data.organization.org_id, orgId);
  assert.equal(getRes.data.organization.role, 'owner');

  // Bob attempts IDOR to get Alice Org details -> 403 Forbidden
  const idorRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(idorRes.statusCode, 403);

  // Non-existent org ID -> 404 Not Found
  const notFoundRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${crypto.randomUUID()}`,
    claims: alice,
  });
  assert.equal(notFoundRes.statusCode, 404);

  // Invalid UUID -> 400 Bad Request
  const badIdRes = await callRouter({
    method: 'GET',
    path: '/api/v1/organizations/not-a-uuid',
    claims: alice,
  });
  assert.equal(badIdRes.statusCode, 400);
});

test('M3.3: Organization Update: restricts updates to Owner/Admin and enforces input limits', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_3');
  const bob = await registerProfile('bob_m3_3');

  const orgRes = await createOrg(alice, 'Initial Org Name', 'Initial description');
  const orgId = orgRes.data.organization.org_id;

  // Add Bob as standard member
  const addRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_3', role: 'member' },
  });
  assert.equal(addRes.statusCode, 201);

  // Bob (standard member) attempts update -> 403 Forbidden
  const bobUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
    body: { name: 'Bob Unauthorized Name' },
  });
  assert.equal(bobUpdate.statusCode, 403);

  // Alice (Owner) updates name and description -> 200 OK
  const aliceUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
    body: { name: 'Updated Org Name', description: 'Updated org description' },
  });
  assert.equal(aliceUpdate.statusCode, 200);
  assert.equal(aliceUpdate.data.organization.name, 'Updated Org Name');
  assert.equal(aliceUpdate.data.organization.description, 'Updated org description');

  // Reject empty name update
  const emptyUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
    body: { name: '' },
  });
  assert.equal(emptyUpdate.statusCode, 400);
});

test('M3.4: Organization Deletion: restricts deletion to Owner and cascades cleanup', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_4');
  const bob = await registerProfile('bob_m3_4');

  const orgRes = await createOrg(alice, 'Delete Candidate Org');
  const orgId = orgRes.data.organization.org_id;

  // Add Bob as Admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_4', role: 'admin' },
  });

  // Bob (Admin) attempts delete -> 403 Forbidden (Owner only)
  const bobDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: bob,
  });
  assert.equal(bobDelete.statusCode, 403);

  // Alice (Owner) deletes organization -> 200 OK
  const aliceDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
  });
  assert.equal(aliceDelete.statusCode, 200);
  assert.equal(aliceDelete.data.deleted, true);

  // Subsequent get returns 404
  const getCheck = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}`,
    claims: alice,
  });
  assert.equal(getCheck.statusCode, 404);

  // Memberships cascaded cleanly in database
  const db = getDatabase();
  const memCheck = await db.query('SELECT * FROM organization_members WHERE org_id = $1', [orgId]);
  assert.equal(memCheck.rows.length, 0);
});

test('M3.5: Member Management: add, list, role update, privilege escalation protection', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_5');
  const bob = await registerProfile('bob_m3_5');
  const charlie = await registerProfile('charlie_m3_5');
  const eve = await registerProfile('eve_m3_5');

  const orgRes = await createOrg(alice, 'Member Test Org');
  const orgId = orgRes.data.organization.org_id;

  // 1. Add Bob as admin using email lookup
  const addBob = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_5@securevault.io', role: 'admin', encryptedOrgKey: VALID_WRAPPED_KEY },
  });
  assert.equal(addBob.statusCode, 201);
  assert.equal(addBob.data.member.role, 'admin');
  assert.equal(addBob.data.member.user_id, bob.sub);

  // 2. Add Charlie as member using username
  const addCharlie = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'CHARLIE_M3_5', role: 'member' },
  });
  assert.equal(addCharlie.statusCode, 201);
  assert.equal(addCharlie.data.member.role, 'member');

  // 3. Duplicate member add rejected with 409 Conflict
  const dupRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_m3_5', role: 'member' },
  });
  assert.equal(dupRes.statusCode, 409);

  // 4. Non-existent user returns 404 Not Found
  const notFoundUser = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'ghost_user_does_not_exist@example.com' },
  });
  assert.equal(notFoundUser.statusCode, 404);

  // 5. Standard member (Charlie) cannot invite others -> 403 Forbidden
  const unauthInvite = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: charlie,
    body: { usernameOrEmail: 'eve_m3_5', role: 'member' },
  });
  assert.equal(unauthInvite.statusCode, 403);

  // 6. Privilege escalation: Admin (Bob) cannot add anyone as 'owner' -> 403 Forbidden
  const adminOwnerGrant = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: bob,
    body: { usernameOrEmail: 'eve_m3_5', role: 'owner' },
  });
  assert.equal(adminOwnerGrant.statusCode, 403);

  // 7. List members -> returns Alice (owner), Bob (admin), Charlie (member) ordered by role
  const listRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: charlie,
  });
  assert.equal(listRes.statusCode, 200);
  const members = listRes.data.members;
  assert.equal(members.length, 3);
  assert.equal(members[0].role, 'owner');
  assert.equal(members[1].role, 'admin');
  assert.equal(members[2].role, 'member');

  // 8. Eve (non-member) cannot list members -> 403 Forbidden
  const idorMembers = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: eve,
  });
  assert.equal(idorMembers.statusCode, 403);
});

test('M3.6: Sole Owner Protection: prevents demoting or removing the last active owner', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_6');
  const bob = await registerProfile('bob_m3_6');

  const orgRes = await createOrg(alice, 'Sole Owner Org');
  const orgId = orgRes.data.organization.org_id;

  // Add Bob as admin
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_6', role: 'admin' },
  });

  // 1. Attempting to demote sole owner Alice -> 400 Bad Request
  const demoteSole = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(demoteSole.statusCode, 400);
  assert.ok(demoteSole.data.error.includes('SOLE_OWNER') || demoteSole.data.message.includes('sole owner'));

  // 2. Attempting to remove sole owner Alice -> 400 Bad Request
  const removeSole = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
  });
  assert.equal(removeSole.statusCode, 400);

  // 3. Multi-owner succession: Alice promotes Bob to owner
  const promoteBob = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
    body: { role: 'owner' },
  });
  assert.equal(promoteBob.statusCode, 200);
  assert.equal(promoteBob.data.member.role, 'owner');

  // 4. Now Alice can safely step down to admin (since Bob is also an owner)
  const aliceStepDown = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/members/${alice.sub}`,
    claims: alice,
    body: { role: 'admin' },
  });
  assert.equal(aliceStepDown.statusCode, 200);
  assert.equal(aliceStepDown.data.member.role, 'admin');

  // 5. Now Bob is the sole owner -> Bob cannot be removed
  const removeBobSole = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: bob,
  });
  assert.equal(removeBobSole.statusCode, 400);
});

test('M3.7: Member Removal & Voluntary Leave: non-owner members can remove self or be removed by admin', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_7');
  const bob = await registerProfile('bob_m3_7');
  const charlie = await registerProfile('charlie_m3_7');

  const orgRes = await createOrg(alice, 'Removal Org');
  const orgId = orgRes.data.organization.org_id;

  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_7', role: 'admin' },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'charlie_m3_7', role: 'member' },
  });

  // 1. Charlie voluntarily leaves organization -> 200 OK
  const charlieLeave = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${charlie.sub}`,
    claims: charlie,
  });
  assert.equal(charlieLeave.statusCode, 200);
  assert.equal(charlieLeave.data.removed, true);

  // Subsequent check: Charlie is no longer in member list
  const listAfterLeave = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
  });
  assert.equal(listAfterLeave.data.members.length, 2);
  assert.ok(!listAfterLeave.data.members.some((m) => m.user_id === charlie.sub));

  // Charlie now receives 403 on org resources
  const charlieBlocked = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: charlie,
  });
  assert.equal(charlieBlocked.statusCode, 403);

  // 2. Alice removes Bob (admin) -> 200 OK
  const removeBob = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/members/${bob.sub}`,
    claims: alice,
  });
  assert.equal(removeBob.statusCode, 200);
});

test('M3.8: Organization Invitations: create invitation for pending email and list invitations', async () => {
  await resetDatabase();
  const alice = await registerProfile('alice_m3_8');
  await registerProfile('bob_m3_8');

  const orgRes = await createOrg(alice, 'Invite Org');
  const orgId = orgRes.data.organization.org_id;

  // 1. Owner creates invitation for unregistered external email
  const inviteRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: alice,
    body: { email: 'external_contractor@partner.com', role: 'member' },
  });
  assert.equal(inviteRes.statusCode, 201);
  const inv = inviteRes.data.invitation;
  assert.equal(inv.email, 'external_contractor@partner.com');
  assert.equal(inv.status, 'pending');
  assert.ok(inv.token, 'Secure invitation token generated');

  // 2. List invitations -> returns pending invite
  const listInv = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: alice,
  });
  assert.equal(listInv.statusCode, 200);
  assert.equal(listInv.data.invitations.length, 1);
  assert.equal(listInv.data.invitations[0].email, 'external_contractor@partner.com');

  // 3. Adding Bob as member directly
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: alice,
    body: { usernameOrEmail: 'bob_m3_8', role: 'member' },
  });

  // 4. Inviting Bob via email when already member returns 409 Conflict
  const conflictInv = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/invitations`,
    claims: alice,
    body: { email: 'bob_m3_8@securevault.io', role: 'member' },
  });
  assert.equal(conflictInv.statusCode, 409);
});
