/**
 * Secure Vault Cloud — Collections HTTP handlers (R1, R2, R3)
 *
 * Layers: handler (this file: auth, input validation, response shape)
 *   -> services/collection-service.js (permissions, business rules)
 *   -> db/collection-repo.js (parameterized SQL).
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/adapter.js';
import {
  authenticate,
  requireOrgRole,
  getEffectiveCollectionPermission,
  hasRequiredPermission,
} from '../middleware/auth-guard.js';
import { ok, readJsonBody, badRequest, forbidden, notFound, conflict } from '../http/response.js';
import { requireUuids, requireEnum, checkText, isWrappedKey } from '../http/validate.js';
import * as service from '../services/collection-service.js';
import { insertAuditLog } from '../db/collection-repo.js';

async function audit(db, user, action, collectionId, details = {}) {
  await insertAuditLog(db, {
    actorUserId: user?.user_id,
    actorRole: user?.role,
    action,
    collectionId,
    details,
    ipAddress: user?.source_ip || '0.0.0.0',
  }).catch((err) =>
    console.error(JSON.stringify({ level: 'error', msg: 'audit log write failed', action, error: err.message }))
  );
}

const NAME_MAX = 255;
const DESCRIPTION_MAX = 2000;

/**
 * Normalizes collection row with effective permission
 */
