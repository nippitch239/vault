/**
 * Local Amazon Cognito emulator — DEVELOPMENT AND TESTS ONLY.
 *
 * Not bundled into the Lambda (backend/scripts/build.js only bundles src/lambda.js).
 * It lets the frontend's "local" auth adapter and the integration tests exercise the same
 * flow as Cognito without an AWS account:
 *   sign-up -> confirm code -> sign-in (-> TOTP challenge) -> ID token
 *   forgot password -> confirm code + new password
 *   TOTP setup / verify
 *
 * ID tokens are HS256 JWTs carrying Cognito-shaped claims (sub, email, cognito:username,
 * cognito:groups, token_use=id). The local runner verifies them and injects the claims
 * into the event exactly where the API Gateway Cognito authorizer would.
 *
 * Confirmation / reset codes are printed to the console and returned as `devCode`
 * (there is no e-mail locally). Users listed in LOCAL_ADMIN_USERS (comma separated
 * usernames) get the "admin" group.
 */

import crypto from 'node:crypto';
import { getDatabase } from '../src/db/adapter.js';

const LOCAL_SECRET = process.env.LOCAL_AUTH_SECRET || crypto.randomBytes(32).toString('hex');
const ID_TOKEN_TTL_SECONDS = 3600;
const MAX_FAILED_SIGN_INS = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

// ---------------------------------------------------------------------------
// JWT (HS256)
// ---------------------------------------------------------------------------

export function signJwt(payload, expiresIn = ID_TOKEN_TTL_SECONDS, secret = LOCAL_SECRET) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(JSON.stringify({ iss: 'local-cognito', iat: now, exp: now + expiresIn, ...payload })).toString('base64url');
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
}

