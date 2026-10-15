/**
 * Secure Vault Cloud — Vault & Items Handlers (UC-4, UC-5, UC-6)
 *
 * Implements:
 * 1. UC-4: Add Vault Item (AES-256-GCM encrypted payload, JSONB storage, ZK validation).
 * 2. UC-5: Update Vault Item (Snapshot archive to password_history, version increment, concurrency check).
 * 3. UC-6: Delete Vault Item (Cascading share and history cleanup, audit logging).
 * 4. Vault Listing and Item Retrieval with encrypted payload intact.
 *
 * Zero-Knowledge Guarantee: Unencrypted secret credentials NEVER touch the server.
 * Server strictly receives, stores, and serves encrypted JSONB blobs.
 */

import { getDatabase } from '../db/adapter.js';
import { authenticate, hasRequiredPermission } from '../middleware/auth-guard.js';
import { permissionOnItemViaCollections } from '../services/collection-service.js';
import { isUuid } from '../http/validate.js';

/**
 * Plaintext metadata the server may store. Everything else (title, url, username, tags,
 * notes) belongs inside encrypted_data so it never leaves the browser unencrypted.
 * @returns {{ value?: object, error?: object }}
 */
const ALLOWED_METADATA_KEYS = new Set(['favorite', 'collection_id']);
function sanitizeMetadata(metadata) {
  if (metadata === undefined || metadata === null) return { value: {} };
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    return { error: { error: 'INVALID_METADATA', message: 'metadata must be an object' } };
  }
  const extra = Object.keys(metadata).filter((k) => !ALLOWED_METADATA_KEYS.has(k));
  if (extra.length) {
    return {
      error: {
        error: 'METADATA_NOT_ALLOWED',
        message: `Sensitive fields must be encrypted, not sent as metadata: ${extra.join(', ')}`,
      },
    };
  }
  if (metadata.favorite !== undefined && typeof metadata.favorite !== 'boolean') {
    return { error: { error: 'INVALID_METADATA', message: 'metadata.favorite must be a boolean' } };
  }
  if (metadata.collection_id !== undefined && metadata.collection_id !== null && !isUuid(metadata.collection_id)) {
    return { error: { error: 'INVALID_METADATA', message: 'metadata.collection_id must be a UUID' } };
  }
  return { value: { ...metadata } };
}

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
 * Validates that encrypted_data meets Zero-Knowledge specification
 * @param {object} encryptedData
 * @returns {{ valid: boolean, error?: string }}
 */
export function validateEncryptedPayload(encryptedData) {
  if (!encryptedData || typeof encryptedData !== 'object') {
    return { valid: false, error: 'encrypted_data must be a valid JSON object' };
  }

  const ciphertext = encryptedData.ciphertext;
  const iv = encryptedData.iv;
  const authTag = encryptedData.auth_tag || encryptedData.authTag;

  if (!ciphertext || typeof ciphertext !== 'string' || ciphertext.trim().length === 0) {
    return { valid: false, error: 'ciphertext must be a non-empty Base64 string' };
  }

  if (!iv || typeof iv !== 'string' || iv.trim().length === 0) {
    return { valid: false, error: 'iv (nonce) must be a non-empty Base64 string' };
  }

  if (!authTag || typeof authTag !== 'string' || authTag.trim().length === 0) {
    return { valid: false, error: 'auth_tag must be a non-empty Base64 string' };
  }

  return { valid: true };
}

/**
 * Normalizes encrypted_data fields to snake_case for DB storage
 */
export function normalizeEncryptedData(encryptedData) {
  return {
    ciphertext: encryptedData.ciphertext,
    iv: encryptedData.iv,
    auth_tag: encryptedData.auth_tag || encryptedData.authTag,
    algorithm: encryptedData.algorithm || 'AES-256-GCM',
    key_version: encryptedData.key_version || encryptedData.keyVersion || 1,
  };
}

// ============================================================================
// Vault Listing & Management
// ============================================================================

/**
 * GET /api/v1/vaults - List user vaults
 */