export function formatCollection(row, effectivePermission = null) {
  if (!row) return null;
  const id = row.collection_id || row.id;
  const name = row.name;
  const description = row.description !== undefined ? row.description : null;
  const createdBy = row.created_by || row.createdBy;
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;
  const orgId = row.org_id || row.orgId || null;
  const perm = effectivePermission || row.effective_permission || row.effectivePermission;
  const obj = {
    id,
    collection_id: id,
    name,
    description,
    createdBy,
    created_by: createdBy,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
  if (orgId !== null && orgId !== undefined) {
    obj.orgId = orgId;
    obj.org_id = orgId;
  }
  if (row.item_count !== undefined) {
    obj.itemCount = Number(row.item_count);
    obj.item_count = obj.itemCount;
  }
  if (perm) {
    const norm = String(perm).toLowerCase();
    if (norm === 'admin' || norm === 'manage') {
      obj.effectivePermission = 'admin';
      obj.effective_permission = 'manage';
    } else {
      obj.effectivePermission = norm;
      obj.effective_permission = norm;
    }
  }
  return obj;
}

/**
 * Normalizes collection access entry
 */
export function formatCollectionAccess(row) {
  if (!row) return null;
  const id = row.access_id || row.id;
  const collectionId = row.collection_id || row.collectionId;
  const targetType = row.target_type || row.targetType;
  const targetId = row.target_id || row.targetId;
  const permission = row.permission;
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;
  return {
    id,
    access_id: id,
    collectionId,
    collection_id: collectionId,
    targetType,
    target_type: targetType,
    targetId,
    target_id: targetId,
    permission,
    targetName: row.target_type === 'group' ? row.target_group_name || null : row.target_full_name || row.target_username || null,
    targetUsername: row.target_username || null,
    targetEmail: row.target_email || null,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

/**
 * Normalizes collection key entry
 */
export function formatCollectionKey(row) {
  if (!row) return null;
  const id = row.key_id || row.id;
  const collectionId = row.collection_id || row.collectionId;
  const userId = row.user_id || row.userId;
  let encryptedKeyForRecipient = row.encrypted_key_for_recipient || row.encryptedKeyForRecipient;
  if (typeof encryptedKeyForRecipient === 'string') {
    try {
      encryptedKeyForRecipient = JSON.parse(encryptedKeyForRecipient);
    } catch {
      // keep
    }
  }
  const createdAt = row.created_at || row.createdAt;
  const updatedAt = row.updated_at || row.updatedAt;
  return {
    id,
    key_id: id,
    collectionId,
    collection_id: collectionId,
    userId,
    user_id: userId,
    encryptedKeyForRecipient,
    encrypted_key_for_recipient: encryptedKeyForRecipient,
    encryptedCollectionKey: encryptedKeyForRecipient,
    encrypted_collection_key: encryptedKeyForRecipient,
    createdAt,
    created_at: createdAt,
    updatedAt,
    updated_at: updatedAt,
  };
}

/**
 * Normalizes collection item association
 */
export function formatCollectionItem(row) {
  if (!row) return null;
  const id = row.collection_item_id || row.id;
  const collectionId = row.collection_id || row.collectionId;
  const itemId = row.item_id || row.itemId;
  const createdAt = row.created_at || row.createdAt;
  return {
    id,
    collection_item_id: id,
    collectionId,
    collection_id: collectionId,
    itemId,
    item_id: itemId,
    createdAt,
    created_at: createdAt,
  };
}

/**
 * Normalizes vault item in collection items list
 */
export function formatVaultItem(row) {
  if (!row) return null;
  const id = row.item_id || row.id;
  let tags = row.tags;
  if (typeof tags === 'string') {
    try {
      tags = JSON.parse(tags);
    } catch {
      tags = [];
    }
  }
  let encryptedData = row.encrypted_data || row.encryptedPayload;
  if (typeof encryptedData === 'string') {
    try {
      encryptedData = JSON.parse(encryptedData);
    } catch {
      // keep
    }
  }
  let metadata = row.metadata;
  if (typeof metadata === 'string') {
    try {
      metadata = JSON.parse(metadata);
    } catch {
      metadata = {};
    }
  }
  return {
    id,
    item_id: id,
    category: row.category || row.item_type || 'LOGIN',
    item_type: row.item_type || row.category || 'login',
    metadata: metadata || {},
    favorite: Boolean(row.favorite !== undefined ? row.favorite : metadata?.favorite),
    version: row.version || 1,
    encryptedPayload: encryptedData,
    encrypted_data: encryptedData,
    // Item Key wrapped with the collection key (null for legacy items)
    encrypted_item_key: row.encrypted_item_key ?? null,
    user_id: row.user_id,
    vault_id: row.vault_id,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

// ============================================================================
// HTTP handlers: authenticate -> validate -> service -> format
// ============================================================================

function withValidatedCollection(event) {
  const collectionId = event.pathParameters?.collectionId;
  return { collectionId, error: requireUuids({ collectionId }) };
}

/**
 * POST /collections
 */
export async function createCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = checkText('name', body.name, { min: 1, max: NAME_MAX });
  const descCheck = checkText('description', body.description ?? null, { max: DESCRIPTION_MAX, allowNull: true });
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);
  if (body.encryptedKeyForRecipient !== undefined && !isWrappedKey(body.encryptedKeyForRecipient)) {
    errors.push({ field: 'encryptedKeyForRecipient', message: 'encryptedKeyForRecipient must be { ciphertext, algorithm, hash }' });
  }
  if (errors.length) return badRequest('Invalid collection', 'VALIDATION_FAILED', errors);

  const collection = await service.createCollection(getDatabase(), user, {
    name: nameCheck.value,
    description: descCheck.value || null,
    wrappedKey: body.encryptedKeyForRecipient,
  });
  return ok({ collection: formatCollection(collection, 'admin') }, 201);
}

/**
 * GET /collections
 */
export async function listCollectionsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const accessible = await service.listCollections(getDatabase(), user);
  return ok({ collections: accessible.map(({ collection, permission }) => formatCollection(collection, permission)) });
}

/**
 * GET /collections/:collectionId
 */
export async function getCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const { collection, permission } = await service.getCollection(getDatabase(), user, collectionId);
  return ok({ collection: formatCollection(collection, permission) });
}

/**
 * PUT /collections/:collectionId
 */
export async function updateCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = body.name !== undefined ? checkText('name', body.name, { min: 1, max: NAME_MAX }) : {};
  const descCheck = body.description !== undefined ? checkText('description', body.description, { max: DESCRIPTION_MAX, allowNull: true }) : {};
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);
  if (errors.length) return badRequest('Invalid collection', 'VALIDATION_FAILED', errors);

  const updated = await service.updateCollection(getDatabase(), user, collectionId, {
    name: nameCheck.value,
    description: body.description === undefined ? undefined : descCheck.value || null,
  });
  return ok({ collection: formatCollection(updated, 'admin') });
}

