/**
 * Secure Vault Cloud — Authentication & RBAC Middleware (Auth Guard)
 *
 * Implements:
 * 1. Lightweight HS256 JWT signing and verification using native node:crypto.
 * 2. Role-Based Access Control (RBAC: 'user' vs 'admin').
 * 3. Support for API Gateway v2 HTTP events with Bearer Authorization header or authorizer claims.
 *
 * Ponytail minimalism: Pure native standard library node:crypto, zero external JWT libraries.
 */

import crypto from 'node:crypto';

// Secret key for JWT signing (defaults to environment or default secret)
export const JWT_SECRET = process.env.JWT_SECRET || 'securevault-jwt-insecure-default-secret-key-32b';

/**
 * Encodes Buffer or string to Base64URL
 * @param {Buffer|string} input
 * @returns {string}
 */
export function toBase64Url(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64url');
}

/**
 * Decodes Base64URL string to Buffer
 * @param {string} str
 * @returns {Buffer}
 */
export function fromBase64Url(str) {
  return Buffer.from(str, 'base64url');
}

/**
 * Signs a JWT payload with HS256
 * @param {object} payload
 * @param {string} [secret=JWT_SECRET]
 * @param {number} [expiresIn=3600] - Expiration time in seconds
 * @returns {string} - Complete JWT token
 */
export function signJwt(payload, secret = JWT_SECRET, expiresIn = 3600) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const now = Math.floor(Date.now() / 1000);

  const fullPayload = {
    iss: 'securevault-api',
    iat: now,
    exp: now + expiresIn,
    ...payload,
  };

  const encodedHeader = toBase64Url(JSON.stringify(header));
  const encodedPayload = toBase64Url(JSON.stringify(fullPayload));
  const data = `${encodedHeader}.${encodedPayload}`;

  const signature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  return `${data}.${signature}`;
}

/**
 * Verifies a JWT token and returns its payload if valid
 * @param {string} token
 * @param {string} [secret=JWT_SECRET]
 * @returns {object} - Decoded payload
 * @throws {Error} - If token is invalid, tampered, or expired
 */
export function verifyJwt(token, secret = JWT_SECRET) {
  if (!token || typeof token !== 'string') {
    throw new Error('MISSING_TOKEN: Token must be a non-empty string');
  }

  const parts = token.split('.');
  if (parts.length !== 3) {
    throw new Error('INVALID_TOKEN_FORMAT: JWT must contain 3 parts');
  }

  const [headerB64, payloadB64, signatureB64] = parts;
  const data = `${headerB64}.${payloadB64}`;

  // Verify HMAC signature in constant time
  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(data)
    .digest('base64url');

  const sigBuf = Buffer.from(signatureB64);
  const expSigBuf = Buffer.from(expectedSignature);

  if (sigBuf.length !== expSigBuf.length || !crypto.timingSafeEqual(sigBuf, expSigBuf)) {
    throw new Error('INVALID_SIGNATURE: Token signature does not match');
  }

  // Parse header and payload
  let payload;
  try {
    payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    throw new Error('INVALID_PAYLOAD: Failed to parse token payload');
  }

  // Validate expiration
  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) {
    const err = new Error('TOKEN_EXPIRED: Token has expired');
    err.code = 'TOKEN_EXPIRED';
    throw err;
  }

  return payload;
}

/**
 * Extracts bearer token from event headers
 * @param {object} headers
 * @returns {string|null}
 */
export function extractBearerToken(headers = {}) {
  const authHeader = headers?.authorization || headers?.Authorization;
  if (!authHeader || typeof authHeader !== 'string') {
    return null;
  }
  const parts = authHeader.trim().split(/\s+/);
  if (parts.length === 2 && parts[0].toLowerCase() === 'bearer') {
    return parts[1];
  }
  return null;
}

/**
 * Middleware to authenticate requests and enforce RBAC
 * Supports API Gateway v2 event structure
 *
 * @param {object} event - API Gateway v2 HTTP event
 * @param {'user'|'admin'|'any'} [requiredRole='user']
 * @returns {{ user: object|null, errorResponse: object|null }}
 */
export function authenticate(event, requiredRole = 'user') {
  // Check if claims are already resolved by API Gateway authorizer
  const claims = event?.requestContext?.authorizer?.jwt?.claims;
  if (claims && claims.sub) {
    const user = {
      user_id: claims.sub,
      email: claims.email,
      username: claims.username,
      role: claims.role || 'user',
      mfa_verified: claims.mfa_verified === true || claims.mfa_verified === 'true',
    };

    if (requiredRole === 'admin' && user.role !== 'admin') {
      return {
        user: null,
        errorResponse: {
          statusCode: 403,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: 'fail',
            error: 'FORBIDDEN',
            message: 'Admin privileges required to access this resource',
          }),
        },
      };
    }

    return { user, errorResponse: null };
  }

  // Fallback to Bearer token verification from headers
  const token = extractBearerToken(event?.headers);
  if (!token) {
    return {
      user: null,
      errorResponse: {
        statusCode: 401,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'fail',
          error: 'UNAUTHORIZED',
          message: 'Missing or invalid Authorization header',
        }),
      },
    };
  }

  try {
    const decoded = verifyJwt(token);
    const user = {
      user_id: decoded.sub,
      email: decoded.email,
      username: decoded.username,
      role: decoded.role || 'user',
      mfa_verified: decoded.mfa_verified ?? true,
    };

    if (requiredRole === 'admin' && user.role !== 'admin') {
      return {
        user: null,
        errorResponse: {
          statusCode: 403,
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            status: 'fail',
            error: 'FORBIDDEN',
            message: 'Admin privileges required to access this resource',
          }),
        },
      };
    }

    return { user, errorResponse: null };
  } catch (err) {
    const statusCode = err.code === 'TOKEN_EXPIRED' ? 401 : 401;
    return {
      user: null,
      errorResponse: {
        statusCode,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          status: 'fail',
          error: err.code || 'INVALID_TOKEN',
          message: err.message,
        }),
      },
    };
  }
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