export async function listVaultsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  let result = await db.query(
    'SELECT vault_id, user_id, name, description, is_shared, created_at, updated_at FROM vaults WHERE user_id = $1 ORDER BY created_at ASC',
    [user.user_id]
  );

  // If user has no vault, auto-create Personal Vault
  if (result.rows.length === 0) {
    const created = await db.query(
      'INSERT INTO vaults (user_id, name, description) VALUES ($1, $2, $3) RETURNING *',
      [user.user_id, 'Personal Vault', 'Default personal password vault']
    );
    result = created;
  }

  return jsonResponse(200, {
    status: 'success',
    data: result.rows,
  });
}

/**
 * GET /api/v1/vaults/{vaultId}/items - List items in vault
 */
export async function listVaultItemsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const vaultId = event.pathParameters?.vaultId;

  let querySql;
  let params;

  if (vaultId) {
    // Verify user owns vault or vault is shared
    const vaultCheck = await db.query(
      'SELECT vault_id FROM vaults WHERE vault_id = $1 AND user_id = $2',
      [vaultId, user.user_id]
    );
    if (vaultCheck.rows.length === 0) {
      return jsonResponse(404, {
        status: 'fail',
        error: 'VAULT_NOT_FOUND',
        message: 'Vault not found or access denied',
      });
    }

    querySql = `
      SELECT item_id, vault_id, user_id, item_type, encrypted_data, metadata, version, created_at, updated_at
      FROM vault_items
      WHERE vault_id = $1
      ORDER BY updated_at DESC
    `;
    params = [vaultId];
  } else {
    // Return all items belonging to user across all vaults
    querySql = `
      SELECT item_id, vault_id, user_id, item_type, encrypted_data, metadata, version, created_at, updated_at
      FROM vault_items
      WHERE user_id = $1
      ORDER BY updated_at DESC
    `;
    params = [user.user_id];
  }

  const result = await db.query(querySql, params);

  return jsonResponse(200, {
    status: 'success',
    data: result.rows,
  });
}

/**
 * GET /api/v1/vaults/{vaultId}/items/{itemId} (or /api/v1/items/{itemId}) - Get single item
 */
export async function getVaultItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const itemId = event.pathParameters?.itemId;

  if (!itemId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'itemId parameter is required',
    });
  }

  // Fetch item
  const itemResult = await db.query(
    'SELECT * FROM vault_items WHERE item_id = $1',
    [itemId]
  );

  if (itemResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'ITEM_NOT_FOUND',
      message: 'Vault item not found',
    });
  }

  const item = itemResult.rows[0];

  // Access check: owner, share recipient, or member of a collection containing the item
  if (item.user_id !== user.user_id) {
    const shareCheck = await db.query(
      'SELECT share_id, permission_level, encrypted_key_for_recipient FROM share_permissions WHERE item_id = $1 AND shared_with_user_id = $2',
      [itemId, user.user_id]
    );
    const collectionPermission = await permissionOnItemViaCollections(db, user, itemId);
    if (collectionPermission) item.collection_permission = collectionPermission;

    if (shareCheck.rows.length === 0 && !collectionPermission) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'You do not have permission to view this item',
      });
    }

    if (shareCheck.rows.length) item.share_info = shareCheck.rows[0];
  }

  return jsonResponse(200, {
    status: 'success',
    data: item,
  });
}