/**
 * DELETE /collections/:collectionId
 */
export async function deleteCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  await service.deleteCollection(getDatabase(), user, collectionId);
  return ok({ message: 'Collection deleted successfully' });
}

/**
 * POST /collections/:collectionId/access
 */
export async function grantCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const { targetId, permission = 'read' } = body;
  const targetType = typeof body.targetType === 'string' ? body.targetType.toLowerCase() : body.targetType;
  const inputError =
    requireEnum('targetType', targetType, ['user', 'group']) ||
    requireEnum('permission', permission, ['read', 'write', 'admin', 'manage']) ||
    requireUuids({ targetId });
  if (inputError) return inputError;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'manage')) {
    return forbidden('Forbidden: manage permission required to grant collection access');
  }

  // Cross-tenant firewall
  const colRes = await db.query('SELECT collection_id, org_id FROM collections WHERE collection_id = $1', [collectionId]);
  if (!colRes.rows || colRes.rows.length === 0) return notFound('Collection not found');
  const colOrgId = colRes.rows[0].org_id;

  if (colOrgId) {
    if (targetType === 'group') {
      const grpRes = await db.query('SELECT org_id FROM groups WHERE group_id = $1', [targetId]);
      if (!grpRes.rows || grpRes.rows.length === 0) return notFound('Target group not found');
      if (grpRes.rows[0].org_id !== colOrgId) {
        return badRequest('Group does not belong to the same organization as the collection', 'CROSS_ORG_FORBIDDEN');
      }
    } else if (targetType === 'user') {
      const memRes = await db.query(
        'SELECT org_member_id FROM organization_members WHERE org_id = $1 AND user_id = $2 AND status = $3',
        [colOrgId, targetId, 'confirmed']
      );
      if (!memRes.rows || memRes.rows.length === 0) {
        return badRequest('Target user is not a member of this organization', 'CROSS_ORG_FORBIDDEN');
      }
    }
  } else {
    // Standalone collection: verify target user/group exists
    if (targetType === 'user') {
      const uRes = await db.query('SELECT user_id FROM users WHERE user_id = $1', [targetId]);
      if (!uRes.rows || uRes.rows.length === 0) return notFound('Target user not found');
    } else {
      const gRes = await db.query('SELECT group_id FROM groups WHERE group_id = $1', [targetId]);
      if (!gRes.rows || gRes.rows.length === 0) return notFound('Target group not found');
    }
  }

  const normPerm = permission.toLowerCase();
  const accessId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(collection_id, target_type, target_id)
     DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at`,
    [accessId, collectionId, targetType, targetId, normPerm, now, now]
  );

  await audit(db, user, 'COLLECTION_ACCESS_GRANTED', collectionId, { targetType, targetId, permission: normPerm });

  return ok(
    {
      access: {
        id: accessId,
        access_id: accessId,
        collectionId,
        collection_id: collectionId,
        targetType,
        target_type: targetType,
        targetId,
        target_id: targetId,
        permission: normPerm,
      },
    },
    201
  );
}

/**
 * GET /collections/:collectionId/access
 */
export async function listCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'manage')) {
    return forbidden('Forbidden: manage permission required to list access entries');
  }

  const access = await service.listAccess(db, user, collectionId);
  return ok({ access: access.map(formatCollectionAccess) });
}

/**
 * DELETE /collections/:collectionId/access/:targetType/:targetId or DELETE /collections/:collectionId/access/:grantId
 */
export async function revokeCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'manage')) {
    return forbidden('Forbidden: manage permission required to revoke access');
  }

  let targetType = String(event.pathParameters?.targetType || '').toLowerCase();
  let targetId = event.pathParameters?.targetId;
  const grantId = event.pathParameters?.grantId || event.pathParameters?.accessId;

  if (!targetId && grantId) {
    const accRes = await db.query(
      'SELECT target_type, target_id FROM collection_access WHERE collection_id = $1 AND access_id = $2',
      [collectionId, grantId]
    );
    if (!accRes.rows || accRes.rows.length === 0) {
      return notFound('Access entry not found');
    }
    targetType = accRes.rows[0].target_type;
    targetId = accRes.rows[0].target_id;
  }

  const targetError = requireEnum('targetType', targetType, ['user', 'group']) || requireUuids({ targetId });
  if (targetError) return targetError;

  const existingRes = await db.query(
    'SELECT access_id FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3',
    [collectionId, targetType, targetId]
  );
  if (!existingRes.rows || existingRes.rows.length === 0) {
    return notFound('Access entry not found');
  }

  await db.query(
    'DELETE FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3',
    [collectionId, targetType, targetId]
  );

  const keysRemoved = await service.pruneOrphanedKeys(db, collectionId);
  await audit(db, user, 'COLLECTION_ACCESS_REVOKED', collectionId, { targetType, targetId, keysRemoved });
  return ok({ message: 'Collection access revoked successfully', keysRemoved });
}

/**
 * POST /collections/:collectionId/keys
 */
export async function storeCollectionKeyHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const userId = body.userId || body.user_id;
  const wrappedKey = body.encryptedKeyForRecipient || body.encrypted_key_for_recipient || body.encryptedCollectionKey || body.encrypted_collection_key;
  if (!userId) return badRequest('userId is required');
  const userIdError = requireUuids({ userId });
  if (userIdError) return userIdError;
  if (!isWrappedKey(wrappedKey)) return badRequest('Valid encryptedKeyForRecipient object with ciphertext is required');

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'manage')) {
    return forbidden('Forbidden: manage permission required to distribute collection keys');
  }

  const userRes = await db.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
  if (!userRes.rows || userRes.rows.length === 0) return notFound('Target user not found');

  const targetPerm = await getEffectiveCollectionPermission(db, collectionId, userId);
  if (!targetPerm) {
    return badRequest('Grant the user access to the collection before storing their key', 'TARGET_HAS_NO_ACCESS');
  }

  const keyId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT (collection_id, user_id)
     DO UPDATE SET encrypted_key_for_recipient = excluded.encrypted_key_for_recipient, updated_at = excluded.updated_at`,
    [keyId, collectionId, userId, wrappedKey, now, now]
  );

  await audit(db, user, 'COLLECTION_KEY_DISTRIBUTED', collectionId, { userId });

  return ok({ message: 'Collection key stored successfully' }, 201);
}

