/**
 * Finding other users. A user is only visible to people they share at least one group
 * with (or to themselves), so nobody can enumerate accounts by guessing usernames.
 */

const SHARES_GROUP_SQL = `(
  u.user_id = $2 OR EXISTS (
    SELECT 1 FROM group_members mine
    JOIN group_members theirs ON theirs.group_id = mine.group_id
    WHERE mine.user_id = $2 AND theirs.user_id = u.user_id
  )
)`;

const PUBLIC_COLUMNS = 'u.user_id, u.username, u.full_name, u.public_key';

export function normalizeUsername(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

/** User with this username who shares a group with viewerId, or null. */
export async function findVisibleUserByUsername(db, viewerId, username) {
  const name = normalizeUsername(username);
  if (!name) return null;
  const res = await db.query(
    `SELECT ${PUBLIC_COLUMNS} FROM users u WHERE LOWER(u.username) = $1 AND ${SHARES_GROUP_SQL}`,
    [name, viewerId]
  );
  return res.rows[0] || null;
}

/** User with this id who shares a group with viewerId, or null. */
export async function findVisibleUserById(db, viewerId, userId) {
  const res = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users u WHERE u.user_id = $1 AND ${SHARES_GROUP_SQL}`, [
    userId,
    viewerId,
  ]);
  return res.rows[0] || null;
}

/** Any user by username (for group admins adding members), or null. */
export async function findUserByUsername(db, username) {
  const name = normalizeUsername(username);
  if (!name) return null;
  const res = await db.query(`SELECT ${PUBLIC_COLUMNS} FROM users u WHERE LOWER(u.username) = $1`, [name]);
  return res.rows[0] || null;
}
