/**
 * Secure Vault Cloud — Password Sharing Handlers (UC-10)
 *
 * Implements:
 * 1. Granular Password Sharing (READ / MODIFY) via asymmetric key wrapping.
 * 2. Recipient lookup (by username, limited to people in the caller's groups) to obtain the
 *    public key for client-side key wrapping.
 * 3. List items shared with current user.
 * 4. Revoke share permission.
 *
 * Zero-Knowledge Guarantee: The server never unwraps item keys or decrypts shared items.
 * Every item has its own random Item Key; sharing hands the recipient that Item Key wrapped
 * with their RSA-OAEP public key (done on the client).
 */

import { getDatabase } from '../db/adapter.js';
import { authenticate } from '../middleware/auth-guard.js';
import { isUuid, isWrappedKey } from '../http/validate.js';
import { findVisibleUserById, findVisibleUserByUsername, normalizeUsername } from '../services/user-directory.js';

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

function clientIp(event) {
  return event.requestContext?.identity?.sourceIp || event.requestContext?.http?.sourceIp || '0.0.0.0';
}

/**
 * GET /api/v1/users/lookup?username=...
 * Finds a user (and their public key) by username. Only users who share a group with the
 * caller are visible; everyone else gets the same 404 so accounts cannot be enumerated.
 */
export async function lookupUserHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const username = normalizeUsername(event.queryStringParameters?.username);
  if (!username) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'Query parameter username is required',
    });
  }

  const found = await findVisibleUserByUsername(getDatabase(), user.user_id, username);
  if (!found) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'RECIPIENT_USER_NOT_FOUND',
      message: 'No user with this username in your groups',
    });
  }

  return jsonResponse(200, {
    status: 'success',
    data: {
      user_id: found.user_id,
      username: found.username,
      full_name: found.full_name,
      public_key: found.public_key,
    },
  });
}

/**
 * POST /api/v1/vaults/{vaultId}/items/{itemId}/share (or /api/v1/items/{itemId}/share)
 * Shares an item: the owner sends the item's Item Key wrapped with the recipient's public key.
 * Recipients must share a group with the owner (same rule as lookup).
 */
export async function shareItemHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const body = parseBody(event);
  const itemId = event.pathParameters?.itemId || body.item_id || body.itemId;

  if (!isUuid(itemId)) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'itemId must be a valid UUID',
    });
  }

  // Verify item exists and caller is the owner
  const itemResult = await db.query(
    'SELECT item_id, user_id, encrypted_item_key FROM vault_items WHERE item_id = $1',
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
    return jsonResponse(403, {
      status: 'fail',
      error: 'FORBIDDEN',
      message: 'Only the item owner can share this password',
    });
  }

  // Items saved before per-item keys are encrypted with the owner's Vault Key, which must
  // never be shared. The client re-saves such an item with an Item Key first.
  if (!item.encrypted_item_key) {
    return jsonResponse(409, {
      status: 'fail',
      error: 'ITEM_KEY_REQUIRED',
      message: 'Save the item again so it gets its own item key before sharing it',
    });
  }

  // Recipient resolution (must share a group with the owner)
  const recipientUserId = body.recipient_user_id || body.recipientUserId;
  const recipientUsername = body.recipient_username || body.recipientUsername;
  let recipientUser = null;
  if (isUuid(recipientUserId)) {
    recipientUser = await findVisibleUserById(db, user.user_id, recipientUserId);
  } else if (recipientUsername) {
    recipientUser = await findVisibleUserByUsername(db, user.user_id, recipientUsername);
  }

  if (!recipientUser) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'RECIPIENT_USER_NOT_FOUND',
      message: 'Recipient not found in your groups',
    });
  }

  // Cannot share with self
  if (recipientUser.user_id === user.user_id) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'CANNOT_SHARE_WITH_SELF',
      message: 'Cannot share password with yourself',
    });
  }

  // Validate permission level ('read' or 'modify')
  const permissionLevel = String(body.permission_level || body.permission || 'read').toLowerCase();
  if (permissionLevel !== 'read' && permissionLevel !== 'modify') {
    return jsonResponse(400, {
      status: 'fail',
      error: 'INVALID_PERMISSION_LEVEL',
      message: "Permission level must be 'read' or 'modify'",
    });
  }

  // Validate recipient-wrapped Item Key
  const encryptedKey = body.encrypted_key_for_recipient || body.encryptedKeyForRecipient;
  if (!isWrappedKey(encryptedKey)) {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_WRAPPED_KEY',
      message: 'encrypted_key_for_recipient must be the Item Key wrapped with the recipient public key ({ ciphertext })',
    });
  }

  const shareId = await db.transaction(async (tx) => {
    const existingShare = await tx.query(
      'SELECT share_id FROM share_permissions WHERE item_id = $1 AND shared_with_user_id = $2',
      [itemId, recipientUser.user_id]
    );
    let id;
    if (existingShare.rows.length > 0) {
      id = existingShare.rows[0].share_id;
      await tx.query(
        `UPDATE share_permissions
         SET permission_level = $1, encrypted_key_for_recipient = $2, updated_at = CURRENT_TIMESTAMP
         WHERE share_id = $3`,
        [permissionLevel, encryptedKey, id]
      );
    } else {
      const insertResult = await tx.query(
        `INSERT INTO share_permissions (
          item_id, shared_by_user_id, shared_with_user_id, permission_level, encrypted_key_for_recipient
        ) VALUES ($1, $2, $3, $4, $5)
        RETURNING share_id`,
        [itemId, user.user_id, recipientUser.user_id, permissionLevel, encryptedKey]
      );
      id = insertResult.rows[0].share_id;
    }

    await tx.query(
      `INSERT INTO activity_logs (user_id, action_type, target_item_id, ip_address, details)
       VALUES ($1, 'PASSWORD_SHARE', $2, $3, $4)`,
      [user.user_id, itemId, clientIp(event), { recipient_username: recipientUser.username, permission_level: permissionLevel }]
    );
    return id;
  });

  return jsonResponse(201, {
    status: 'success',
    message: `Item shared successfully with ${recipientUser.username}`,
    data: {
      share_id: shareId,
      permission_level: permissionLevel,
      recipient_user_id: recipientUser.user_id,
      recipient_username: recipientUser.username,
    },
  });
}