/**
 * GET /collections/:collectionId/keys/pending (and /pending-keys) — members with access but without a key
 */
export async function listPendingCollectionKeysHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'manage')) {
    return forbidden('Forbidden: manage permission required to list members without keys');
  }

  const colRes = await db.query('SELECT collection_id, org_id, created_by FROM collections WHERE collection_id = $1', [collectionId]);
  if (!colRes.rows || colRes.rows.length === 0) return notFound('Collection not found');

  const pendingRes = await db.query(
    `WITH target_collection AS (
       SELECT collection_id, org_id, created_by FROM collections WHERE collection_id = $1
     ),
     org_admins AS (
       SELECT om.user_id FROM organization_members om
       JOIN target_collection tc ON tc.org_id = om.org_id
       WHERE om.status = 'confirmed' AND om.role IN ('owner', 'admin')
     ),
     direct_users AS (
       SELECT ca.target_id AS user_id FROM collection_access ca
       WHERE ca.collection_id = $1 AND ca.target_type = 'user'
     ),
     group_users AS (
       SELECT gm.user_id FROM group_members gm
       JOIN collection_access ca ON ca.target_id = gm.group_id
       WHERE ca.collection_id = $1 AND ca.target_type = 'group'
     ),
     all_access_users AS (
       SELECT created_by AS user_id FROM target_collection
       UNION
       SELECT user_id FROM org_admins
       UNION
       SELECT user_id FROM direct_users
       UNION
       SELECT user_id FROM group_users
     )
     SELECT u.user_id, u.username, u.email, u.full_name, u.public_key
     FROM all_access_users au
     JOIN users u ON u.user_id = au.user_id
     WHERE au.user_id NOT IN (
       SELECT user_id FROM collection_keys WHERE collection_id = $1
     )
     ORDER BY u.username ASC`,
    [collectionId]
  );

  return ok({
    pending: (pendingRes.rows || []).map((u) => ({
      user_id: u.user_id,
      userId: u.user_id,
      username: u.username,
      email: u.email,
      full_name: u.full_name,
      fullName: u.full_name,
      public_key: u.public_key,
      publicKey: u.public_key,
    })),
  });
}

