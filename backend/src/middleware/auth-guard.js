/**
 * Secure Vault Cloud — Authentication & RBAC Middleware
 *
 * Authentication is done by Amazon Cognito. API Gateway (REST API, Cognito User Pool
 * authorizer) validates the ID token and forwards its claims in
 * requestContext.authorizer.claims; the router normalizes them to
 * requestContext.authorizer.jwt.claims. This module never verifies tokens itself — a
 * request that reaches the Lambda without claims is rejected with 401.
 *
 * Roles: membership of the Cognito group named by ADMIN_GROUP (default "admin") => 'admin'.
 */

import { unauthorized, forbidden } from '../http/response.js';

export const ADMIN_GROUP = process.env.COGNITO_ADMIN_GROUP || 'admin';

/**
 * Cognito group claims arrive as an array (HTTP API / local runner), a JSON-ish string
 * "[admin users]" or a comma separated string "admin,users" (REST API authorizer).
 */
export function parseGroups(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.map(String);
  return String(raw)
    .replace(/^\[|\]$/g, '')
    .split(/[\s,]+/)
    .map((g) => g.trim())
    .filter(Boolean);
}

export function getClaims(event) {
  const rc = event?.requestContext;
  return rc?.authorizer?.jwt?.claims || rc?.authorizer?.claims || null;
}

export function userFromClaims(claims) {
  const groups = parseGroups(claims['cognito:groups']);
  return {
    user_id: claims.sub,
    email: claims.email ? String(claims.email).toLowerCase() : undefined,
    email_verified: claims.email_verified === true || claims.email_verified === 'true',
    username: claims['cognito:username'] || claims.username || claims.preferred_username,
    full_name: claims.name,
    role: groups.includes(ADMIN_GROUP) ? 'admin' : 'user',
    groups,
  };
}

/**
 * @param {object} event normalized API Gateway event
 * @param {'user'|'admin'} [requiredRole='user']
 * @returns {{ user: object|null, errorResponse: object|null }}
 */
export function authenticate(event, requiredRole = 'user') {
  const claims = getClaims(event);
  if (!claims || !claims.sub) {
    return { user: null, errorResponse: unauthorized('Missing or invalid Cognito credentials') };
  }
  if (claims.token_use && claims.token_use !== 'id') {
    return { user: null, errorResponse: unauthorized('An ID token is required', 'INVALID_TOKEN_USE') };
  }

  const user = userFromClaims(claims);
  user.source_ip = event?.requestContext?.http?.sourceIp || '0.0.0.0';
  if (requiredRole === 'admin' && user.role !== 'admin') {
    return { user: null, errorResponse: forbidden('Admin privileges required to access this resource') };
  }
  return { user, errorResponse: null };
}

// ============================================================================
// Bitwarden-style Collections & Groups RBAC Inheritance Guard (M2/M3)
// ============================================================================

export const PERMISSION_RANKS = Object.freeze({
  read: 1,
  write: 2,
  admin: 3,
});

export const RANK_NAMES = Object.freeze({
  1: 'read',
  2: 'write',
  3: 'admin',
});

/**
 * Checks whether an effective permission satisfies a minimum required permission level.
 *
 * @param {'read'|'write'|'admin'|null} effectivePermission
 * @param {'read'|'write'|'admin'} [minRequiredPermission='read']
 * @returns {boolean}
 */
export function hasRequiredPermission(effectivePermission, minRequiredPermission = 'read') {
  if (!effectivePermission) return false;
  const currentRank = PERMISSION_RANKS[String(effectivePermission).toLowerCase()] || 0;
  const targetRank = PERMISSION_RANKS[String(minRequiredPermission).toLowerCase()] || 0;
  return currentRank >= targetRank && currentRank > 0;
}

export function hasPermissionLevel(actualPerm, requiredPerm) {
  return hasRequiredPermission(actualPerm, requiredPerm);
}

