/**
 * Secure Vault Cloud — Collections Handlers (M3: R1, R2, R3)
 *
 * Implements:
 * 1. Collection CRUD: createCollection, listCollections, getCollection, updateCollection, deleteCollection
 * 2. Collection Access RBAC: grantCollectionAccess, listCollectionAccess, revokeCollectionAccess
 * 3. Collection Keys Distribution: storeCollectionKey, getCollectionKey
 * 4. Collection Items Association: addCollectionItem, listCollectionItems, removeCollectionItem
 *
 * Ponytail minimalism: Parameterized SQL, atomic RBAC evaluation, dual naming convention.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/adapter.js';
import { authenticate, getEffectiveCollectionPermission } from '../middleware/auth-guard.js';

function jsonResponse(statusCode, data) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify(data),
  };
}

function parseBody(event) {
  if (!event.body) return {};
  if (typeof event.body === 'object') return event.body;
  try {
    return JSON.parse(event.body);
  } catch {
    return {};
  }
}

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
    title: row.title || metadata?.title || metadata?.name || '',
    category: row.category || row.item_type || 'LOGIN',
    item_type: row.item_type || row.category || 'login',
    tags: tags || metadata?.tags || [],
    metadata: metadata || {},
    favorite: Boolean(row.favorite !== undefined ? row.favorite : metadata?.favorite),
    version: row.version || 1,
    encryptedPayload: encryptedData,
    encrypted_data: encryptedData,
    createdAt: row.created_at,
    created_at: row.created_at,
    updatedAt: row.updated_at,
    updated_at: row.updated_at,
  };
}

async function recordAuditLog(db, { actorUserId, actorRole = 'user', eventAction, severity = 'INFO', targetResource = 'collection', targetResourceId = null, details = {} }) {
  try {
    await db.query(
      `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, status, details)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [actorUserId || null, actorRole || 'user', eventAction, severity, targetResource, targetResourceId, '127.0.0.1', 'SUCCESS', details]
    );
  } catch {
    // Non-blocking
  }
}

// ============================================================================
// Collection CRUD Handlers
// ============================================================================

/**
 * POST /api/v1/collections - Create collection with optional wrapped key
 */
export async function createCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const body = parseBody(event);
  const name = body.name;
  if (!name || typeof name !== 'string' || !name.trim()) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Collection name is required',
    });
  }

  const db = getDatabase();
  const collectionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const trimmedName = name.trim();
  const description = body.description || null;

  await db.query(
    'INSERT INTO collections (collection_id, name, description, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [collectionId, trimmedName, description, user.user_id, now, now]
  );

  // Creator direct admin access
  const accessId = crypto.randomUUID();
  await db.query(
    "INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission, created_at, updated_at) VALUES ($1, $2, 'user', $3, 'admin', $4, $5)",
    [accessId, collectionId, user.user_id, now, now]
  );

  // Store wrapped key if provided
  if (body.encryptedKeyForRecipient) {
    const keyId = crypto.randomUUID();
    await db.query(
      'INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
      [keyId, collectionId, user.user_id, body.encryptedKeyForRecipient, now, now]
    );
  }

  await recordAuditLog(db, {
    actorUserId: user.user_id,
    actorRole: user.role,
    eventAction: 'COLLECTION_CREATED',
    targetResourceId: collectionId,
    details: { name: trimmedName },
  });

  return jsonResponse(201, {
    status: 'success',
    success: true,
    collection: formatCollection(
      {
        collection_id: collectionId,
        name: trimmedName,
        description,
        created_by: user.user_id,
        created_at: now,
        updated_at: now,
      },
      'admin'
    ),
  });
}

/**
 * GET /api/v1/collections - List accessible collections for caller
 */
export async function listCollectionsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const allCollections = await db.query(
    'SELECT * FROM collections ORDER BY created_at DESC'
  );

  const accessible = [];
  for (const c of allCollections.rows || []) {
    const perm = await getEffectiveCollectionPermission(db, c.collection_id, user);
    if (perm) {
      accessible.push(formatCollection(c, perm));
    }
  }

  return jsonResponse(200, {
    status: 'success',
    success: true,
    collections: accessible,
  });
}

/**
 * GET /api/v1/collections/:collectionId - Get collection details
 */
export async function getCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!perm) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Insufficient permissions to view collection',
    });
  }

  return jsonResponse(200, {
    status: 'success',
    success: true,
    collection: formatCollection(res.rows[0], perm),
  });
}

/**
 * PUT /api/v1/collections/:collectionId - Update collection metadata
 */
