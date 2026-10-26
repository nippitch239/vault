/**
 * Secure Vault Cloud — Idempotent Personal Default Organization Migration (Milestone M1)
 *
 * Automatically provisions a personal default organization for each registered user
 * who does not already own an organization, and backfills standalone groups and
 * collections (org_id IS NULL) to that organization.
 *
 * Guarantees:
 * 1. 100% Idempotent: Can be run multiple times safely.
 * 2. Dual-Engine: Fully compatible with PostgreSQL (RDS) and SQLite (local/test).
 * 3. Zero-Knowledge: encrypted_org_key is left NULL; server never handles or invents keys.
 */

import crypto from 'node:crypto';

/**
 * Executes the personal organization migration and standalone resource backfill.
 *
 * @param {object} db - Database adapter instance (PostgreSQL or SqliteDatabase)
 * @returns {Promise<{
 *   createdOrgs: number,
 *   orgsCreated: number,
 *   backfilledGroups: number,
 *   groupsLinked: number,
 *   backfilledCollections: number,
 *   collectionsLinked: number,
 *   durationMs: number
 * }>}
 */
export async function migratePersonalOrganizations(db) {
  const startTime = Date.now();
  let createdOrgs = 0;
  let backfilledGroups = 0;
  let backfilledCollections = 0;

  const runner = typeof db.transaction === 'function'
    ? (fn) => db.transaction(fn)
    : (fn) => fn(db);

  await runner(async (tx) => {
    // 1. Fetch all registered users in chronological order
    const usersRes = await tx.query(
      'SELECT user_id, username, full_name FROM users ORDER BY created_at ASC'
    );
    const users = usersRes?.rows || [];

    for (const user of users) {
      // 2. Check if user already owns an organization.
      // Prioritize existing 'Default personal organization', then oldest owned organization.
      const existingRes = await tx.query(
        `SELECT om.org_id
         FROM organization_members om
         JOIN organizations o ON o.org_id = om.org_id
         WHERE om.user_id = $1 AND om.role = 'owner'
         ORDER BY CASE WHEN o.description = 'Default personal organization' THEN 0 ELSE 1 END, o.created_at ASC
         LIMIT 1`,
        [user.user_id]
      );

      let orgId = existingRes?.rows?.[0]?.org_id;

      // 3. Create default personal organization if none exists
      if (!orgId) {
        orgId = crypto.randomUUID();
        const memberId = crypto.randomUUID();
        const now = new Date().toISOString();

        const rawName = user.full_name && typeof user.full_name === 'string' ? user.full_name.trim() : '';
        const displayName = rawName || user.username;
        const orgName = `${displayName}'s Personal Organization`;

        await tx.query(
          `INSERT INTO organizations (org_id, name, description, created_by, status, created_at, updated_at)
           VALUES ($1, $2, 'Default personal organization', $3, 'active', $4, $5)`,
          [orgId, orgName, user.user_id, now, now]
        );

        await tx.query(
          `INSERT INTO organization_members (org_member_id, org_id, user_id, role, status, encrypted_org_key, created_at, updated_at)
           VALUES ($1, $2, $3, 'owner', 'confirmed', NULL, $4, $5)`,
          [memberId, orgId, user.user_id, now, now]
        );

        createdOrgs++;
      }

      // 4. Backfill standalone groups created by this user
      const groupUpdateRes = await tx.query(
        `UPDATE groups
         SET org_id = $1
         WHERE created_by = $2 AND org_id IS NULL`,
        [orgId, user.user_id]
      );
      backfilledGroups += groupUpdateRes?.rowCount || 0;

      // 5. Backfill standalone collections created by this user
      const colUpdateRes = await tx.query(
        `UPDATE collections
         SET org_id = $1
         WHERE created_by = $2 AND org_id IS NULL`,
        [orgId, user.user_id]
      );
      backfilledCollections += colUpdateRes?.rowCount || 0;
    }
  });

  const durationMs = Date.now() - startTime;
  return {
    createdOrgs,
    orgsCreated: createdOrgs,
    backfilledGroups,
    groupsLinked: backfilledGroups,
    backfilledCollections,
    collectionsLinked: backfilledCollections,
    durationMs,
  };
}

export const migrateDefaultOrganizations = migratePersonalOrganizations;

export default migratePersonalOrganizations;