export function verifyJwt(token, secret = LOCAL_SECRET) {
  if (typeof token !== 'string') throw new Error('MISSING_TOKEN');
  const parts = token.split('.');
  if (parts.length !== 3) throw new Error('INVALID_TOKEN_FORMAT');
  const header = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8'));
  if (header.alg !== 'HS256') throw new Error('INVALID_ALGORITHM');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${parts[0]}.${parts[1]}`).digest('base64url'));
  const actual = Buffer.from(parts[2]);
  if (expected.length !== actual.length || !crypto.timingSafeEqual(expected, actual)) {
    throw new Error('INVALID_SIGNATURE');
  }
  const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) throw new Error('TOKEN_EXPIRED');
  return payload;
}

/**
 * Verifies a local ID token and returns its claims (what API Gateway would pass on).
 */
export function verifyIdToken(token) {
  const claims = verifyJwt(token);
  if (claims.token_use !== 'id') throw new Error('INVALID_TOKEN_USE');
  return claims;
}

// ---------------------------------------------------------------------------
// TOTP (RFC 6238)
// ---------------------------------------------------------------------------

const BASE32_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let output = '';
  for (let i = 0; i < buffer.length; i++) {
    value = (value << 8) | buffer[i];
    bits += 8;
    while (bits >= 5) {
      output += BASE32_CHARS[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32_CHARS[(value << (5 - bits)) & 31];
  return output;
}

export function base32Decode(str) {
  let bits = 0;
  let value = 0;
  const output = [];
  const clean = str.replace(/=+$/, '').toUpperCase();
  for (let i = 0; i < clean.length; i++) {
    const val = BASE32_CHARS.indexOf(clean[i]);
    if (val === -1) continue;
    value = (value << 5) | val;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(output);
}

export function generateTotp(secret, time = Math.floor(Date.now() / 1000), timeStep = 30) {
  const counter = Math.floor(time / timeStep);
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const key = typeof secret === 'string' ? base32Decode(secret) : secret;
  const hmac = crypto.createHmac('sha1', key).update(buf).digest();
  const offset = hmac[hmac.length - 1] & 0x0f;
  const code = (hmac.readUInt32BE(offset) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, '0');
}

export function verifyTotp(secret, code, window = 1) {
  if (!secret || typeof code !== 'string') return false;
  const trimmed = code.trim();
  const now = Math.floor(Date.now() / 1000);
  for (let w = -window; w <= window; w++) {
    if (generateTotp(secret, now + w * 30) === trimmed) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Account store (separate table, created only by the emulator)
// ---------------------------------------------------------------------------

let tableReady = null;

async function db() {
  const database = getDatabase();
  if (!tableReady) {
    // COLLATE NOCASE is SQLite-only; lookups below use LOWER() so Postgres works too.
    const nocase = database.type === 'sqlite' ? ' COLLATE NOCASE' : '';
    tableReady = database.query(`
      CREATE TABLE IF NOT EXISTS local_auth_accounts (
        sub TEXT PRIMARY KEY,
        username TEXT NOT NULL UNIQUE${nocase},
        email TEXT NOT NULL UNIQUE${nocase},
        name TEXT,
        password_hash TEXT NOT NULL,
        confirmed INTEGER NOT NULL DEFAULT 0,
        confirm_code TEXT,
        totp_secret TEXT,
        pending_totp_secret TEXT,
        reset_code TEXT,
        reset_expires BIGINT,
        failed_attempts INTEGER NOT NULL DEFAULT 0,
        locked_until BIGINT
      )`);
  }
  await tableReady;
  return database;
}

/** Test helper: forget the cached "table exists" flag after resetDatabase(). */
export function resetLocalAuthStore() {
  tableReady = null;
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `${salt}:${hash}`;
}

function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  const candidate = Buffer.from(hashPassword(password, salt).split(':')[1], 'hex');
  const expected = Buffer.from(hash, 'hex');
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

function sixDigitCode() {
  return crypto.randomInt(0, 1000000).toString().padStart(6, '0');
}

function adminUsernames() {
  return (process.env.LOCAL_ADMIN_USERS || '')
    .split(',')
    .map((u) => u.trim().toLowerCase())
    .filter(Boolean);
}

function issueIdToken(account) {
  const groups = adminUsernames().includes(account.username.toLowerCase()) ? ['admin'] : [];
  return signJwt({
    sub: account.sub,
    email: account.email,
    email_verified: true,
    name: account.name || undefined,
    'cognito:username': account.username,
    'cognito:groups': groups,
    token_use: 'id',
    aud: 'local-client',
  });
}

async function findAccount(identifier) {
  const database = await db();
  const res = await database.query(
    'SELECT * FROM local_auth_accounts WHERE LOWER(username) = $1 OR LOWER(email) = $1',
    [String(identifier || '').trim().toLowerCase()]
  );
  return res.rows[0] || null;
}

// ---------------------------------------------------------------------------
// HTTP handler for /local-auth/*
// ---------------------------------------------------------------------------

function reply(statusCode, data) {
  return { statusCode, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) };
}

const cognitoError = (statusCode, name, message) => reply(statusCode, { error: name, name, message });

function bearerClaims(headers) {
  const auth = headers.authorization || '';
  const [scheme, token] = auth.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) return null;
  try {
    return verifyIdToken(token);
  } catch {
    return null;
  }
}

const routes = {
  async 'sign-up'(body) {
    const username = String(body.username || '').trim();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!/^[a-zA-Z0-9_-]{3,30}$/.test(username)) return cognitoError(400, 'InvalidParameterException', 'Invalid username');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return cognitoError(400, 'InvalidParameterException', 'Invalid email');
    if (password.length < 8) return cognitoError(400, 'InvalidPasswordException', 'Password does not conform to policy');

    if (await findAccount(username)) return cognitoError(400, 'UsernameExistsException', 'User already exists');
    if (await findAccount(email)) return cognitoError(400, 'AliasExistsException', 'An account with the given email already exists');

    const sub = crypto.randomUUID();
    const code = sixDigitCode();
    const database = await db();
    await database.query(
      `INSERT INTO local_auth_accounts (sub, username, email, name, password_hash, confirm_code)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [sub, username, email, body.name || null, hashPassword(password), code]
    );
    console.log(`[local-cognito] sign-up confirmation code for ${username}: ${code}`);
    return reply(200, { userSub: sub, nextStep: 'CONFIRM_SIGN_UP', devCode: code });
  },

  async 'confirm-sign-up'(body) {
    const account = await findAccount(body.username);
    if (!account) return cognitoError(400, 'UserNotFoundException', 'User does not exist');
    if (account.confirmed) return reply(200, { nextStep: 'DONE' });
    if (String(body.code || '').trim() !== account.confirm_code) {
      return cognitoError(400, 'CodeMismatchException', 'Invalid verification code provided');
    }
    const database = await db();
    await database.query('UPDATE local_auth_accounts SET confirmed = 1, confirm_code = NULL WHERE sub = $1', [account.sub]);
    return reply(200, { nextStep: 'DONE' });
  },

  async 'resend-sign-up-code'(body) {
    const account = await findAccount(body.username);
    if (!account || account.confirmed) return reply(200, {});
    const code = sixDigitCode();
    const database = await db();
    await database.query('UPDATE local_auth_accounts SET confirm_code = $1 WHERE sub = $2', [code, account.sub]);
    console.log(`[local-cognito] sign-up confirmation code for ${account.username}: ${code}`);
    return reply(200, { devCode: code });
  },

  async 'sign-in'(body) {
    const account = await findAccount(body.username);
    const database = await db();
    if (!account) return cognitoError(400, 'NotAuthorizedException', 'Incorrect username or password.');
    if (account.locked_until && account.locked_until > Date.now()) {
      return cognitoError(400, 'NotAuthorizedException', 'Password attempts exceeded');
    }
    if (!passwordMatches(String(body.password || ''), account.password_hash)) {
      const attempts = account.failed_attempts + 1;
      const lockedUntil = attempts >= MAX_FAILED_SIGN_INS ? Date.now() + LOCKOUT_MS : null;
      await database.query(
        'UPDATE local_auth_accounts SET failed_attempts = $1, locked_until = $2 WHERE sub = $3',
        [lockedUntil ? 0 : attempts, lockedUntil, account.sub]
      );
      return cognitoError(400, 'NotAuthorizedException', 'Incorrect username or password.');
    }
    await database.query('UPDATE local_auth_accounts SET failed_attempts = 0, locked_until = NULL WHERE sub = $1', [account.sub]);
    if (!account.confirmed) return cognitoError(400, 'UserNotConfirmedException', 'User is not confirmed.');

    if (account.totp_secret) {
      const session = signJwt({ sub: account.sub, token_use: 'mfa_session' }, 300);
      return reply(200, { nextStep: 'CONFIRM_SIGN_IN_WITH_TOTP_CODE', session });
    }
    return reply(200, { nextStep: 'DONE', idToken: issueIdToken(account) });
  },

  async 'confirm-sign-in'(body) {
    let session;
    try {
      session = verifyJwt(body.session);
      if (session.token_use !== 'mfa_session') throw new Error('bad session');
    } catch {
      return cognitoError(400, 'NotAuthorizedException', 'Invalid session for the user, session is expired.');
    }
    const database = await db();
    const res = await database.query('SELECT * FROM local_auth_accounts WHERE sub = $1', [session.sub]);
    const account = res.rows[0];
    if (!account || !verifyTotp(account.totp_secret, String(body.code || ''))) {
      return cognitoError(400, 'CodeMismatchException', 'Invalid code received for user');
    }
    return reply(200, { nextStep: 'DONE', idToken: issueIdToken(account) });
  },

  async 'totp/setup'(body, claims) {
    if (!claims) return cognitoError(401, 'NotAuthorizedException', 'Access Token has been revoked');
    const secret = base32Encode(crypto.randomBytes(20));
    const database = await db();
    await database.query('UPDATE local_auth_accounts SET pending_totp_secret = $1 WHERE sub = $2', [secret, claims.sub]);
    return reply(200, { sharedSecret: secret });
  },

  async 'totp/verify'(body, claims) {
    if (!claims) return cognitoError(401, 'NotAuthorizedException', 'Access Token has been revoked');
    const database = await db();
    const res = await database.query('SELECT pending_totp_secret FROM local_auth_accounts WHERE sub = $1', [claims.sub]);
    const pending = res.rows[0]?.pending_totp_secret;
    if (!pending) return cognitoError(400, 'InvalidParameterException', 'Call totp/setup first');
    if (!verifyTotp(pending, String(body.code || ''))) {
      return cognitoError(400, 'EnableSoftwareTokenMFAException', 'Code mismatch');
    }
    await database.query(
      'UPDATE local_auth_accounts SET totp_secret = pending_totp_secret, pending_totp_secret = NULL WHERE sub = $1',
      [claims.sub]
    );
    return reply(200, { status: 'SUCCESS' });
  },

  async 'forgot-password'(body) {
    const account = await findAccount(body.username);
    // Same response for unknown users (Cognito "prevent user existence errors").
    if (!account) return reply(200, { deliveryMedium: 'EMAIL' });
    const code = sixDigitCode();
    const database = await db();
    await database.query(
      'UPDATE local_auth_accounts SET reset_code = $1, reset_expires = $2 WHERE sub = $3',
      [code, Date.now() + 60 * 60 * 1000, account.sub]
    );
    console.log(`[local-cognito] password reset code for ${account.username}: ${code}`);
    return reply(200, { deliveryMedium: 'EMAIL', devCode: code });
  },

  async 'confirm-forgot-password'(body) {
    const account = await findAccount(body.username);
    const code = String(body.code || '').trim();
    if (!account || !account.reset_code || account.reset_code !== code || account.reset_expires < Date.now()) {
      return cognitoError(400, 'CodeMismatchException', 'Invalid verification code provided, please try again.');
    }
    if (String(body.newPassword || '').length < 8) {
      return cognitoError(400, 'InvalidPasswordException', 'Password does not conform to policy');
    }
    const database = await db();
    await database.query(
      `UPDATE local_auth_accounts
         SET password_hash = $1, reset_code = NULL, reset_expires = NULL, failed_attempts = 0, locked_until = NULL
       WHERE sub = $2`,
      [hashPassword(String(body.newPassword)), account.sub]
    );
    return reply(200, { nextStep: 'DONE' });
  },

  async 'change-password'(body, claims) {
    if (!claims) return cognitoError(401, 'NotAuthorizedException', 'Access Token has been revoked');
    const database = await db();
    const res = await database.query('SELECT * FROM local_auth_accounts WHERE sub = $1', [claims.sub]);
    const account = res.rows[0];
    if (!account || !passwordMatches(String(body.oldPassword || ''), account.password_hash)) {
      return cognitoError(400, 'NotAuthorizedException', 'Incorrect username or password.');
    }
    await database.query('UPDATE local_auth_accounts SET password_hash = $1 WHERE sub = $2', [
      hashPassword(String(body.newPassword || '')),
      claims.sub,
    ]);
    return reply(200, {});
  },
};

/**
 * @param {string} subPath path after /local-auth/
 * @param {object} body parsed JSON body
 * @param {object} headers lower-cased request headers
 */
export async function handleLocalAuth(subPath, body, headers) {
  const route = routes[subPath];
  if (!route) return cognitoError(404, 'ResourceNotFoundException', `Unknown local-auth action: ${subPath}`);
  return route(body || {}, bearerClaims(headers || {}));
}
