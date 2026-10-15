/**
 * Shared helpers for backend tests: REST API (v1) events with Cognito authorizer claims.
 */

import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { router } from '../src/router.js';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';

export const TEST_ENCRYPTED_PAYLOAD = {
  ciphertext: 'pL38Kz0987654321+secureCiphertextSample==',
  iv: '3d9FaK21L+xR7n4m',
  authTag: 'q9Xm5h6Jk2L9p3Z0==',
  algorithm: 'AES-256-GCM',
  keyVersion: 1,
};
export const TEST_SALT = 'rK9v1k7Y5w4/1Z5b8lX9dQ==';

/** Cognito ID-token claims for a test user. */
export function claimsFor(username, { admin = false, sub } = {}) {
  return {
    sub: sub || uuidFor(username),
    email: `${username}@securevault.io`,
    email_verified: 'true',
    'cognito:username': username,
    'cognito:groups': admin ? 'admin' : '',
    token_use: 'id',
  };
}

const subs = new Map();
function uuidFor(username) {
  if (!subs.has(username)) subs.set(username, crypto.randomUUID());
  return subs.get(username);
}

// Invoke the router with a REST API (v1) event, optionally carrying authorizer claims.
export async function callRouter({ method = 'GET', path = '/health', headers = {}, body = null, queryStringParameters = null, claims = null, context }) {
  const event = {
    resource: '/{proxy+}',
    path,
    httpMethod: method.toUpperCase(),
    headers: { 'content-type': 'application/json', ...headers },
    queryStringParameters,
    body: body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null,
    isBase64Encoded: false,
    requestContext: {
      requestId: crypto.randomUUID(),
      identity: { sourceIp: '127.0.0.1', userAgent: 'test-runner' },
      authorizer: claims ? { claims } : undefined,
    },
  };
  const response = await router(event, context);
  let data = null;
  if (response.body) {
    try {
      data = JSON.parse(response.body);
    } catch {
      data = response.body;
    }
  }
  return { statusCode: response.statusCode, headers: response.headers, data };
}

/** Creates the vault profile (POST /users/me) for a test user and returns its claims. */
export async function registerProfile(username, opts = {}) {
  const claims = claimsFor(username, opts);
  const res = await callRouter({
    method: 'POST',
    path: '/api/v1/users/me',
    claims,
    body: {
      full_name: `${username} Tester`,
      kdf_salt: TEST_SALT,
      public_key: `MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA_${username}`,
      encrypted_private_key: TEST_ENCRYPTED_PAYLOAD,
      encrypted_vault_key: TEST_ENCRYPTED_PAYLOAD,
    },
  });
  assert.equal(res.statusCode, 201, JSON.stringify(res.data));
  return claims;
}

/** Inserts a bare users row (schema-level tests). */
export async function insertUser(db, username) {
  const userId = crypto.randomUUID();
  await db.query(
    `INSERT INTO users (user_id, email, username, full_name, kdf_salt, public_key, encrypted_private_key, encrypted_vault_key)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [userId, `${username}@example.com`, username, username, TEST_SALT, 'pk', TEST_ENCRYPTED_PAYLOAD, TEST_ENCRYPTED_PAYLOAD]
  );
  return userId;
}
