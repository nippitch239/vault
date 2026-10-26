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

import { unauthorized, forbidden, notFound } from '../http/response.js';

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
  none: 0,
  read: 1,
  write: 2,
  manage: 3,
  admin: 3,
});

export const RANK_NAMES = Object.freeze({
  0: 'none',
  1: 'read',
  2: 'write',
  3: 'manage',
});

/**
 * Checks whether an effective permission satisfies a minimum required permission level.
 * Both 'manage' and 'admin' are synonyms resolving to rank 3.
 *
 * @param {'read'|'write'|'manage'|'admin'|null} effectivePermission
 * @param {'read'|'write'|'manage'|'admin'} [minRequiredPermission='read']
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
 * Resolves the effective permission and rank for a user on a given collection.
 * Evaluates:
 * 1. System administrator bypass (role === 'admin' -> 'manage', rank 3)
 * 2. Organization Owner / Admin bypass (om.role IN ('owner', 'admin') -> 'manage', rank 3)
 * 3. Collection Creator bypass (tc.created_by === userId -> 'manage', rank 3)
 * 4. Scoped direct grants and inherited group grants (MAX across valid grants)
 * 5. Cross-tenant isolation: non-members of org receive null / rank 0
 *
 * @param {object} db - Database adapter instance
 * @param {string} collectionId - Target collection UUID
 * @param {object|string} user - Authenticated user entity or user ID string
 * @param {string|null} [optionalRoleOrOrg=null] - Optional role override or orgId
 * @returns {Promise<{ permission: 'read'|'write'|'manage'|null, rank: number, collection: object|null }>}
 */
export async function getEffectiveCollectionPermissionDetails(db, collectionId, user, optionalRoleOrOrg = null) {
  if (!db || !collectionId || !user) {
    return { permission: null, rank: 0, collection: null };
  }

  const userId = typeof user === 'string' ? user : (user.user_id || user.id || user.sub);
  let userRole = (typeof user === 'object' ? user.role : null) || 'user';
  if (optionalRoleOrOrg && typeof optionalRoleOrOrg === 'string' && ['admin', 'user'].includes(optionalRoleOrOrg.toLowerCase())) {
    userRole = optionalRoleOrOrg;
  }
  userRole = String(userRole).toLowerCase();

  // 1. System Admin Bypass: Verify collection exists to defend against IDOR
  if (userRole === 'admin') {
    const collRes = await db.query(
      'SELECT collection_id, org_id, created_by FROM collections WHERE collection_id = $1',
      [collectionId]
    );
    if (!collRes.rows || collRes.rows.length === 0) {
      return { permission: null, rank: 0, collection: null };
    }
    return { permission: 'manage', rank: 3, collection: collRes.rows[0] };
  }

  // 2. Atomic Single-Query Evaluation (Dual PostgreSQL 15+ / SQLite compatible)
  const query = `
    WITH target_collection AS (
      SELECT collection_id, org_id, created_by
      FROM collections
      WHERE collection_id = $1
    ),
    org_membership AS (
      SELECT om.role, om.status
      FROM organization_members om
      JOIN target_collection tc ON tc.org_id = om.org_id
      WHERE om.user_id = $2 AND om.status = 'confirmed'
    ),
    valid_groups AS (
      SELECT gm.group_id
      FROM group_members gm
      JOIN groups g ON g.group_id = gm.group_id
      JOIN target_collection tc ON (tc.org_id IS NULL AND g.org_id IS NULL) OR (tc.org_id IS NOT NULL AND g.org_id = tc.org_id)
      WHERE gm.user_id = $2
    ),
    matching_grants AS (
      SELECT ca.permission, ca.target_type
      FROM collection_access ca
      WHERE ca.collection_id = $1
        AND ca.target_type = 'user'
        AND ca.target_id = $2
      UNION ALL
      SELECT ca.permission, ca.target_type
      FROM collection_access ca
      JOIN valid_groups vg ON vg.group_id = ca.target_id
      WHERE ca.collection_id = $1
        AND ca.target_type = 'group'
    ),
    ranked_grants AS (
      SELECT
        MAX(
          CASE LOWER(permission)
            WHEN 'manage' THEN 3
            WHEN 'admin' THEN 3
            WHEN 'write' THEN 2
            WHEN 'read' THEN 1
            ELSE 0
          END
        ) AS max_grant_rank,
        MAX(
          CASE WHEN target_type = 'user' THEN
            CASE LOWER(permission)
              WHEN 'manage' THEN 3
              WHEN 'admin' THEN 3
              WHEN 'write' THEN 2
              WHEN 'read' THEN 1
              ELSE 0
            END
          ELSE NULL END
        ) AS max_direct_rank,
        MAX(
          CASE WHEN target_type = 'group' THEN
            CASE LOWER(permission)
              WHEN 'manage' THEN 3
              WHEN 'admin' THEN 3
              WHEN 'write' THEN 2
              WHEN 'read' THEN 1
              ELSE 0
            END
          ELSE NULL END
        ) AS max_group_rank
      FROM matching_grants
    )
    SELECT
      tc.collection_id,
      tc.org_id,
      tc.created_by,
      om.role AS org_role,
      rg.max_grant_rank,
      rg.max_direct_rank,
      rg.max_group_rank,
      CASE
        WHEN tc.org_id IS NOT NULL AND om.role IN ('owner', 'admin') THEN 3
        WHEN tc.org_id IS NOT NULL AND om.role IS NULL THEN 0
        WHEN tc.created_by = $2 THEN 3
        ELSE COALESCE(rg.max_grant_rank, 0)
      END AS effective_rank
    FROM target_collection tc
    LEFT JOIN org_membership om ON 1=1
    CROSS JOIN ranked_grants rg;
  `;

  const result = await db.query(query, [collectionId, userId]);
  if (!result.rows || result.rows.length === 0) {
    return { permission: null, rank: 0, effectivePermission: null, effectiveRank: 0, directPermission: null, groupPermission: null, collection: null }; // Collection does not exist
  }

  const row = result.rows[0];
  const rank = Number(row.effective_rank || 0);
  const permission = rank === 3 ? 'manage' : (rank === 2 ? 'write' : (rank === 1 ? 'read' : null));

  const directRank = row.max_direct_rank != null ? Number(row.max_direct_rank) : 0;
  const directPermission = directRank === 3 ? 'manage' : (directRank === 2 ? 'write' : (directRank === 1 ? 'read' : null));

  const groupRank = row.max_group_rank != null ? Number(row.max_group_rank) : 0;
  const groupPermission = groupRank === 3 ? 'manage' : (groupRank === 2 ? 'write' : (groupRank === 1 ? 'read' : null));

  return {
    permission,
    rank,
    effectivePermission: permission,
    effectiveRank: rank,
    directPermission,
    groupPermission,
    collection: row,
  };
}

