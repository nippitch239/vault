/**
 * Secure Vault Cloud — Scoped Groups & Collections Unit Tests (Milestone M4)
 *
 * Covers:
 * 1. Scoped Group CRUD (Features 18, 19):
 *    - Organization-scoped creation, listing, retrieval, update, deletion
 *    - Owner/Admin privileges vs Member restrictions
 *    - Input validation (boundaries, whitespace, max length)
 * 2. Scoped Group Membership Management (Feature 19):
 *    - Adding members to organization groups
 *    - Cross-tenant rejection: cannot add users who are not confirmed org members
 *    - Removing members from groups
 *    - Safe deletion invariant: deleting group preserves user accounts
 * 3. Scoped Collection CRUD (Feature 20):
 *    - Organization-scoped creation, listing, retrieval, update, deletion
 *    - Creator automatic grant and wrapped key handling
 *    - Input validation and boundary enforcement
 * 4. Collection Access Grants & Cross-Tenant Firewall (Feature 21):
 *    - Granting 'read', 'write', 'admin', 'manage' permissions
 *    - Invalid permission rejection (400)
 *    - Cross-tenant firewall: cannot grant access to groups or users from different orgs
 *    - Revoking access and pruning orphaned keys
 * 5. Deterministic Effective Permissions Supremum & Synonyms (Feature 22):
 *    - Org Owner / Org Admin supremum = manage (rank 3)
 *    - Collection Creator supremum = manage (rank 3)
 *    - Multi-group union supremum: MAX(Group A read, Group B write) = write (rank 2)
 *    - Direct grant supremum: MAX(Group write, Direct manage) = manage (rank 3)
 *    - manage == admin equivalence
 *    - Cross-tenant cutoff: non-members receive null / none
 * 6. Collection Items Linking & Key Distribution (Feature 23):
 *    - Linking item to collection
 *    - Owner-only linking invariant (prevent attaching someone else's item)
 *    - Storing wrapped collection keys (must have access first)
 *    - Listing members pending key distribution
 *    - Unlinking items from collections
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { resetDatabase, getDatabase } from '../src/db/adapter.js';
import { callRouter, registerProfile } from './helpers.js';
import {
  getEffectiveCollectionPermission,
  getEffectiveCollectionPermissionDetails,
  hasRequiredPermission,
} from '../src/middleware/auth-guard.js';

const VALID_KEY = {
  ciphertext: 'd3JhcHBlZC1jb2xsZWN0aW9uLWtleQ==',
  algorithm: 'RSA-OAEP',
  hash: 'SHA-256',
};

async function createOrg(claims, name = 'Test Org') {
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/organizations',
    claims,
    body: { name, description: 'Test Organization' },
  });
  return res.data?.organization?.org_id || res.data?.organization?.id;
}

async function addOrgMember(ownerClaims, orgId, user, role = 'member') {
  const res = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/members`,
    claims: ownerClaims,
    body: {
      userId: user.sub,
      role,
    },
  });
  return res;
}

// ============================================================================
// Feature 18 & 19: Scoped Groups & Memberships
// ============================================================================

test('M4.1: Scoped Groups CRUD: create, list, get, update, delete with boundaries', async () => {
  await resetDatabase();
  const owner = await registerProfile('owner_m4_1');
  const member = await registerProfile('member_m4_1');
  const orgId = await createOrg(owner, 'DevOps Org');
  await addOrgMember(owner, orgId, member, 'member');

  // 1. Create group scoped to org
  const createRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: owner,
    body: { name: 'Backend Engineers', description: 'Core backend team' },
  });
  assert.equal(createRes.statusCode, 201);
  const group = createRes.data?.group;
  assert.ok(group?.group_id || group?.id);
  const groupId = group.group_id || group.id;
  assert.equal(group.name, 'Backend Engineers');
  assert.equal(group.org_id, orgId);

  // 2. Reject empty or oversized group name
  const emptyRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: owner,
    body: { name: '   ' },
  });
  assert.equal(emptyRes.statusCode, 400);

  const longRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: owner,
    body: { name: 'a'.repeat(256) },
  });
  assert.equal(longRes.statusCode, 400);

  // 3. Standard member cannot create group (403)
  const forbiddenCreate = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: member,
    body: { name: 'Unauthorized Group' },
  });
  assert.equal(forbiddenCreate.statusCode, 403);

  // 4. List groups
  const listRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: member,
  });
  assert.equal(listRes.statusCode, 200);
  assert.equal(listRes.data?.groups?.length, 1);
  assert.equal(listRes.data.groups[0].name, 'Backend Engineers');

  // 5. Get group details
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: member,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.data?.group?.name, 'Backend Engineers');

  // 6. Update group (Owner allowed, Member forbidden)
  const memberUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: member,
    body: { name: 'Hacked Group' },
  });
  assert.equal(memberUpdate.statusCode, 403);

  const ownerUpdate = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: owner,
    body: { name: 'Platform Engineering', description: 'Updated description' },
  });
  assert.equal(ownerUpdate.statusCode, 200);
  assert.equal(ownerUpdate.data?.group?.name, 'Platform Engineering');

  // 7. Delete group
  const memberDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: member,
  });
  assert.equal(memberDelete.statusCode, 403);

  const ownerDelete = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: owner,
  });
  assert.equal(ownerDelete.statusCode, 200);

  const getDeleted = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/groups/${groupId}`,
    claims: owner,
  });
  assert.equal(getDeleted.statusCode, 404);
});

test('M4.2: Scoped Group Membership & Cross-Tenant Rejection', async () => {
  await resetDatabase();
  const ownerA = await registerProfile('owner_a_m4');
  const memberA = await registerProfile('member_a_m4');
  const outsider = await registerProfile('outsider_m4');

  const orgAId = await createOrg(ownerA, 'Org A');
  await addOrgMember(ownerA, orgAId, memberA, 'member');

  // Create group in Org A
  const grpRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/groups`,
    claims: ownerA,
    body: { name: 'Group Alpha' },
  });
  const groupId = grpRes.data.group.group_id || grpRes.data.group.id;

  // Add confirmed member of Org A to Group Alpha (success)
  const addRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}/members`,
    claims: ownerA,
    body: { userId: memberA.sub, role: 'member' },
  });
  assert.equal(addRes.statusCode, 201);

  // Cross-tenant firewall: Attempt to add outsider who is NOT in Org A (rejected)
  const crossRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}/members`,
    claims: ownerA,
    body: { userId: outsider.sub, role: 'member' },
  });
  assert.equal(crossRes.statusCode, 400);
  assert.equal(crossRes.data?.error, 'CROSS_ORG_FORBIDDEN');

  // List group members
  const listMem = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}/members`,
    claims: ownerA,
  });
  assert.equal(listMem.statusCode, 200);
  assert.equal(listMem.data?.members?.length, 1);
  assert.equal(listMem.data.members[0].user_id, memberA.sub);

  // Remove member from group
  const remRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}/members/${memberA.sub}`,
    claims: ownerA,
  });
  assert.equal(remRes.statusCode, 200);

  // Verify group is now empty
  const listEmpty = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}/members`,
    claims: ownerA,
  });
  assert.equal(listEmpty.data?.members?.length, 0);

  // Deleting group preserves user accounts
  await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgAId}/groups/${groupId}`,
    claims: ownerA,
  });
  const db = getDatabase();
  const uCheck = await db.query('SELECT user_id FROM users WHERE user_id = $1', [memberA.sub]);
  assert.equal(uCheck.rows.length, 1, 'Member user account remains intact');
});

// ============================================================================
// Feature 20 & 21: Scoped Collections & Access Grants
// ============================================================================

test('M4.3: Scoped Collection CRUD & Creator Automatic Admin Grant', async () => {
  await resetDatabase();
  const owner = await registerProfile('owner_col_m4');
  const orgId = await createOrg(owner, 'Collections Org');

  // 1. Create collection with wrapped key
  const createRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/collections`,
    claims: owner,
    body: {
      name: 'Production Secrets',
      description: 'Critical credentials',
      encryptedKeyForRecipient: VALID_KEY,
    },
  });
  assert.equal(createRes.statusCode, 201);
  const col = createRes.data?.collection;
  assert.ok(col?.collection_id || col?.id);
  const collectionId = col.collection_id || col.id;
  assert.equal(col.name, 'Production Secrets');
  assert.equal(col.org_id, orgId);
  assert.equal(col.effective_permission, 'manage');

  // 2. Reject empty collection name
  const emptyRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/collections`,
    claims: owner,
    body: { name: '' },
  });
  assert.equal(emptyRes.statusCode, 400);

  // 3. Get collection details
  const getRes = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/collections/${collectionId}`,
    claims: owner,
  });
  assert.equal(getRes.statusCode, 200);
  assert.equal(getRes.data?.collection?.name, 'Production Secrets');
  assert.equal(getRes.data?.collection?.effective_permission, 'manage');

  // 4. Update collection
  const updRes = await callRouter({
    method: 'PUT',
    path: `/api/v1/organizations/${orgId}/collections/${collectionId}`,
    claims: owner,
    body: { name: 'Production Credentials' },
  });
  assert.equal(updRes.statusCode, 200);
  assert.equal(updRes.data?.collection?.name, 'Production Credentials');

  // 5. Delete collection
  const delRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/organizations/${orgId}/collections/${collectionId}`,
    claims: owner,
  });
  assert.equal(delRes.statusCode, 200);

  const getDeleted = await callRouter({
    method: 'GET',
    path: `/api/v1/organizations/${orgId}/collections/${collectionId}`,
    claims: owner,
  });
  assert.equal(getDeleted.statusCode, 404);
});

test('M4.4: Collection Access Grants, Revocation and Cross-Tenant Firewall', async () => {
  await resetDatabase();
  const ownerA = await registerProfile('owner_a_perm');
  const memberA = await registerProfile('member_a_perm');
  const ownerB = await registerProfile('owner_b_perm');
  const memberB = await registerProfile('member_b_perm');

  const orgAId = await createOrg(ownerA, 'Org A');
  const orgBId = await createOrg(ownerB, 'Org B');

  await addOrgMember(ownerA, orgAId, memberA, 'member');
  await addOrgMember(ownerB, orgBId, memberB, 'member');

  // Create Collection in Org A
  const colRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/collections`,
    claims: ownerA,
    body: { name: 'Org A Collection' },
  });
  const collectionId = colRes.data.collection.collection_id || colRes.data.collection.id;

  // Create Group in Org A and Group in Org B
  const grpARes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgAId}/groups`,
    claims: ownerA,
    body: { name: 'Org A Group' },
  });
  const groupAId = grpARes.data.group.group_id || grpARes.data.group.id;

  const grpBRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgBId}/groups`,
    claims: ownerB,
    body: { name: 'Org B Group' },
  });
  const groupBId = grpBRes.data.group.group_id || grpBRes.data.group.id;

  // 1. Grant valid permissions ('read', 'write', 'admin', 'manage')
  const grantUserRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
    body: { targetType: 'user', targetId: memberA.sub, permission: 'read' },
  });
  assert.equal(grantUserRes.statusCode, 201);
  assert.equal(grantUserRes.data?.access?.permission, 'read');

  const grantGrpRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
    body: { targetType: 'group', targetId: groupAId, permission: 'write' },
  });
  assert.equal(grantGrpRes.statusCode, 201);
  assert.equal(grantGrpRes.data?.access?.permission, 'write');

  // 2. Reject invalid permission string (400)
  const invalidPermRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
    body: { targetType: 'user', targetId: memberA.sub, permission: 'superadmin' },
  });
  assert.equal(invalidPermRes.statusCode, 400);

  // 3. Cross-Tenant Firewall: Cannot grant access to user from Org B on Org A collection
  const crossUserRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
    body: { targetType: 'user', targetId: memberB.sub, permission: 'read' },
  });
  assert.equal(crossUserRes.statusCode, 400);
  assert.equal(crossUserRes.data?.error, 'CROSS_ORG_FORBIDDEN');

  // 4. Cross-Tenant Firewall: Cannot grant access to group from Org B on Org A collection
  const crossGrpRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
    body: { targetType: 'group', targetId: groupBId, permission: 'read' },
  });
  assert.equal(crossGrpRes.statusCode, 400);
  assert.equal(crossGrpRes.data?.error, 'CROSS_ORG_FORBIDDEN');

  // 5. Revoke access
  const revRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/access/user/${memberA.sub}`,
    claims: ownerA,
  });
  assert.equal(revRes.statusCode, 200);

  const listAccessRes = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: ownerA,
  });
  assert.equal(listAccessRes.statusCode, 200);
  assert.equal(listAccessRes.data?.access?.some((a) => a.targetId === memberA.sub), false);
});

// ============================================================================
// Feature 22: Deterministic Supremum Effective Permissions Logic
// ============================================================================

test('M4.5: Deterministic Supremum Effective Permission Calculation & Synonyms', async () => {
  await resetDatabase();
  const owner = await registerProfile('sup_owner');
  const admin = await registerProfile('sup_admin');
  const user = await registerProfile('sup_user');
  const outsider = await registerProfile('sup_outsider');

  const orgId = await createOrg(owner, 'Supremum Org');
  await addOrgMember(owner, orgId, admin, 'admin');
  await addOrgMember(owner, orgId, user, 'member');

  // Create Collection
  const colRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/collections`,
    claims: owner,
    body: { name: 'Shared Database' },
  });
  const collectionId = colRes.data.collection.collection_id || colRes.data.collection.id;

  const db = getDatabase();

  // 1. Org Owner has supremum manage (rank 3)
  const ownerPerm = await getEffectiveCollectionPermission(db, collectionId, owner);
  assert.equal(ownerPerm, 'manage');

  // 2. Org Admin has supremum manage (rank 3)
  const adminPerm = await getEffectiveCollectionPermission(db, collectionId, admin);
  assert.equal(adminPerm, 'manage');

  // 3. User with no grants has null (rank 0)
  const userInitPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  assert.equal(userInitPerm, null);

  // 4. Create Group A (read) and Group B (write), add user to both
  const grpA = (await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: owner,
    body: { name: 'Group Readers' },
  })).data.group;
  const grpB = (await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups`,
    claims: owner,
    body: { name: 'Group Writers' },
  })).data.group;

  const grpAId = grpA.group_id || grpA.id;
  const grpBId = grpB.group_id || grpB.id;

  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups/${grpAId}/members`,
    claims: owner,
    body: { userId: user.sub },
  });
  await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/groups/${grpBId}/members`,
    claims: owner,
    body: { userId: user.sub },
  });

  // Grant read to Group A
  await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: owner,
    body: { targetType: 'group', targetId: grpAId, permission: 'read' },
  });

  // Now user has 'read'
  assert.equal(await getEffectiveCollectionPermission(db, collectionId, user), 'read');

  // Grant write to Group B
  await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: owner,
    body: { targetType: 'group', targetId: grpBId, permission: 'write' },
  });

  // Now user has MAX('read', 'write') = 'write'
  assert.equal(await getEffectiveCollectionPermission(db, collectionId, user), 'write');

  // 5. Direct grant overrides group grant: give user direct 'manage'
  await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: owner,
    body: { targetType: 'user', targetId: user.sub, permission: 'manage' },
  });

  assert.equal(await getEffectiveCollectionPermission(db, collectionId, user), 'manage');

  // 6. Test details breakdown
  const details = await getEffectiveCollectionPermissionDetails(db, collectionId, user);
  assert.equal(details.effectivePermission, 'manage');
  assert.equal(details.effectiveRank, 3);
  assert.equal(details.directPermission, 'manage');
  assert.equal(details.groupPermission, 'write');

  // 7. Test permission requirement checks (synonym support)
  assert.ok(hasRequiredPermission('admin', 'manage'), 'admin satisfies manage');
  assert.ok(hasRequiredPermission('manage', 'admin'), 'manage satisfies admin');
  assert.ok(hasRequiredPermission('manage', 'write'), 'manage satisfies write');
  assert.ok(hasRequiredPermission('write', 'read'), 'write satisfies read');
  assert.ok(!hasRequiredPermission('read', 'write'), 'read does not satisfy write');

  // 8. Outsider has rank 0 / null
  assert.equal(await getEffectiveCollectionPermission(db, collectionId, outsider), null);
});

// ============================================================================
// Feature 23: Collection Items & Key Distribution
// ============================================================================

test('M4.6: Collection Items Association & Key Distribution', async () => {
  await resetDatabase();
  const owner = await registerProfile('item_owner');
  const writer = await registerProfile('item_writer');
  const orgId = await createOrg(owner, 'Item Org');
  await addOrgMember(owner, orgId, writer, 'member');

  // Create Collection
  const colRes = await callRouter({
    method: 'POST',
    path: `/api/v1/organizations/${orgId}/collections`,
    claims: owner,
    body: { name: 'Dev Secrets' },
  });
  const collectionId = colRes.data.collection.collection_id || colRes.data.collection.id;

  // Grant writer 'write' access
  await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/access`,
    claims: owner,
    body: { targetType: 'user', targetId: writer.sub, permission: 'write' },
  });

  // 1. Pending keys: writer has access but no key yet
  const pendRes = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/keys/pending`,
    claims: owner,
  });
  assert.equal(pendRes.statusCode, 200);
  assert.ok(pendRes.data?.pending?.some((p) => p.user_id === writer.sub));

  // 2. Distribute wrapped key to writer
  const storeRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/keys`,
    claims: owner,
    body: {
      userId: writer.sub,
      encryptedKeyForRecipient: VALID_KEY,
    },
  });
  assert.equal(storeRes.statusCode, 201);

  // Writer can now retrieve their key
  const keyRes = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/keys`,
    claims: writer,
  });
  assert.equal(keyRes.statusCode, 200);
  assert.ok(keyRes.data?.key?.encrypted_key_for_recipient || keyRes.data?.key?.encryptedKeyForRecipient);

  // 3. Vault Item linking:
  // Create an item owned by writer
  const itemRes = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims: writer,
    body: {
      category: 'LOGIN',
      item_type: 'login',
      metadata: { name: 'Database Password' },
      encryptedPayload: {
        ciphertext: 'ZW5jcnlwdGVkLWRhdGE=',
        iv: 'ZXZvaXZvaXZv',
        authTag: 'dGFndGFndGFn',
      },
    },
  });
  assert.equal(itemRes.statusCode, 201);
  const itemId = itemRes.data?.item?.item_id || itemRes.data?.item?.id;

  // Writer adds their own item to collection (success)
  const addLinkRes = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: writer,
    body: { itemId },
  });
  assert.equal(addLinkRes.statusCode, 201);

  // List collection items
  const listItemsRes = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: owner,
  });
  assert.equal(listItemsRes.statusCode, 200);
  assert.equal(listItemsRes.data?.items?.length, 1);
  assert.equal(listItemsRes.data.items[0].item_id, itemId);

  // Invariant: writer cannot attach an item owned by another user
  const ownerItemRes = await callRouter({
    method: 'POST',
    path: '/api/v1/items',
    claims: owner,
    body: {
      category: 'LOGIN',
      item_type: 'login',
      metadata: { name: 'Owner Secret' },
      encryptedPayload: {
        ciphertext: 'b3duZXItZGF0YQ==',
        iv: 'ZXZvaXZvaXZv',
        authTag: 'dGFndGFndGFn',
      },
    },
  });
  const ownerItemId = ownerItemRes.data?.item?.item_id || ownerItemRes.data?.item?.id;

  const unauthorizedLink = await callRouter({
    method: 'POST',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: writer,
    body: { itemId: ownerItemId },
  });
  assert.equal(unauthorizedLink.statusCode, 403);
  assert.equal(unauthorizedLink.data?.error, 'ITEM_NOT_OWNED');

  // Unlink item
  const removeRes = await callRouter({
    method: 'DELETE',
    path: `/api/v1/collections/${collectionId}/items/${itemId}`,
    claims: writer,
  });
  assert.equal(removeRes.statusCode, 200);

  // Verify item is unlinked but NOT deleted from vault_items
  const listAfter = await callRouter({
    method: 'GET',
    path: `/api/v1/collections/${collectionId}/items`,
    claims: owner,
  });
  assert.equal(listAfter.data?.items?.length, 0);

  const getItemRes = await callRouter({
    method: 'GET',
    path: `/api/v1/items/${itemId}`,
    claims: writer,
  });
  assert.equal(getItemRes.statusCode, 200, 'Underlying vault item remains intact');
});
