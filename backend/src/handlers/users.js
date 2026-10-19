/**
 * Secure Vault Cloud — User profile & key material (replaces the old custom auth handlers)
 *
 * Login, sign-up confirmation, MFA (TOTP) and forgotten-password are handled by Amazon
 * Cognito. The client derives, from the master password:
 *   Argon2id(master password, kdf_salt) -> Master Key -> HKDF -> KEK + Authentication Key
 * The Authentication Key is the Cognito password; the KEK never leaves the browser and
 * unwraps the random Vault Key stored here as encrypted_vault_key.
 *
 * Routes:
 *   GET   /auth/salt?identifier=   public (no authorizer) — KDF salt for login/sign-up
 *   GET   /users/me                profile + encrypted key material
 *   POST  /users/me                first sign-in: store key material, create default vault
 *   PATCH /users/me                full_name / mfa_enabled
 *   PUT   /users/me/keys           replace key material (master password change / reset)
 *   POST  /auth/session            record a successful sign-in in the activity log
 */

import crypto from 'node:crypto';
import { getDatabase } from '../db/adapter.js';
import { authenticate } from '../middleware/auth-guard.js';
import { getSaltPepper } from '../config/secrets.js';
import { ok, badRequest, notFound, conflict, readJsonBody } from '../http/response.js';
import { getSourceIp, getUserAgent } from '../http/event.js';

const MAX_PUBLIC_KEY_LENGTH = 4096;
const MAX_CIPHERTEXT_LENGTH = 16384;

/**
 * Deterministic salt for an identifier that has no profile yet. Using it both for
 * sign-up and for unknown identifiers means:
 *   - the salt exists before the profile row does (sign-up -> confirm -> first sign-in),
 *   - unknown usernames get a stable, realistic-looking salt (no user enumeration).
 */
export async function deriveDefaultSalt(identifier) {
  const pepper = await getSaltPepper();
  return crypto
    .createHmac('sha256', pepper)
    .update(`kdf-salt:v1:${identifier.trim().toLowerCase()}`)
    .digest()
    .subarray(0, 16)
    .toString('base64');
}

function isEncryptedPayload(value) {
  return (
    value &&
    typeof value === 'object' &&
    typeof value.ciphertext === 'string' &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= MAX_CIPHERTEXT_LENGTH &&
    typeof value.iv === 'string' &&
    typeof (value.authTag ?? value.auth_tag) === 'string'
  );
}

function isValidSalt(value) {
  if (typeof value !== 'string' || value.length > 128) return false;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return false;
  return Buffer.from(value, 'base64').length >= 16;
}

function validateKeyMaterial(body, { requirePublicKey = true } = {}) {
  const errors = [];
  if (!isValidSalt(body.kdf_salt)) errors.push({ field: 'kdf_salt', message: 'kdf_salt must be base64 of at least 16 bytes' });
  if (!isEncryptedPayload(body.encrypted_vault_key)) {
    errors.push({ field: 'encrypted_vault_key', message: 'encrypted_vault_key must be an AES-GCM payload' });
  }
  if (!isEncryptedPayload(body.encrypted_private_key)) {
    errors.push({ field: 'encrypted_private_key', message: 'encrypted_private_key must be an AES-GCM payload' });
  }
  if (requirePublicKey || body.public_key !== undefined) {
    if (typeof body.public_key !== 'string' || !body.public_key || body.public_key.length > MAX_PUBLIC_KEY_LENGTH) {
      errors.push({ field: 'public_key', message: 'public_key (SPKI base64) is required' });
    }
  }
  return errors;
}

function formatProfile(row) {
  return {
    user_id: row.user_id,
    email: row.email,
    username: row.username,
    full_name: row.full_name,
    role: row.role,
    mfa_enabled: Boolean(row.mfa_enabled),
    kdf_salt: row.kdf_salt,
    public_key: row.public_key,
    encrypted_private_key: row.encrypted_private_key,
    encrypted_vault_key: row.encrypted_vault_key,
    created_at: row.created_at,
  };
}