/**
 * GET /collections/:collectionId/keys — the caller's own wrapped key
 */
export async function getCollectionKeyHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;

  const db = getDatabase();
  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(perm, 'read')) {
    return forbidden('Forbidden: read permission required to retrieve collection keys');
  }

  const keyRes = await db.query(
    'SELECT * FROM collection_keys WHERE collection_id = $1 AND user_id = $2',
    [collectionId, user.user_id]
  );
  if (!keyRes.rows || keyRes.rows.length === 0) {
    return notFound('Collection key not found for current user', 'KEY_NOT_FOUND');
  }

  return ok({ key: formatCollectionKey(keyRes.rows[0]) });
}

/**
 * POST /collections/:collectionId/items
 */
export async function addCollectionItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const itemId = body.itemId || body.item_id;
  if (!itemId) return badRequest('itemId is required');
  const itemIdError = requireUuids({ itemId });
  if (itemIdError) return itemIdError;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'write')) {
    return forbidden('Forbidden: write permission required to add items to collection');
  }

  const itemRes = await db.query('SELECT item_id, user_id FROM vault_items WHERE item_id = $1', [itemId]);
  if (!itemRes.rows || itemRes.rows.length === 0) return notFound('Vault item not found');

  if (itemRes.rows[0].user_id !== user.user_id) {
    return forbidden('Only the owner of a vault item can add it to a collection', 'ITEM_NOT_OWNED');
  }

  const existingRes = await db.query(
    'SELECT collection_item_id FROM collection_items WHERE collection_id = $1 AND item_id = $2',
    [collectionId, itemId]
  );
  if (existingRes.rows && existingRes.rows.length > 0) {
    return conflict('Item is already associated with this collection');
  }

  const linkId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.query(
    'INSERT INTO collection_items (collection_item_id, collection_id, item_id, created_at) VALUES ($1, $2, $3, $4)',
    [linkId, collectionId, itemId, now]
  );

  await audit(db, user, 'COLLECTION_ITEM_ADDED', collectionId, { itemId });

  return ok(
    {
      collectionItem: formatCollectionItem({
        collection_item_id: linkId,
        collection_id: collectionId,
        item_id: itemId,
        created_at: now,
      }),
    },
    201
  );
}

/**
 * GET /collections/:collectionId/items
 */
export async function listCollectionItemsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;

  const db = getDatabase();
  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(perm, 'read')) {
    return forbidden('Forbidden: read permission required to view collection items');
  }

  const res = await db.query(
    `SELECT vi.*, ci.created_at AS linked_at
     FROM collection_items ci
     JOIN vault_items vi ON ci.item_id = vi.item_id
     WHERE ci.collection_id = $1
     ORDER BY ci.created_at DESC`,
    [collectionId]
  );

  return ok({ items: (res.rows || []).map(formatVaultItem) });
}

/**
 * DELETE /collections/:collectionId/items/:itemId
 */
