/**
 * Secure Vault Cloud — Collections HTTP handlers (R1, R2, R3)
 *
 * Layers: handler (this file: auth, input validation, response shape)
 *   -> services/collection-service.js (permissions, business rules)
 *   -> db/collection-repo.js (parameterized SQL).
 */

import { getDatabase } from '../db/adapter.js';
import { authenticate } from '../middleware/auth-guard.js';
import { ok, readJsonBody, badRequest } from '../http/response.js';
import { requireUuids, requireEnum, checkText, isWrappedKey } from '../http/validate.js';
import * as service from '../services/collection-service.js';

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
  if (row.item_count !== undefined) {
    obj.itemCount = Number(row.item_count);
    obj.item_count = obj.itemCount;
  }
  if (perm) {
    obj.effectivePermission = perm;
    obj.effective_permission = perm;
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
    requireEnum('permission', permission, ['read', 'write', 'admin']) ||
    requireUuids({ targetId });
  if (inputError) return inputError;

  const normPerm = permission.toLowerCase();
  await service.grantAccess(getDatabase(), user, collectionId, { targetType, targetId, permission: normPerm });
  return ok(
    {
      access: {
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
  const access = await service.listAccess(getDatabase(), user, collectionId);
  return ok({ access: access.map(formatCollectionAccess) });
}

/**
 * DELETE /collections/:collectionId/access/:targetType/:targetId
 */
export async function revokeCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const targetType = String(event.pathParameters?.targetType || '').toLowerCase();
  const targetId = event.pathParameters?.targetId;
  const targetError = requireEnum('targetType', targetType, ['user', 'group']) || requireUuids({ targetId });
  if (targetError) return targetError;

  const keysRemoved = await service.revokeAccess(getDatabase(), user, collectionId, { targetType, targetId });
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
  const wrappedKey = body.encryptedKeyForRecipient || body.encrypted_key_for_recipient;
  if (!userId) return badRequest('userId is required');
  const userIdError = requireUuids({ userId });
  if (userIdError) return userIdError;
  if (!isWrappedKey(wrappedKey)) return badRequest('Valid encryptedKeyForRecipient object with ciphertext is required');

  await service.storeKey(getDatabase(), user, collectionId, { userId, wrappedKey });
  return ok({ message: 'Collection key stored successfully' }, 201);
}

/**
 * GET /collections/:collectionId/keys/pending — members with access but without a key
 */
export async function listPendingCollectionKeysHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const pending = await service.listPendingKeys(getDatabase(), user, collectionId);
  return ok({
    pending: pending.map((u) => ({
      user_id: u.user_id,
      username: u.username,
      email: u.email,
      full_name: u.full_name,
      public_key: u.public_key,
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
  const key = await service.getMyKey(getDatabase(), user, collectionId);
  return ok({ key: formatCollectionKey(key) });
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

  const link = await service.addItem(getDatabase(), user, collectionId, itemId);
  return ok({ collectionItem: formatCollectionItem(link) }, 201);
}

/**
 * GET /collections/:collectionId/items
 */
export async function listCollectionItemsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;
  const { collectionId, error } = withValidatedCollection(event);
  if (error) return error;
  const items = await service.listItems(getDatabase(), user, collectionId);
  return ok({ items: items.map(formatVaultItem) });
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

  await service.removeItem(getDatabase(), user, collectionId, itemId);
  return ok({ message: 'Item disassociated from collection' });
}
