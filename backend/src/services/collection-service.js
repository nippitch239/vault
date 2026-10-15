/**
 * Collections — business rules (permissions, key distribution, item ownership).
 * No HTTP here: inputs are already validated by the handler, failures are ServiceErrors.
 */

import { getEffectiveCollectionPermission, hasRequiredPermission } from '../middleware/auth-guard.js';
import * as repo from '../db/collection-repo.js';
import { notFound, forbidden, badRequest, conflict } from './errors.js';

/**
 * Loads the collection and checks the caller's effective permission.
 * 404 when the collection does not exist, 403 when the permission is too low.
 */
export async function requirePermission(db, collectionId, user, minimum, action = 'access this collection') {
  const collection = await repo.findCollection(db, collectionId);
  if (!collection) throw notFound('Collection not found');
  const permission = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(permission, minimum)) {
    throw forbidden(`Forbidden: ${minimum} permission required to ${action}`);
  }
  return { collection, permission };
}

/**
 * Removes wrapped keys of users who no longer have any access to the collection.
 */
export async function pruneOrphanedKeys(db, collectionId) {
  let removed = 0;
  for (const userId of await repo.listKeyHolders(db, collectionId)) {
    if (!(await getEffectiveCollectionPermission(db, collectionId, userId))) {
      await repo.deleteKey(db, collectionId, userId);
      removed += 1;
    }
  }
  return removed;
}

export async function createCollection(db, user, { name, description, wrappedKey }) {
  const collection = await repo.insertCollection(db, { name, description, createdBy: user.user_id });
  await repo.upsertAccess(db, { collectionId: collection.collection_id, targetType: 'user', targetId: user.user_id, permission: 'admin' });
  if (wrappedKey) {
    await repo.upsertKey(db, { collectionId: collection.collection_id, userId: user.user_id, wrappedKey });
  }
  await repo
    .insertAuditLog(db, { actorUserId: user.user_id, actorRole: user.role, action: 'COLLECTION_CREATED', collectionId: collection.collection_id, details: { name } })
    .catch(() => {});
  return collection;
}

export async function listCollections(db, user) {
  if (user.role === 'admin') {
    // System administrators see every collection with admin rights.
    return (await repo.listAllCollections(db)).map((collection) => ({ collection, permission: 'admin' }));
  }
  return (await repo.listAccessibleCollections(db, user.user_id)).map(({ row, permission }) => ({ collection: row, permission }));
}

export async function getCollection(db, user, collectionId) {
  return requirePermission(db, collectionId, user, 'read', 'view collection');
}

export async function updateCollection(db, user, collectionId, changes) {
  const { collection } = await requirePermission(db, collectionId, user, 'admin', 'update collection');
  return repo.updateCollection(db, collectionId, {
    name: changes.name ?? collection.name,
    description: changes.description === undefined ? collection.description : changes.description,
  });
}

export async function deleteCollection(db, user, collectionId) {
  await requirePermission(db, collectionId, user, 'admin', 'delete collection');
  await repo.deleteCollection(db, collectionId);
}

export async function listAccess(db, user, collectionId) {
  await requirePermission(db, collectionId, user, 'admin', 'list access entries');
  return repo.listAccess(db, collectionId);
}

export async function grantAccess(db, user, collectionId, { targetType, targetId, permission }) {
  await requirePermission(db, collectionId, user, 'admin', 'manage access');
  const exists = targetType === 'user' ? await repo.userExists(db, targetId) : await repo.groupExists(db, targetId);
  if (!exists) throw notFound(targetType === 'user' ? 'Target user not found' : 'Target group not found');
  await repo.upsertAccess(db, { collectionId, targetType, targetId, permission });
}

export async function revokeAccess(db, user, collectionId, { targetType, targetId }) {
  await requirePermission(db, collectionId, user, 'admin', 'revoke access');
  if (!(await repo.findAccess(db, collectionId, targetType, targetId))) throw notFound('Access entry not found');
  await repo.deleteAccess(db, collectionId, targetType, targetId);
  return pruneOrphanedKeys(db, collectionId);
}

/**
 * Distributing (or replacing) a wrapped key is an admin action — otherwise any member
 * could overwrite another member's key with one they control — and only for members.
 */
export async function storeKey(db, user, collectionId, { userId, wrappedKey }) {
  await requirePermission(db, collectionId, user, 'admin', 'distribute collection keys');
  if (!(await repo.userExists(db, userId))) throw notFound('Target user not found');
  if (!(await getEffectiveCollectionPermission(db, collectionId, userId))) {
    throw badRequest('Grant the user access to the collection before storing their key', 'TARGET_HAS_NO_ACCESS');
  }
  await repo.upsertKey(db, { collectionId, userId, wrappedKey });
}

export async function getMyKey(db, user, collectionId) {
  await requirePermission(db, collectionId, user, 'read', 'retrieve collection keys');
  const key = await repo.findKey(db, collectionId, user.user_id);
  if (!key) throw notFound('Collection key not found for current user', 'KEY_NOT_FOUND');
  return key;
}

export async function addItem(db, user, collectionId, itemId) {
  await requirePermission(db, collectionId, user, 'write', 'add items to collection');
  const item = await repo.findVaultItemOwner(db, itemId);
  if (!item) throw notFound('Vault item not found');
  // Only the owner may put an item into a collection; otherwise any collection writer
  // could pull someone else's item in and read it through GET /collections/:id/items.
  if (item.user_id !== user.user_id) {
    throw forbidden('Only the owner of a vault item can add it to a collection', 'ITEM_NOT_OWNED');
  }
  if (await repo.findItemLink(db, collectionId, itemId)) {
    throw conflict('Item is already associated with this collection');
  }
  return repo.insertItemLink(db, collectionId, itemId);
}

export async function listItems(db, user, collectionId) {
  await requirePermission(db, collectionId, user, 'read', 'view collection items');
  return repo.listCollectionVaultItems(db, collectionId);
}

export async function removeItem(db, user, collectionId, itemId) {
  await requirePermission(db, collectionId, user, 'write', 'remove items from collection');
  if (!(await repo.findItemLink(db, collectionId, itemId))) throw notFound('Item association not found in collection');
  await repo.deleteItemLink(db, collectionId, itemId);
}

/**
 * Called after a member leaves a group: drop keys of collections the group had access to.
 */
export async function pruneKeysForGroup(db, groupId) {
  for (const collectionId of await repo.listGroupGrantCollectionIds(db, groupId)) {
    await pruneOrphanedKeys(db, collectionId);
  }
}