export async function removeCollectionItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const itemId = event.pathParameters?.itemId;
  const itemIdError = requireUuids({ itemId });
  if (itemIdError) return itemIdError;

  const db = getDatabase();
  const callerPerm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(callerPerm, 'write')) {
    return forbidden('Forbidden: write permission required to remove items from collection');
  }

  const linkRes = await db.query(
    'SELECT collection_item_id FROM collection_items WHERE collection_id = $1 AND item_id = $2',
    [collectionId, itemId]
  );
  if (!linkRes.rows || linkRes.rows.length === 0) {
    return notFound('Item link not found in collection');
  }

  await db.query('DELETE FROM collection_items WHERE collection_id = $1 AND item_id = $2', [
    collectionId,
    itemId,
  ]);

  await audit(db, user, 'COLLECTION_ITEM_REMOVED', collectionId, { itemId });

  return ok({ message: 'Item disassociated from collection' });
}

// ============================================================================
// Organization-Scoped Collection Handlers (M4: Features 20, 21, 23)
// ============================================================================

/**
 * POST /api/v1/organizations/:orgId/collections - Create collection scoped to organization
 */
export async function createOrgCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = checkText('name', body.name, { min: 1, max: NAME_MAX });
  const descCheck = checkText('description', body.description ?? null, { max: DESCRIPTION_MAX, allowNull: true });
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);
  const wrappedKey = body.encryptedKeyForRecipient || body.encrypted_collection_key || body.encryptedCollectionKey;
  if (wrappedKey !== undefined && !isWrappedKey(wrappedKey)) {
    errors.push({ field: 'encryptedKeyForRecipient', message: 'encryptedKeyForRecipient must be { ciphertext, algorithm, hash }' });
  }
  if (errors.length) return badRequest('Invalid collection', 'VALIDATION_FAILED', errors);

  const collectionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = nameCheck.value;
  const description = descCheck.value || null;

  await db.query(
    'INSERT INTO collections (collection_id, org_id, name, description, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
    [collectionId, orgId, name, description, user.user_id, now, now]
  );

  const accessId = crypto.randomUUID();
  await db.query(
    "INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission, created_at, updated_at) VALUES ($1, $2, 'user', $3, 'manage', $4, $5)",
    [accessId, collectionId, user.user_id, now, now]
  );

  if (wrappedKey) {
    const keyId = crypto.randomUUID();
    await db.query(
      'INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [keyId, collectionId, user.user_id, wrappedKey, now, now]
    );
  }

  return ok(
    {
      collection: formatCollection(
        {
          collection_id: collectionId,
          org_id: orgId,
          name,
          description,
          created_by: user.user_id,
          created_at: now,
          updated_at: now,
          item_count: 0,
        },
        'manage'
      ),
    },
    201
  );
}

/**
 * GET /api/v1/organizations/:orgId/collections - List collections in organization
 */
export async function listOrgCollectionsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const db = getDatabase();
  const { role: callerOrgRole, errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  let cols = [];
  if (callerOrgRole === 'owner' || callerOrgRole === 'admin') {
    const res = await db.query(
      `SELECT c.*,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.collection_id) AS item_count
       FROM collections c
       WHERE c.org_id = $1
       ORDER BY c.created_at DESC`,
      [orgId]
    );
    cols = (res.rows || []).map((row) => formatCollection(row, 'manage'));
  } else {
    const res = await db.query(
      `WITH user_groups AS (
         SELECT gm.group_id FROM group_members gm
         JOIN groups g ON g.group_id = gm.group_id
         WHERE gm.user_id = $1 AND g.org_id = $2
       ),
       grants AS (
         SELECT ca.collection_id,
                CASE LOWER(ca.permission)
                  WHEN 'admin' THEN 3
                  WHEN 'manage' THEN 3
                  WHEN 'write' THEN 2
                  WHEN 'read' THEN 1
                  ELSE 0
                END AS perm_rank
         FROM collection_access ca
         WHERE ca.target_type = 'user' AND ca.target_id = $1
         UNION ALL
         SELECT ca.collection_id,
                CASE LOWER(ca.permission)
                  WHEN 'admin' THEN 3
                  WHEN 'manage' THEN 3
                  WHEN 'write' THEN 2
                  WHEN 'read' THEN 1
                  ELSE 0
                END AS perm_rank
         FROM collection_access ca
         JOIN user_groups ug ON ug.group_id = ca.target_id
         WHERE ca.target_type = 'group'
         UNION ALL
         SELECT c.collection_id, 3 AS perm_rank
         FROM collections c
         WHERE c.created_by = $1 AND c.org_id = $2
       )
       SELECT c.*,
              (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.collection_id) AS item_count,
              MAX(g.perm_rank) AS max_rank
       FROM collections c
       JOIN grants g ON g.collection_id = c.collection_id
       WHERE c.org_id = $2
       GROUP BY c.collection_id
       HAVING MAX(g.perm_rank) > 0
       ORDER BY c.created_at DESC`,
      [user.user_id, orgId]
    );
    cols = (res.rows || []).map((row) => {
      const rank = Number(row.max_rank || 0);
      const perm = rank === 3 ? 'manage' : (rank === 2 ? 'write' : (rank === 1 ? 'read' : null));
      return formatCollection(row, perm);
    });
  }

  return ok({ collections: cols });
}