export async function updateCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to update collection',
    });
  }

  const body = parseBody(event);
  if (body.name !== undefined && (typeof body.name !== 'string' || !body.name.trim())) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Collection name cannot be empty',
    });
  }

  const updatedName = body.name !== undefined ? body.name.trim() : res.rows[0].name;
  const updatedDesc = body.description !== undefined ? body.description : res.rows[0].description;
  const now = new Date().toISOString();

  await db.query(
    'UPDATE collections SET name = $1, description = $2, updated_at = $3 WHERE collection_id = $4',
    [updatedName, updatedDesc, now, collectionId]
  );

  const updated = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  return jsonResponse(200, {
    status: 'success',
    success: true,
    collection: formatCollection(updated.rows[0], 'admin'),
  });
}

/**
 * DELETE /api/v1/collections/:collectionId - Delete collection and associations
 */
export async function deleteCollectionHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to delete collection',
    });
  }

  await db.query('DELETE FROM collection_keys WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_items WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_access WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collections WHERE collection_id = $1', [collectionId]);

  return jsonResponse(200, {
    status: 'success',
    success: true,
    message: 'Collection deleted successfully',
  });
}

// ============================================================================
// Collection Access RBAC Handlers
// ============================================================================

/**
 * POST /api/v1/collections/:collectionId/access - Grant access to user or group
 */
export async function grantCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to manage access',
    });
  }

  const body = parseBody(event);
  const { targetType, targetId, permission = 'read' } = body;
  if (!targetType || !['user', 'group'].includes(targetType)) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'targetType must be "user" or "group"',
    });
  }

  if (!permission || !['read', 'write', 'admin'].includes(permission.toLowerCase())) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'permission must be "read", "write", or "admin"',
    });
  }

  if (targetType === 'user') {
    const u = await db.query('SELECT user_id FROM users WHERE user_id = $1', [targetId]);
    if (!u.rows || u.rows.length === 0) {
      return jsonResponse(404, {
        status: 'fail',
        error: 'NOT_FOUND',
        message: 'Target user not found',
      });
    }
  } else if (targetType === 'group') {
    const g = await db.query('SELECT group_id FROM groups WHERE group_id = $1', [targetId]);
    if (!g.rows || g.rows.length === 0) {
      return jsonResponse(404, {
        status: 'fail',
        error: 'NOT_FOUND',
        message: 'Target group not found',
      });
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

  return jsonResponse(201, {
    status: 'success',
    success: true,
    access: {
      collectionId,
      collection_id: collectionId,
      targetType,
      target_type: targetType,
      targetId,
      target_id: targetId,
      permission: normPerm,
    },
  });
}

/**
 * GET /api/v1/collections/:collectionId/access - List access grants
 */
export async function listCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to list access entries',
    });
  }

  const accessList = await db.query(
    'SELECT * FROM collection_access WHERE collection_id = $1 ORDER BY created_at ASC',
    [collectionId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    access: (accessList.rows || []).map(formatCollectionAccess),
  });
}

/**
 * DELETE /api/v1/collections/:collectionId/access/:targetType/:targetId - Revoke access grant
 */
export async function revokeCollectionAccessHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const targetType = event.pathParameters?.targetType;
  const targetId = event.pathParameters?.targetId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to revoke access',
    });
  }

  const existing = await db.query(
    'SELECT access_id FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3',
    [collectionId, targetType, targetId]
  );
  if (!existing.rows || existing.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Access entry not found',
    });
  }

  await db.query(
    'DELETE FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3',
    [collectionId, targetType, targetId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    message: 'Collection access revoked successfully',
  });
}

// ============================================================================
// Collection Keys Distribution Handlers
// ============================================================================

/**
 * POST /api/v1/collections/:collectionId/keys - Store wrapped collection key
 */