async function loadProfile(db, userId) {
  const res = await db.query('SELECT * FROM users WHERE user_id = $1', [userId]);
  return res.rows[0] || null;
}

/**
 * GET /auth/salt?identifier=<username or email>   (public)
 */
export async function getSaltHandler(event) {
  const q = event.queryStringParameters || {};
  const identifier = String(q.identifier || q.username || q.email || '').trim();
  if (!identifier || identifier.length > 255) {
    return badRequest('Query parameter identifier (username or email) is required', 'MISSING_PARAM');
  }

  const db = getDatabase();
  const res = await db.query(
    'SELECT kdf_salt FROM users WHERE LOWER(username) = $1 OR LOWER(email) = $1',
    [identifier.toLowerCase()]
  );
  const salt = res.rows[0]?.kdf_salt || (await deriveDefaultSalt(identifier));
  return ok({ data: { salt } });
}

/**
 * GET /users/me
 */
export async function getMeHandler(event) {
  const { user, errorResponse } = authenticate(event);
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const row = await loadProfile(db, user.user_id);
  if (!row) {
    return notFound('Vault profile has not been created yet', 'PROFILE_NOT_FOUND');
  }

  // Cognito groups are the source of truth for the role; keep the column in sync.
  if (row.role !== user.role) {
    await db.query('UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE user_id = $2', [user.role, user.user_id]);
    row.role = user.role;
  }
  return ok({ data: formatProfile(row) });
}

/**
 * POST /users/me — called once, on the first sign-in after Cognito sign-up confirmation.
 */
export async function createMeHandler(event) {
  const { user, errorResponse } = authenticate(event);
  if (errorResponse) return errorResponse;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  if (!user.email || !user.username) {
    return badRequest('Cognito token must contain email and cognito:username claims', 'INCOMPLETE_CLAIMS');
  }

  const fullName = String(body.full_name ?? user.full_name ?? '').trim();
  const errors = validateKeyMaterial(body);
  if (!fullName || fullName.length > 128) errors.push({ field: 'full_name', message: 'full_name is required (max 128 chars)' });
  if (errors.length) return badRequest('Invalid profile payload', 'VALIDATION_FAILED', errors);

  const db = getDatabase();
  if (await loadProfile(db, user.user_id)) {
    return conflict('Vault profile already exists', 'PROFILE_EXISTS');
  }

  try {
    await db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (user_id, email, username, full_name, kdf_salt, role, public_key, encrypted_private_key, encrypted_vault_key)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          user.user_id,
          user.email,
          user.username,
          fullName,
          body.kdf_salt,
          user.role,
          body.public_key,
          body.encrypted_private_key,
          body.encrypted_vault_key,
        ]
      );
      await tx.query(
        "INSERT INTO vaults (user_id, name, description) VALUES ($1, 'Personal Vault', 'Default personal password vault')",
        [user.user_id]
      );
      await tx.query(
        `INSERT INTO activity_logs (user_id, action_type, ip_address, user_agent, details)
         VALUES ($1, 'USER_REGISTERED', $2, $3, $4)`,
        [user.user_id, getSourceIp(event), getUserAgent(event), { username: user.username }]
      );
      await tx.query(
        `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, details)
         VALUES ($1, $2, 'USER_REGISTERED', 'INFO', 'users', $1, $3, $4)`,
        [user.user_id, user.role, getSourceIp(event), { username: user.username }]
      );
    });
  } catch (err) {
    if (err.isUniqueViolation) {
      return conflict('Username or email is already used by another vault profile', 'PROFILE_EXISTS');
    }
    throw err;
  }

  const row = await loadProfile(db, user.user_id);
  return ok({ data: formatProfile(row) }, 201);
}

/**
 * PATCH /users/me — non-secret profile fields.
 */
