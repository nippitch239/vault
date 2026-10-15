/**
 * Collections — database layer. Parameterized SQL only; every function takes the db
 * (or a transaction handle) as the first argument so the service decides transactions.
 */

import crypto from 'node:crypto';

const now = () => new Date().toISOString();

// --- collections -----------------------------------------------------------

export async function findCollection(db, collectionId) {
  const res = await db.query('SELECT * FROM collections WHERE collection_id = $1', [collectionId]);
  return res.rows[0] || null;
}

export async function listAllCollections(db) {
  const res = await db.query('SELECT * FROM collections ORDER BY created_at DESC');
  return res.rows;
}

export async function insertCollection(db, { name, description, createdBy }) {
  const row = {
    collection_id: crypto.randomUUID(),
    name,
    description,
    created_by: createdBy,
    created_at: now(),
  };
  row.updated_at = row.created_at;
  await db.query(
    'INSERT INTO collections (collection_id, name, description, created_by, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)',
    [row.collection_id, row.name, row.description, row.created_by, row.created_at, row.updated_at]
  );
  return row;
}

export async function updateCollection(db, collectionId, { name, description }) {
  await db.query('UPDATE collections SET name = $1, description = $2, updated_at = $3 WHERE collection_id = $4', [
    name,
    description,
    now(),
    collectionId,
  ]);
  return findCollection(db, collectionId);
}

export async function deleteCollection(db, collectionId) {
  await db.query('DELETE FROM collection_keys WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_items WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collection_access WHERE collection_id = $1', [collectionId]);
  await db.query('DELETE FROM collections WHERE collection_id = $1', [collectionId]);
}

// --- access grants -----------------------------------------------------------

export async function listAccess(db, collectionId) {
  const res = await db.query('SELECT * FROM collection_access WHERE collection_id = $1 ORDER BY created_at ASC', [collectionId]);
  return res.rows;
}

export async function findAccess(db, collectionId, targetType, targetId) {
  const res = await db.query(
    'SELECT * FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3',
    [collectionId, targetType, targetId]
  );
  return res.rows[0] || null;
}

export async function upsertAccess(db, { collectionId, targetType, targetId, permission }) {
  const ts = now();
  await db.query(
    `INSERT INTO collection_access (access_id, collection_id, target_type, target_id, permission, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(collection_id, target_type, target_id)
     DO UPDATE SET permission = excluded.permission, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), collectionId, targetType, targetId, permission, ts, ts]
  );
}

export async function deleteAccess(db, collectionId, targetType, targetId) {
  await db.query('DELETE FROM collection_access WHERE collection_id = $1 AND target_type = $2 AND target_id = $3', [
    collectionId,
    targetType,
    targetId,
  ]);
}

export async function listGroupGrantCollectionIds(db, groupId) {
  const res = await db.query("SELECT collection_id FROM collection_access WHERE target_type = 'group' AND target_id = $1", [groupId]);
  return res.rows.map((r) => r.collection_id);
}

// --- wrapped keys -------------------------------------------------------------

export async function findKey(db, collectionId, userId) {
  const res = await db.query('SELECT * FROM collection_keys WHERE collection_id = $1 AND user_id = $2', [collectionId, userId]);
  return res.rows[0] || null;
}

export async function upsertKey(db, { collectionId, userId, wrappedKey }) {
  const ts = now();
  await db.query(
    `INSERT INTO collection_keys (key_id, collection_id, user_id, encrypted_key_for_recipient, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(collection_id, user_id)
     DO UPDATE SET encrypted_key_for_recipient = excluded.encrypted_key_for_recipient, updated_at = excluded.updated_at`,
    [crypto.randomUUID(), collectionId, userId, wrappedKey, ts, ts]
  );
}

export async function listKeyHolders(db, collectionId) {
  const res = await db.query('SELECT user_id FROM collection_keys WHERE collection_id = $1', [collectionId]);
  return res.rows.map((r) => r.user_id);
}

export async function deleteKey(db, collectionId, userId) {
  await db.query('DELETE FROM collection_keys WHERE collection_id = $1 AND user_id = $2', [collectionId, userId]);
}

// --- item links ----------------------------------------------------------------

export async function findVaultItemOwner(db, itemId) {
  const res = await db.query('SELECT item_id, user_id FROM vault_items WHERE item_id = $1', [itemId]);
  return res.rows[0] || null;
}

export async function findItemLink(db, collectionId, itemId) {
  const res = await db.query('SELECT * FROM collection_items WHERE collection_id = $1 AND item_id = $2', [collectionId, itemId]);
  return res.rows[0] || null;
}

export async function insertItemLink(db, collectionId, itemId) {
  const row = { collection_item_id: crypto.randomUUID(), collection_id: collectionId, item_id: itemId, created_at: now() };
  await db.query('INSERT INTO collection_items (collection_item_id, collection_id, item_id, created_at) VALUES ($1, $2, $3, $4)', [
    row.collection_item_id,
    row.collection_id,
    row.item_id,
    row.created_at,
  ]);
  return row;
}

export async function deleteItemLink(db, collectionId, itemId) {
  await db.query('DELETE FROM collection_items WHERE collection_id = $1 AND item_id = $2', [collectionId, itemId]);
}

export async function listCollectionVaultItems(db, collectionId) {
  const res = await db.query(
    `SELECT vi.* FROM vault_items vi
     JOIN collection_items ci ON vi.item_id = ci.item_id
     WHERE ci.collection_id = $1
     ORDER BY vi.created_at DESC`,
    [collectionId]
  );
  return res.rows;
}

// --- misc ------------------------------------------------------------------------

export async function userExists(db, userId) {
  const res = await db.query('SELECT user_id FROM users WHERE user_id = $1', [userId]);
  return res.rows.length > 0;
}

export async function groupExists(db, groupId) {
  const res = await db.query('SELECT group_id FROM groups WHERE group_id = $1', [groupId]);
  return res.rows.length > 0;
}

export async function insertAuditLog(db, { actorUserId, actorRole, action, collectionId, details = {}, ipAddress = '0.0.0.0' }) {
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, status, details)
     VALUES ($1, $2, $3, 'INFO', 'collection', $4, $5, 'SUCCESS', $6)`,
    [actorUserId, actorRole || 'user', action, collectionId, ipAddress, details]
  );
}