export async function storeCollectionKeyHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  // Distributing (or replacing) a wrapped key is an admin action: otherwise any member
  // could overwrite another member's key with one they control (key substitution).
  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Admin permission required to distribute collection keys',
    });
  }

  const body = parseBody(event);
  const targetUserId = body.userId || body.user_id;
  const encryptedKey = body.encryptedKeyForRecipient || body.encrypted_key_for_recipient;

  if (!targetUserId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'userId is required',
    });
  }

  if (!encryptedKey || typeof encryptedKey !== 'object' || !encryptedKey.ciphertext) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'Valid encryptedKeyForRecipient object with ciphertext is required',
    });
  }

  const targetUser = await db.query('SELECT user_id FROM users WHERE user_id = $1', [targetUserId]);
  if (!targetUser.rows || targetUser.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Target user not found',
    });
  }

  // Grant access first, then distribute the key: never store keys for non-members.
  const targetPerm = await getEffectiveCollectionPermission(db, collectionId, targetUserId);
  if (!targetPerm) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'TARGET_HAS_NO_ACCESS',
      message: 'Grant the user access to the collection before storing their key',
    });
  }

  const keyId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(collection_id, user_id)
     DO UPDATE SET encrypted_key_for_recipient = excluded.encrypted_key_for_recipient, updated_at = excluded.updated_at`,
    [keyId, collectionId, targetUserId, encryptedKey, now, now]
  );

  return jsonResponse(201, {
    status: 'success',
    success: true,
    message: 'Collection key stored successfully',
  });
}

/**
 * GET /api/v1/collections/:collectionId/keys - Retrieve wrapped key for authenticated user
 */
export async function getCollectionKeyHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!perm) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Insufficient permissions to retrieve collection keys',
    });
  }

  const keyRow = await db.query(
    'SELECT * FROM collection_keys WHERE collection_id = $1 AND user_id = $2',
    [collectionId, user.user_id]
  );

  if (!keyRow.rows || keyRow.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'KEY_NOT_FOUND',
      message: 'Collection key not found for current user',
    });
  }

  return jsonResponse(200, {
    status: 'success',
    success: true,
    key: formatCollectionKey(keyRow.rows[0]),
  });
}

// ============================================================================
// Collection Items Association Handlers
// ============================================================================

/**
 * POST /api/v1/collections/:collectionId/items - Associate item with collection
 */
export async function addCollectionItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'write' && perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Write permission required to add items to collection',
    });
  }

  const body = parseBody(event);
  const itemId = body.itemId || body.item_id;
  if (!itemId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'BAD_REQUEST',
      message: 'itemId is required',
    });
  }

  const item = await db.query('SELECT item_id, user_id FROM vault_items WHERE item_id = $1', [itemId]);
  if (!item.rows || item.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Vault item not found',
    });
  }
  // Only the owner may put an item into a collection; otherwise any collection writer
  // could pull someone else's item in and read it through GET /collections/:id/items.
  if (item.rows[0].user_id !== user.user_id) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'ITEM_NOT_OWNED',
      message: 'Only the owner of a vault item can add it to a collection',
    });
  }

  const existing = await db.query(
    'SELECT collection_item_id FROM collection_items WHERE collection_id = $1 AND item_id = $2',
    [collectionId, itemId]
  );
  if (existing.rows && existing.rows.length > 0) {
    return jsonResponse(409, {
      status: 'fail',
      error: 'CONFLICT',
      message: 'Item is already associated with this collection',
    });
  }

  const mapId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.query(
    'INSERT INTO collection_items (collection_item_id, collection_id, item_id, created_at) VALUES ($1, $2, $3, $4)',
    [mapId, collectionId, itemId, now]
  );

  return jsonResponse(201, {
    status: 'success',
    success: true,
    collectionItem: formatCollectionItem({
      collection_item_id: mapId,
      collection_id: collectionId,
      item_id: itemId,
      created_at: now,
    }),
  });
}

/**
 * GET /api/v1/collections/:collectionId/items - List associated items
 */
export async function listCollectionItemsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (!perm) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Insufficient permissions to view collection items',
    });
  }

  const items = await db.query(
    `SELECT vi.* FROM vault_items vi
     JOIN collection_items ci ON vi.item_id = ci.item_id
     WHERE ci.collection_id = $1
     ORDER BY vi.created_at DESC`,
    [collectionId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    items: (items.rows || []).map(formatVaultItem),
  });
}

/**
 * DELETE /api/v1/collections/:collectionId/items/:itemId - Disassociate item from collection
 */
export async function removeCollectionItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const collectionId = event.pathParameters?.collectionId;
  const itemId = event.pathParameters?.itemId;
  const db = getDatabase();

  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  if (!res.rows || res.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Collection not found',
    });
  }

  const perm = await getEffectiveCollectionPermission(db, collectionId, user);
  if (perm !== 'write' && perm !== 'admin') {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Forbidden: Write permission required to remove items from collection',
    });
  }

  const existing = await db.query(
    'SELECT collection_item_id FROM collection_items WHERE collection_id = $1 AND item_id = $2',
    [collectionId, itemId]
  );
  if (!existing.rows || existing.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'NOT_FOUND',
      message: 'Item association not found in collection',
    });
  }

  await db.query(
    'DELETE FROM collection_items WHERE collection_id = $1 AND item_id = $2',
    [collectionId, itemId]
  );

  return jsonResponse(200, {
    status: 'success',
    success: true,
    message: 'Item disassociated from collection',
  });
}