/**
 * Resolves the effective permission for a user on a given collection.
 * Evaluates:
 * 1. System administrator bypass (role === 'admin' -> 'manage', rank 3)
 * 2. Organization Owner / Admin bypass (om.role IN ('owner', 'admin') -> 'manage', rank 3)
 * 3. Collection Creator bypass (tc.created_by === userId -> 'manage', rank 3)
 * 4. Supremum across direct user grants and inherited group memberships
 * 5. Cross-tenant isolation: non-members of org receive null / rank 0
 *
 * @param {object} db - Database adapter instance
 * @param {string} collectionId - Target collection UUID
 * @param {object|string} user - Authenticated user entity or user ID string
 * @param {string|null} [optionalRole=null] - Optional role override or orgId
 * @returns {Promise<'read'|'write'|'manage'|null>}
 */
export async function getEffectiveCollectionPermission(db, collectionId, user, optionalRole = null) {
  const details = await getEffectiveCollectionPermissionDetails(db, collectionId, user, optionalRole);
  return details?.permission || null;
}

/**
 * Enforces collection-level authorization guard on incoming API requests.
 * Returns standard error response if collection is not found (404) or
 * if effective permission is below the required threshold (403).
 *
 * @param {object} db - Database adapter
 * @param {string} collectionId - Target collection ID
 * @param {object} user - Authenticated user entity
 * @param {'read'|'write'|'manage'|'admin'} [requiredPermission='read']
 * @returns {Promise<{ collection: object|null, permission: string|null, rank: number, errorResponse: object|null }>}
 */
export async function requireCollectionPermission(
  db,
  collectionId,
  user,
  requiredPermission = 'read'
) {
  if (!db || !collectionId || !user) {
    return {
      collection: null,
      permission: null,
      rank: 0,
      errorResponse: forbidden('Invalid authorization context'),
    };
  }

  const details = await getEffectiveCollectionPermissionDetails(db, collectionId, user);
  if (!details.collection) {
    return {
      collection: null,
      permission: null,
      rank: 0,
      errorResponse: notFound('Collection not found'),
    };
  }

  const { permission, rank, collection } = details;

  if (!permission || !hasRequiredPermission(permission, requiredPermission)) {
    return {
      collection,
      permission,
      rank,
      errorResponse: forbidden(`Insufficient permissions for collection. Required: ${requiredPermission}`),
    };
  }

  return { collection, permission, rank, errorResponse: null };
}

export async function requireCollectionRead(db, collectionId, user) {
  return requireCollectionPermission(db, collectionId, user, 'read');
}

