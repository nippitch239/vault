/**
 * Secure Vault Cloud — Password Version History Handlers (UC-11)
 *
 * Implements:
 * 1. View revision history snapshots for a vault item.
 * 2. Restore/Rollback to a historical encrypted snapshot.
 *
 * Zero-Knowledge Guarantee: Historical versions retain full AES-256-GCM encryption.
 * The server never observes plaintext across revisions.
 */

import { getDatabase } from '../db/adapter.js';
import { getClientIp } from '../request-context.js';
import { authenticate } from '../middleware/auth-guard.js';

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
 * GET /api/v1/vaults/{vaultId}/items/{itemId}/history (or /api/v1/items/{itemId}/history)
 * Retrieve all historical revisions for a vault item
 */
export async function getHistoryHandler(event) {
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

  // Check item exists and caller has read access (owner or share recipient)
  const itemResult = await db.query(
    'SELECT item_id, user_id FROM vault_items WHERE item_id = $1',
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
  if (item.user_id !== user.user_id) {
    const shareCheck = await db.query(
      'SELECT share_id FROM share_permissions WHERE item_id = $1 AND shared_with_user_id = $2',
      [itemId, user.user_id]
    );
    if (shareCheck.rows.length === 0) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'You do not have access to this item history',
      });
    }
  }

  // Fetch history snapshots
  const historyResult = await db.query(
    `SELECT
      ph.history_id,
      ph.item_id,
      ph.version,
      ph.encrypted_data,
      ph.metadata,
      ph.created_at,
      u.full_name as changed_by,
      u.username as changed_by_username
     FROM password_history ph
     JOIN users u ON ph.changed_by_user_id = u.user_id
     WHERE ph.item_id = $1
     ORDER BY ph.version DESC`,
    [itemId]
  );

  return jsonResponse(200, {
    status: 'success',
    item_id: itemId,
    history: historyResult.rows,
  });
}

/**
 * POST /api/v1/vaults/{vaultId}/items/{itemId}/rollback (or restore)
 * Restores a historical snapshot to become the latest version
 */
export async function rollbackHistoryHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const body = parseBody(event);
  const itemId = event.pathParameters?.itemId;
  const targetVersion = body.version;

  if (!itemId || targetVersion === undefined) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'REQUIRED_FIELDS',
      message: 'itemId and target version are required for rollback',
    });
  }

  // Verify item exists and caller is owner or has modify permission
  const itemResult = await db.query('SELECT * FROM vault_items WHERE item_id = $1', [itemId]);
  if (itemResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'ITEM_NOT_FOUND',
      message: 'Vault item not found',
    });
  }

  const currentItem = itemResult.rows[0];
  if (currentItem.user_id !== user.user_id) {
    const shareCheck = await db.query(
      `SELECT permission_level FROM share_permissions
       WHERE item_id = $1 AND shared_with_user_id = $2 AND permission_level = 'modify'`,
      [itemId, user.user_id]
    );
    if (shareCheck.rows.length === 0) {
      return jsonResponse(403, {
        status: 'fail',
        error: 'FORBIDDEN',
        message: 'Only the item owner or authorized editor can rollback versions',
      });
    }
  }

  // Find target snapshot in history
  const historyResult = await db.query(
    'SELECT * FROM password_history WHERE item_id = $1 AND version = $2',
    [itemId, targetVersion]
  );

  if (historyResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'VERSION_NOT_FOUND',
      message: `Historical snapshot for version ${targetVersion} not found`,
    });
  }

  const targetSnapshot = historyResult.rows[0];

  // 1. Archive current version before rollback
  await db.query(
    `INSERT INTO password_history (
      item_id, version, encrypted_data, metadata, changed_by_user_id
    ) VALUES ($1, $2, $3, $4, $5)`,
    [
      currentItem.item_id,
      currentItem.version,
      currentItem.encrypted_data,
      currentItem.metadata,
      user.user_id,
    ]
  );

  // 2. Restore target payload and advance version
  const newVersion = currentItem.version + 1;
  const updateResult = await db.query(
    `UPDATE vault_items
     SET encrypted_data = $1, metadata = $2, version = $3, updated_at = CURRENT_TIMESTAMP
     WHERE item_id = $4
     RETURNING item_id, version, updated_at`,
    [targetSnapshot.encrypted_data, targetSnapshot.metadata, newVersion, itemId]
  );

  // 3. Log restore activity
  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, target_item_id, ip_address, details)
     VALUES ($1, 'PASSWORD_RESTORE', $2, $4, $3)`,
    [user.user_id, itemId, { restored_from_version: targetVersion, new_version: newVersion }, getClientIp()]
  );

  return jsonResponse(200, {
    status: 'success',
    message: `Restored successfully from version ${targetVersion}`,
    data: {
      item_id: updateResult.rows[0].item_id,
      version: updateResult.rows[0].version,
      restored_from_version: targetVersion,
    },
  });
}
