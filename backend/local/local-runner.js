/**
 * Secure Vault Cloud — local API Gateway + Cognito simulator (development and tests only)
 *
 * Mirrors production:
 *   - /local-auth/*   -> local Cognito emulator (local-auth.js)
 *   - everything else -> API Gateway REST API (payload v1) event -> src/lambda.js handler
 *     with the Cognito User Pool authorizer emulated: non-public routes need
 *     "Authorization: Bearer <ID token>"; claims are placed in
 *     requestContext.authorizer.claims (cognito:groups as a comma separated string,
 *     like the real REST authorizer). Missing/invalid tokens get API Gateway's 401.
 *
 * Run: npm run dev --workspace backend   (http://localhost:3000)
 */

import http from 'node:http';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { handler } from '../src/lambda.js';
import { isPublicRoute } from '../src/router.js';
import { corsHeaders } from '../src/http/response.js';
import { getDatabase } from '../src/db/adapter.js';
import { handleLocalAuth, verifyIdToken } from './local-auth.js';

export const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);
const LAMBDA_TIMEOUT_MS = Number(process.env.LOCAL_LAMBDA_TIMEOUT_MS || 10000);

function toRestApiEvent(req, rawBody, claims) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const query = Object.fromEntries(url.searchParams.entries());
  return {
    resource: '/{proxy+}',
    path: url.pathname,
    httpMethod: req.method.toUpperCase(),
    headers: req.headers,
    queryStringParameters: Object.keys(query).length ? query : null,
    pathParameters: null,
    body: rawBody || null,
    isBase64Encoded: false,
    requestContext: {
      requestId: crypto.randomUUID(),
      stage: 'local',
      identity: {
        sourceIp: req.socket?.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'local-client',
      },
      authorizer: claims
        ? {
            claims: {
              ...claims,
              'cognito:groups': (claims['cognito:groups'] || []).join(','),
              email_verified: String(claims.email_verified),
            },
          }
        : undefined,
    },
  };
}

function localContext() {
  const deadline = Date.now() + LAMBDA_TIMEOUT_MS;
  return { getRemainingTimeInMillis: () => Math.max(deadline - Date.now(), 0) };
}

function send(res, result, extraHeaders = {}) {
  res.statusCode = result.statusCode || 200;
  for (const [key, value] of Object.entries({ ...(result.headers || {}), ...extraHeaders })) {
    res.setHeader(key, value);
  }
  res.end(result.body || '');
}

function bearerToken(headers) {
  const [scheme, token] = String(headers.authorization || '').split(' ');
  return scheme?.toLowerCase() === 'bearer' ? token : null;
}

export function createLocalServer() {
  return http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const url = new URL(req.url, 'http://localhost');
      const method = req.method.toUpperCase();
      const cors = corsHeaders(req.headers.origin);

      try {
        if (url.pathname.startsWith('/local-auth/')) {
          if (method === 'OPTIONS') return send(res, { statusCode: 204 }, cors);
          let body = {};
          try {
            body = rawBody ? JSON.parse(rawBody) : {};
          } catch {
            return send(res, { statusCode: 400, body: '{"message":"Invalid JSON"}' }, cors);
          }
          const result = await handleLocalAuth(url.pathname.slice('/local-auth/'.length), body, req.headers);
          return send(res, result, cors);
        }

        let claims = null;
        if (!isPublicRoute(method, url.pathname)) {
          try {
            claims = verifyIdToken(bearerToken(req.headers));
          } catch {
            // Same status/body API Gateway returns when the Cognito authorizer rejects a token.
            return send(res, { statusCode: 401, headers: { 'content-type': 'application/json' }, body: '{"message":"Unauthorized"}' }, cors);
          }
        }

        const result = await handler(toRestApiEvent(req, rawBody, claims), localContext());
        send(res, result);
      } catch (err) {
        console.error('[local-runner] unhandled error', err);
        send(res, { statusCode: 502, headers: { 'content-type': 'application/json' }, body: '{"message":"Internal server error"}' }, cors);
      }
    });
  });
}

export async function startLocalServer(port = DEFAULT_PORT) {
  const db = getDatabase();
  if (db.ready) await db.ready;

  const server = createLocalServer();
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`[SecureVault local API] http://localhost:${actualPort}  (API Gateway REST + Cognito emulation)`);
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((done) => server.close(done)),
      });
    });
    server.on('error', reject);
  });
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  startLocalServer(DEFAULT_PORT).catch((err) => {
    console.error('[SecureVault local API] failed to start:', err);
    process.exit(1);
  });
}

export default createLocalServer;