/**
 * GET /api/v1/shared-items
 * List all items shared with the authenticated user
 */
export async function listSharedItemsHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();

  const querySql = `
    SELECT
      sp.share_id,
      sp.permission_level,
      sp.encrypted_key_for_recipient,
      sp.created_at as shared_at,
      vi.item_id,
      vi.vault_id,
      vi.user_id,
      vi.item_type,
      vi.encrypted_data,
      vi.metadata,
      vi.version,
      u.email as shared_by_email,
      u.username as shared_by_username,
      u.full_name as shared_by_name
    FROM share_permissions sp
    JOIN vault_items vi ON sp.item_id = vi.item_id
    JOIN users u ON sp.shared_by_user_id = u.user_id
    WHERE sp.shared_with_user_id = $1
    ORDER BY sp.created_at DESC
  `;

  const result = await db.query(querySql, [user.user_id]);

  return jsonResponse(200, {
    status: 'success',
    data: result.rows,
  });
}

/**
 * DELETE /api/v1/vaults/{vaultId}/items/{itemId}/share/{userId} (or /api/v1/shares/{shareId})
 * Revoke item share permission
 */
export async function revokeShareHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const shareId = event.pathParameters?.shareId;
  const itemId = event.pathParameters?.itemId;
  const recipientUserId = event.pathParameters?.userId;

  let querySql;
  let params;

  if (shareId) {
    // Check caller is either shared_by owner or shared_with recipient
    querySql = `
      DELETE FROM share_permissions
      WHERE share_id = $1 AND (shared_by_user_id = $2 OR shared_with_user_id = $2)
      RETURNING share_id, item_id
    `;
    params = [shareId, user.user_id];
  } else if (itemId && recipientUserId) {
    // Check caller is owner of item or shared_by
    querySql = `
      DELETE FROM share_permissions
      WHERE item_id = $1 AND shared_with_user_id = $2 AND shared_by_user_id = $3
      RETURNING share_id, item_id
    `;
    params = [itemId, recipientUserId, user.user_id];
  } else {
    return jsonResponse(400, {
      status: 'fail',
      error: 'MISSING_PARAM',
      message: 'Invalid share revocation route parameters',
    });
  }

  const deleteResult = await db.query(querySql, params);

  if (deleteResult.rows.length === 0) {
    return jsonResponse(404, {
      status: 'fail',
      error: 'SHARE_NOT_FOUND',
      message: 'Share permission not found or you do not have authorization to revoke it',
    });
  }

  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, ip_address, details)
     VALUES ($1, 'PASSWORD_SHARE_REVOKED', $2, $3)`,
    [user.user_id, clientIp(event), { share_id: deleteResult.rows[0].share_id, item_id: deleteResult.rows[0].item_id }]
  );

  return jsonResponse(200, {
    status: 'success',
    message: 'Share permission revoked successfully',
    data: {
      share_id: deleteResult.rows[0].share_id,
    },
  });
}