export async function requireCollectionWrite(db, collectionId, user) {
  return requireCollectionPermission(db, collectionId, user, 'write');
}

export async function requireCollectionManage(db, collectionId, user) {
  return requireCollectionPermission(db, collectionId, user, 'manage');
}

// ============================================================================
// Bitwarden-style Organizations RBAC & IDOR Guard (M3: R1, R4)
// ============================================================================

export const ORG_ROLE_RANKS = Object.freeze({
  member: 1,
  admin: 2,
  owner: 3,
});

export const ORG_ROLE_NAMES = Object.freeze({
  1: 'member',
  2: 'admin',
  3: 'owner',
});

/**
 * Checks whether an organization role satisfies a minimum required role level.
 *
 * @param {'member'|'admin'|'owner'|null} actualRole
 * @param {'member'|'admin'|'owner'} [minRequiredRole='member']
 * @returns {boolean}
 */
export function hasOrgRole(actualRole, minRequiredRole = 'member') {
  if (!actualRole) return false;
  const currentRank = ORG_ROLE_RANKS[String(actualRole).toLowerCase()] || 0;
  const targetRank = ORG_ROLE_RANKS[String(minRequiredRole).toLowerCase()] || 0;
  return currentRank >= targetRank && currentRank > 0;
}

/**
 * Enforces organization-level membership and role authorization guard on incoming requests.
 * Evaluates:
 * 1. Organization existence (returns 404 if not found)
 * 2. Caller confirmed membership in organization (returns 403 if not member and not system admin)
 * 3. Role threshold check: member role must satisfy minRequiredRole (returns 403 if insufficient)
 *
 * @param {object} db - Database adapter instance
 * @param {string} orgId - Organization UUID
 * @param {object} user - Authenticated user object
 * @param {'member'|'admin'|'owner'} [minRequiredRole='member']
 * @returns {Promise<{ organization: object|null, membership: object|null, role: string|null, errorResponse: object|null }>}
 */
export async function requireOrgRole(
  db,
  orgId,
  user,
  minRequiredRole = 'member'
) {
  if (!db || !orgId || !user) {
    return {
      organization: null,
      membership: null,
      role: null,
      errorResponse: forbidden('Invalid authorization context'),
    };
  }

  const userId = typeof user === 'string' ? user : (user.user_id || user.id || user.sub);
  const userRole = String(typeof user === 'object' ? user.role : '').toLowerCase();

  // 1. Verify organization exists
  const orgRes = await db.query(
    'SELECT org_id, name, description, created_by, status, created_at, updated_at FROM organizations WHERE org_id = $1',
    [orgId]
  );

  if (!orgRes.rows || orgRes.rows.length === 0) {
    return {
      organization: null,
      membership: null,
      role: null,
      errorResponse: notFound('Organization not found'),
    };
  }

  const organization = orgRes.rows[0];

  // 2. Query caller's organization membership
  const memberRes = await db.query(
    'SELECT org_member_id, org_id, user_id, role, status, encrypted_org_key, created_at, updated_at FROM organization_members WHERE org_id = $1 AND user_id = $2 AND status = $3',
    [orgId, userId, 'confirmed']
  );

  const membership = memberRes.rows && memberRes.rows.length > 0 ? memberRes.rows[0] : null;

  // 3. System admin bypass
  if (userRole === 'admin') {
    return {
      organization,
      membership: membership || {
        org_id: orgId,
        user_id: userId,
        role: 'admin',
        status: 'confirmed',
      },
      role: membership?.role || 'admin',
      errorResponse: null,
    };
  }

  // 4. Check membership existence (IDOR protection)
  if (!membership) {
    return {
      organization: null,
      membership: null,
      role: null,
      errorResponse: forbidden('Access denied: You are not a member of this organization'),
    };
  }

  // 5. Check role threshold
  if (!hasOrgRole(membership.role, minRequiredRole)) {
    return {
      organization,
      membership,
      role: membership.role,
      errorResponse: forbidden(`Organization ${minRequiredRole} privileges required to access this resource`),
    };
  }

  return {
    organization,
    membership,
    role: membership.role,
    errorResponse: null,
  };
}

export async function requireOrgMember(db, orgId, user) {
  return requireOrgRole(db, orgId, user, 'member');
}

export async function requireOrgAdmin(db, orgId, user) {
  return requireOrgRole(db, orgId, user, 'admin');
}

export async function requireOrgOwner(db, orgId, user) {
  return requireOrgRole(db, orgId, user, 'owner');
}

export async function requireOrgMembership(db, orgId, user, minRole = 'member') {
  return requireOrgRole(db, orgId, user, minRole);
}

