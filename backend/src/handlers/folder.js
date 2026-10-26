/**
 * Secure Vault Cloud — Folder Handlers (Personal Vault Organization)
 *
 * Folders are personal vault organization — they are NOT access control.
 * A folder just groups items in a user's personal view. Only the owner
 * of a folder can see/use it.
 *
 * Routes:
 *   GET    /folders            listFoldersHandler
 *   POST   /folders            createFolderHandler
 *   PUT    /folders/:folderId  updateFolderHandler
 *   DELETE /folders/:folderId  deleteFolderHandler
 */

import { getDatabase } from '../db/adapter.js';
import { authenticate } from '../middleware/auth-guard.js';
import { isUuid } from '../http/validate.js';

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
 * GET /folders — list the authenticated user's folders
 */
export async function listFoldersHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const result = await db.query(
    'SELECT folder_id, name, created_at, updated_at FROM folders WHERE user_id = $1 ORDER BY name ASC',
    [user.user_id]
  );

  return jsonResponse(200, { status: 'success', data: result.rows });
}

/**
 * POST /folders — create a folder for the authenticated user
 */
export async function createFolderHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const body = parseBody(event);
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!name) {
    return jsonResponse(400, { status: 'fail', error: 'MISSING_FIELD', message: 'name is required' });
  }
  if (name.length > 255) {
    return jsonResponse(400, { status: 'fail', error: 'INVALID_FIELD', message: 'name must be 255 characters or fewer' });
  }

  const db = getDatabase();
  try {
    const result = await db.query(
      'INSERT INTO folders (user_id, name) VALUES ($1, $2) RETURNING folder_id, name, created_at, updated_at',
      [user.user_id, name]
    );
    return jsonResponse(201, { status: 'success', message: 'Folder created', data: result.rows[0] });
  } catch (err) {
    // Unique constraint violation: same user already has a folder with this name
    if (err.code === '23505') {
      return jsonResponse(409, { status: 'fail', error: 'FOLDER_NAME_CONFLICT', message: 'A folder with that name already exists' });
    }
    throw err;
  }
}

/**
 * PUT /folders/:folderId — rename a folder (owner only)
 */
export async function updateFolderHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const folderId = event.pathParameters?.folderId;
  if (!folderId || !isUuid(folderId)) {
    return jsonResponse(400, { status: 'fail', error: 'INVALID_PARAM', message: 'folderId must be a valid UUID' });
  }

  const body = parseBody(event);
  const name = typeof body.name === 'string' ? body.name.trim() : '';

  if (!name) {
    return jsonResponse(400, { status: 'fail', error: 'MISSING_FIELD', message: 'name is required' });
  }
  if (name.length > 255) {
    return jsonResponse(400, { status: 'fail', error: 'INVALID_FIELD', message: 'name must be 255 characters or fewer' });
  }

  const db = getDatabase();
  try {
    const result = await db.query(
      `UPDATE folders SET name = $1, updated_at = CURRENT_TIMESTAMP
       WHERE folder_id = $2 AND user_id = $3
       RETURNING folder_id, name, created_at, updated_at`,
      [name, folderId, user.user_id]
    );
    if (result.rows.length === 0) {
      return jsonResponse(404, { status: 'fail', error: 'FOLDER_NOT_FOUND', message: 'Folder not found' });
    }
    return jsonResponse(200, { status: 'success', message: 'Folder updated', data: result.rows[0] });
  } catch (err) {
    if (err.code === '23505') {
      return jsonResponse(409, { status: 'fail', error: 'FOLDER_NAME_CONFLICT', message: 'A folder with that name already exists' });
    }
    throw err;
  }
}

/**
 * DELETE /folders/:folderId — delete a folder (owner only)
 * Items with metadata.folder_id pointing to this folder become "no folder" automatically
 * (folder_id lives in metadata JSONB, not a FK, so no cascade is needed).
 */
export async function deleteFolderHandler(event) {
  const { user, errorResponse } = authenticate(event, 'user');
  if (errorResponse) return errorResponse;

  const folderId = event.pathParameters?.folderId;
  if (!folderId || !isUuid(folderId)) {
    return jsonResponse(400, { status: 'fail', error: 'INVALID_PARAM', message: 'folderId must be a valid UUID' });
  }

  const db = getDatabase();
  const result = await db.query(
    'DELETE FROM folders WHERE folder_id = $1 AND user_id = $2 RETURNING folder_id',
    [folderId, user.user_id]
  );

  if (result.rows.length === 0) {
    return jsonResponse(404, { status: 'fail', error: 'FOLDER_NOT_FOUND', message: 'Folder not found' });
  }

  return jsonResponse(200, { status: 'success', message: 'Folder deleted', data: { folder_id: folderId } });
}

// ponytail: no test framework, logic is simple CRUD