/**
 * Resolves the effective permission for a user on a given collection.
 * Evaluates:
 * 1. System administrator bypass (user.role === 'admin' -> 'admin')
 * 2. Collection creator bypass (collection.created_by === userId -> 'admin')
 * 3. Supremum across direct user grants and inherited group memberships
 * 4. Fallback to null (Access Denied / Forbidden)
 *
 * @param {object} db - Database adapter instance
 * @param {string} collectionId - Target collection UUID
 * @param {object|string} user - Authenticated user entity or user ID string
 * @param {string|null} [optionalRole=null] - Optional role override when user is passed as ID string
 * @returns {Promise<'read'|'write'|'admin'|null>}
 */
export async function getEffectiveCollectionPermission(db, collectionId, user, optionalRole = null) {
  if (!db || !collectionId || !user) {
    return null;
  }

  const userId = typeof user === 'string' ? user : (user.user_id || user.id || user.sub);
  const userRole = String(
    optionalRole || (typeof user === 'object' ? user.role : null) || 'user'
  ).toLowerCase();

  // 1. System Admin Bypass
  if (userRole === 'admin') {
    const collRes = await db.query(
      'SELECT collection_id FROM collections WHERE collection_id = $1',
      [collectionId]
    );
    return collRes.rows && collRes.rows.length > 0 ? 'admin' : null;
  }

  // 2. Atomic Single-Query Evaluation (Creator + Direct User Grant + Inherited Group Grants)
  const query = `
    WITH target_collection AS (
      SELECT collection_id, created_by
      FROM collections
      WHERE collection_id = $1
    ),
    user_groups AS (
      SELECT group_id
      FROM group_members
      WHERE user_id = $2
    ),
    matching_grants AS (
      SELECT permission
      FROM collection_access
      WHERE collection_id = $1
        AND target_type = 'user'
        AND target_id = $2
      UNION ALL
      SELECT ca.permission
      FROM collection_access ca
      INNER JOIN user_groups ug ON ca.target_id = ug.group_id
      WHERE ca.collection_id = $1
        AND ca.target_type = 'group'
    ),
    ranked_grants AS (
      SELECT MAX(
        CASE LOWER(permission)
          WHEN 'admin' THEN 3
          WHEN 'write' THEN 2
          WHEN 'read' THEN 1
          ELSE 0
        END
      ) AS max_rank
      FROM matching_grants
    )
    SELECT
      tc.collection_id,
      tc.created_by,
      rg.max_rank,
      CASE
        WHEN tc.created_by = $2 THEN 'admin'
        WHEN rg.max_rank = 3 THEN 'admin'
        WHEN rg.max_rank = 2 THEN 'write'
        WHEN rg.max_rank = 1 THEN 'read'
        ELSE NULL
      END AS effective_permission
    FROM target_collection tc
    CROSS JOIN ranked_grants rg;
  `;

  const result = await db.query(query, [collectionId, userId]);
  if (!result.rows || result.rows.length === 0) {
    return null; // Collection does not exist
  }

  return result.rows[0].effective_permission || null;
}

/**
 * Enforces collection-level authorization guard on incoming API requests.
 * Returns standard error response if collection is not found (404) or
 * if effective permission is below the required threshold (403).
 *
 * @param {object} db - Database adapter
 * @param {string} collectionId - Target collection ID
 * @param {object} user - Authenticated user entity
 * @param {'read'|'write'|'admin'} [requiredPermission='read']
 * @returns {Promise<{ collection: object|null, permission: string|null, errorResponse: object|null }>}
 */
export async function requireCollectionPermission(
  db,
  collectionId,
  user,
  requiredPermission = 'read'
) {
  const colRes = await db.query(
    'SELECT * FROM collections WHERE collection_id = $1',
    [collectionId]
  );

  if (!colRes.rows || colRes.rows.length === 0) {
    return {
      collection: null,
      permission: null,
      errorResponse: {
        statusCode: 404,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'fail',
          error: 'NOT_FOUND',
          message: 'Collection not found',
        }),
      },
    };
  }

  const collection = colRes.rows[0];
  const permission = await getEffectiveCollectionPermission(db, collectionId, user);

  if (!permission || !hasRequiredPermission(permission, requiredPermission)) {
    return {
      collection,
      permission,
      errorResponse: {
        statusCode: 403,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'fail',
          error: 'FORBIDDEN',
          message: `Insufficient permissions for collection. Required: ${requiredPermission}`,
        }),
      },
    };
  }

  return { collection, permission, errorResponse: null };
}