/**
 * GET /api/v1/organizations/:orgId/collections/:collectionId - Get collection details
 */
export async function getOrgCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const colRes = await db.query(
    `SELECT c.*,
            (SELECT COUNT(*) FROM collection_items ci WHERE ci.collection_id = c.collection_id) AS item_count
     FROM collections c
     WHERE c.collection_id = $1 AND c.org_id = $2`,
    [collectionId, orgId]
  );
  if (!colRes.rows || colRes.rows.length === 0) {
    return notFound('Collection not found');
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!perm) {
    return forbidden('Forbidden: You do not have access to this collection');
  }

  return ok({ collection: formatCollection(colRes.rows[0], perm) });
}

/**
 * PUT /api/v1/organizations/:orgId/collections/:collectionId - Update collection
 */
export async function updateOrgCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const colRes = await db.query(
    'SELECT * FROM collections WHERE collection_id = $1 AND org_id = $2',
    [collectionId, orgId]
  );
  if (!colRes.rows || colRes.rows.length === 0) {
    return notFound('Collection not found');
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(perm, 'manage')) {
    return forbidden('Forbidden: manage permission required to update collection');
  }

  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const nameCheck = body.name !== undefined ? checkText('name', body.name, { min: 1, max: NAME_MAX }) : {};
  const descCheck = body.description !== undefined ? checkText('description', body.description, { max: DESCRIPTION_MAX, allowNull: true }) : {};
  const errors = [nameCheck.error, descCheck.error].filter(Boolean);
  if (errors.length) return badRequest('Invalid collection', 'VALIDATION_FAILED', errors);

  const newName = nameCheck.value !== undefined ? nameCheck.value : colRes.rows[0].name;
  const newDescription = body.description !== undefined ? descCheck.value || null : colRes.rows[0].description;
  const now = new Date().toISOString();

  await db.query(
    'UPDATE collections SET name = $1, description = $2, updated_at = $3 WHERE collection_id = $4 AND org_id = $5',
    [newName, newDescription, now, collectionId, orgId]
  );

  return ok({
    collection: formatCollection(
      {
        ...colRes.rows[0],
        name: newName,
        description: newDescription,
        updated_at: now,
      },
      'manage'
    ),
  });
}

/**
 * DELETE /api/v1/organizations/:orgId/collections/:collectionId - Delete collection
 */
export async function deleteOrgCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const orgId = event.pathParameters?.orgId || event.pathParameters?.id;
  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();
  const { errorResponse: authError } = await requireOrgRole(db, orgId, user, 'member');
  if (authError) return authError;

  const colRes = await db.query(
    'SELECT * FROM collections WHERE collection_id = $1 AND org_id = $2',
    [collectionId, orgId]
  );
  if (!colRes.rows || colRes.rows.length === 0) {
    return notFound('Collection not found');
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!hasRequiredPermission(perm, 'manage')) {
    return forbidden('Forbidden: manage permission required to delete collection');
  }

  await db.query('DELETE FROM collection_keys WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_items WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_access WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collections WHERE collection_id = $1 AND org_id = $2', [collectionId, orgId]);

  return ok({ message: 'Collection deleted successfully', deleted: true });
}