// ============================================================================
// UC-4: Add Vault Item
// ============================================================================
export async function createVaultItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const body = parseBody(event);
  let vaultId = event.pathParameters?.vaultId || body.vault_id || body.vaultId;

  // If vaultId is not provided, resolve or create user's default vault
  if (!vaultId) {
    const defaultVault = await db.query(
      'SELECT vault_id FROM vaults WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
      [user.user_id]
    );
    if (defaultVault.rows.length > 0) {
      vaultId = defaultVault.rows[0].vault_id;
    } else {
      const created = await db.query(
        'INSERT INTO vaults (user_id, name) VALUES ($1, $2) RETURNING vault_id',
        [user.user_id, 'Personal Vault']
      );
      vaultId = created.rows[0].vault_id;
    }
  }

  // Verify user owns vault
  const vaultCheck = await db.query(
    'SELECT vault_id FROM vaults WHERE vault_id = $1 AND user_id = $2',
    [vaultId, user.user_id]
  );
  if (vaultCheck.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'VAULT_NOT_FOUND',
      message: 'Vault not found or does not belong to authenticated user',
    });
  }

  // Enforce Zero-Knowledge payload validation
  const encryptedData = body.encrypted_data || body.encryptedData;
  const payloadValidation = validateEncryptedPayload(encryptedData);
  if (!payloadValidation.valid) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'INVALID_ENCRYPTED_PAYLOAD',
      message: payloadValidation.error,
    });
  }

  const normalizedEncrypted = normalizeEncryptedData(encryptedData);
  const metadataCheck = sanitizeMetadata(body.metadata);
  if (metadataCheck.error) return jsonResponse(400, { status: 'fail', ...metadataCheck.error });
  const metadata = metadataCheck.value;
  const itemType = body.item_type || body.itemType || 'login';

  // Insert vault item
  const insertResult = await db.query(
    `INSERT INTO vault_items (
      vault_id, user_id, item_type, encrypted_data, metadata, version
    ) VALUES ($1, $2, $3, $4, $5, 1)
    RETURNING item_id, vault_id, item_type, version, created_at, updated_at`,
    [vaultId, user.user_id, itemType, normalizedEncrypted, metadata]
  );

  const newItem = insertResult.rows[0];

  // Log user activity
  const clientIp = event.requestContext?.http?.sourceIp || '127.0.0.1';
  const userAgent = event.headers?.['user-agent'] || 'client';

  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, target_item_id, ip_address, user_agent, details)
     VALUES ($1, 'PASSWORD_CREATE', $2, $3, $4, $5)`,
    [user.user_id, newItem.item_id, clientIp, userAgent, { item_type: itemType }]
  );

  return jsonResponse(201, {
    status: 'success',
    message: 'Vault item created successfully',
    data: {
      item_id: newItem.item_id,
      vault_id: newItem.vault_id,
      version: newItem.version,
      created_at: newItem.created_at,
    },
  });
}

// ============================================================================
// UC-5: Update Vault Item
// ============================================================================
export async function updateVaultItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const body = parseBody(event);
  const itemId = event.pathParameters?.itemId;

  if (!itemId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'itemId parameter is required',
    });
  }

  // Check item exists
  const existingResult = await db.query(
    'SELECT * FROM vault_items WHERE item_id = $1',
    [itemId]
  );

  if (existingResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'ITEM_NOT_FOUND',
      message: 'Vault item not found',
    });
  }

  const existingItem = existingResult.rows[0];

  // Authorization: owner, 'modify' share, or 'write' on a collection containing the item
  const isOwner = existingItem.user_id === user.user_id;
  let viaCollection = false;
  if (!isOwner) {
    const shareCheck = await db.query(
      `SELECT permission_level FROM share_permissions
       WHERE item_id = $1 AND shared_with_user_id = $2`,
      [itemId, user.user_id]
    );
    const canModifyViaShare = shareCheck.rows.length > 0 && shareCheck.rows[0].permission_level === 'modify';
    viaCollection = !canModifyViaShare && hasRequiredPermission(await permissionOnItemViaCollections(db, user, itemId), 'write');

    if (!canModifyViaShare && !viaCollection) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'You do not have modify permission for this item',
      });
    }
  }

  // Optimistic concurrency check if client passed version/currentVersion
  const currentVersion = body.version || body.currentVersion;
  if (currentVersion !== undefined && currentVersion !== existingItem.version) {
    return jsonResponse(409, {
      status: 'fail',
      error: 'ITEM_CONCURRENTLY_MODIFIED',
      message: `Conflict: item was updated by another session (expected version ${existingItem.version}, got ${currentVersion})`,
    });
  }

  // Validate new encrypted payload
  const encryptedData = body.encrypted_data || body.encryptedData;
  if (encryptedData) {
    const payloadValidation = validateEncryptedPayload(encryptedData);
    if (!payloadValidation.valid) {
      return jsonResponse(400, {
        status: 'fail',
        error: 'INVALID_ENCRYPTED_PAYLOAD',
        message: payloadValidation.error,
      });
    }
  }

  const newEncryptedData = encryptedData
    ? normalizeEncryptedData(encryptedData)
    : existingItem.encrypted_data;
  let newMetadata = existingItem.metadata;
  if (body.metadata !== undefined) {
    const metadataCheck = sanitizeMetadata(body.metadata);
    if (metadataCheck.error) return jsonResponse(400, { status: 'fail', ...metadataCheck.error });
    newMetadata = metadataCheck.value;
  }
  if (!isOwner) {
    // Only the owner decides which collection an item belongs to.
    const { collection_id: existingCollection } = existingItem.metadata || {};
    newMetadata = { ...newMetadata };
    if (existingCollection) newMetadata.collection_id = existingCollection;
    else delete newMetadata.collection_id;
  }
  const newVersion = existingItem.version + 1;

  // 1. Archive prior version snapshot into password_history table (UC-11)
  await db.query(
    `INSERT INTO password_history (
      item_id, version, encrypted_data, metadata, changed_by_user_id
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      existingItem.item_id,
      existingItem.version,
      existingItem.encrypted_data,
      existingItem.metadata,
      user.user_id,
    ]
  );

  // 2. Update vault_items record
  const updateResult = await db.query(
    `UPDATE vault_items
     SET encrypted_data = $1, metadata = $2, version = $3, updated_at = CURRENT_TIMESTAMP
     WHERE item_id = $4
     RETURNING item_id, vault_id, version, updated_at`,
    [newEncryptedData, newMetadata, newVersion, itemId]
  );

  const updatedItem = updateResult.rows[0];

  // 3. Log activity
  const clientIp = event.requestContext?.http?.sourceIp || '127.0.0.1';
  const userAgent = event.headers?.['user-agent'] || 'client';

  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, target_item_id, ip_address, user_agent, details)
     VALUES ($1, 'PASSWORD_UPDATE', $2, $3, $4, $5)`,
    [user.user_id, itemId, clientIp, userAgent, { version: newVersion }]
  );

  return jsonResponse(200, {
    status: 'success',
    message: 'Vault item updated successfully',
    data: {
      item_id: updatedItem.item_id,
      version: updatedItem.version,
      updated_at: updatedItem.updated_at,
    },
  });
}

// ============================================================================
// UC-6: Delete Vault Item
// ============================================================================
export async function deleteVaultItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const itemId = event.pathParameters?.itemId;

  if (!itemId) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'itemId parameter is required',
    });
  }

  // Check item exists
  const itemResult = await db.query(
    'SELECT item_id, user_id, metadata FROM vault_items WHERE item_id = $1',
    [itemId]
  );

  if (itemResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'ITEM_NOT_FOUND',
      message: 'Vault item not found',
    });
  }

  const item = itemResult.rows[0];

  // Only the item owner can delete the item
  if (item.user_id !== user.user_id) {
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Only the item owner has permission to delete this item',
    });
  }

  // Delete item — Foreign key CASCADE cleans up password_history and share_permissions
  await db.query('DELETE FROM vault_items WHERE item_id = $1', [itemId]);

  // Log user activity and admin audit
  const clientIp = event.requestContext?.http?.sourceIp || '127.0.0.1';

  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, ip_address, details)
     VALUES ($1, 'PASSWORD_DELETE', $2, $3)`,
    [user.user_id, clientIp, { item_id: itemId }]
  );

  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, status, details)
     VALUES ($1, $2, 'PASSWORD_DELETE', 'WARNING', 'vault_items', $3, $4, 'SUCCESS', $5)`,
    [user.user_id, user.role, itemId, clientIp, { item_id: itemId }]
  );

  return jsonResponse(200, {
    status: 'success',
    message: 'Vault item deleted successfully',
    data: {
      item_id: itemId,
    },
  });
}