export async function updateMeHandler(event) {
  const { user, errorResponse } = authenticate(event);
  if (errorResponse) return errorResponse;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const db = getDatabase();
  const row = await loadProfile(db, user.user_id);
  if (!row) return notFound('Vault profile has not been created yet', 'PROFILE_NOT_FOUND');

  let fullName = row.full_name;
  if (body.full_name !== undefined) {
    fullName = String(body.full_name).trim();
    if (!fullName || fullName.length > 128) return badRequest('full_name must be 1-128 characters', 'VALIDATION_FAILED');
  }
  let mfaEnabled = Boolean(row.mfa_enabled);
  if (body.mfa_enabled !== undefined) {
    if (typeof body.mfa_enabled !== 'boolean') return badRequest('mfa_enabled must be a boolean', 'VALIDATION_FAILED');
    mfaEnabled = body.mfa_enabled;
  }

  await db.query(
    'UPDATE users SET full_name = $1, mfa_enabled = $2, updated_at = CURRENT_TIMESTAMP WHERE user_id = $3',
    [fullName, mfaEnabled, user.user_id]
  );
  if (body.mfa_enabled !== undefined && body.mfa_enabled !== Boolean(row.mfa_enabled)) {
    await db.query(
      `INSERT INTO activity_logs (user_id, action_type, ip_address, user_agent, details)
       VALUES ($1, $2, $3, $4, $5)`,
      [user.user_id, mfaEnabled ? 'MFA_ENABLED' : 'MFA_DISABLED', getSourceIp(event), getUserAgent(event), { mfa_type: 'totp' }]
    );
  }
  return ok({ data: formatProfile(await loadProfile(db, user.user_id)) });
}

/**
 * PUT /users/me/keys — re-wrapped key material after a master password change, or
 * fresh key material after a forgotten-password reset (old ciphertext becomes unreadable).
 */
export async function updateKeysHandler(event) {
  const { user, errorResponse } = authenticate(event);
  if (errorResponse) return errorResponse;
  const { body, errorResponse: bodyError } = readJsonBody(event);
  if (bodyError) return bodyError;

  const errors = validateKeyMaterial(body, { requirePublicKey: false });
  if (errors.length) return badRequest('Invalid key material', 'VALIDATION_FAILED', errors);

  const db = getDatabase();
  const row = await loadProfile(db, user.user_id);
  if (!row) return notFound('Vault profile has not been created yet', 'PROFILE_NOT_FOUND');

  const reason = body.reason === 'reset' ? 'reset' : 'change';
  await db.query(
    `UPDATE users
       SET kdf_salt = $1, encrypted_vault_key = $2, encrypted_private_key = $3,
           public_key = COALESCE($4, public_key), updated_at = CURRENT_TIMESTAMP
     WHERE user_id = $5`,
    [body.kdf_salt, body.encrypted_vault_key, body.encrypted_private_key, body.public_key ?? null, user.user_id]
  );
  await db.query(
    `INSERT INTO audit_logs (actor_user_id, actor_role, event_action, event_severity, target_resource, target_resource_id, ip_address, details)
     VALUES ($1, $2, $3, 'WARNING', 'users', $1, $4, $5)`,
    [
      user.user_id,
      user.role,
      reason === 'reset' ? 'MASTER_PASSWORD_RESET' : 'MASTER_PASSWORD_CHANGED',
      getSourceIp(event),
      { rotated_public_key: body.public_key !== undefined },
    ]
  );
  return ok({ data: formatProfile(await loadProfile(db, user.user_id)) });
}

/**
 * POST /auth/session — the client calls this right after a successful Cognito sign-in.
 */
export async function recordSessionHandler(event) {
  const { user, errorResponse } = authenticate(event);
  if (errorResponse) return errorResponse;

  const db = getDatabase();
  const row = await loadProfile(db, user.user_id);
  if (!row) return notFound('Vault profile has not been created yet', 'PROFILE_NOT_FOUND');

  await db.query('UPDATE users SET last_login_at = CURRENT_TIMESTAMP WHERE user_id = $1', [user.user_id]);
  await db.query(
    `INSERT INTO activity_logs (user_id, action_type, ip_address, user_agent, details)
     VALUES ($1, 'LOGIN_SUCCESS', $2, $3, $4)`,
    [user.user_id, getSourceIp(event), getUserAgent(event), { role: user.role }]
  );
  return ok({ message: 'Session recorded' });
}
