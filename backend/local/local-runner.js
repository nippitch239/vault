/**
 * Secure Vault Cloud — Credential-Free Local Simulation HTTP Runner
 *
 * Implements:
 * 1. Zero-dependency local development server using Node.js native node:http.
 * 2. Translates standard HTTP requests to API Gateway v2 HTTP events.
 * 3. Dispatches events to router and sends back HTTP responses.
 * 4. Runs standalone (node src/server/local-runner.js) or as importable test server.
 *
 * Ponytail minimalism: 100% native standard library (node:http), zero Express or framework bloat.
 */

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { router } from '../src/router.js';
import { getDatabase } from '../src/db/adapter.js';

export const DEFAULT_PORT = parseInt(process.env.PORT || '3000', 10);

/**
 * Converts a Node.js http.IncomingMessage request into an API Gateway v2 HTTP event
 * @param {http.IncomingMessage} req
 * @param {string} body
 * @returns {object} - API Gateway v2 event
 */
export function httpRequestToApiGatewayEvent(req, body = '') {
  const host = req.headers.host || 'localhost';
  const urlObj = new URL(req.url, `http://${host}`);
  const rawPath = urlObj.pathname;
  const rawQueryString = urlObj.search.startsWith('?') ? urlObj.search.slice(1) : urlObj.search;

  const queryStringParameters = {};
  for (const [key, val] of urlObj.searchParams.entries()) {
    queryStringParameters[key] = val;
  }

  return {
    version: '2.0',
    routeKey: '$default',
    rawPath,
    rawQueryString,
    headers: req.headers,
    queryStringParameters,
    requestContext: {
      http: {
        method: req.method.toUpperCase(),
        path: rawPath,
        protocol: 'HTTP/1.1',
        sourceIp: req.socket?.remoteAddress || '127.0.0.1',
        userAgent: req.headers['user-agent'] || 'local-simulation-client',
      },
    },
    body: body || null,
    isBase64Encoded: false,
  };
}

/**
 * Creates the local HTTP server
 * @returns {http.Server}
 */
export function createLocalServer() {
  const server = http.createServer(async (req, res) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(chunk));
    req.on('end', async () => {
      const rawBody = Buffer.concat(chunks).toString('utf8');
      const event = httpRequestToApiGatewayEvent(req, rawBody);

      try {
        const result = await router(event);

        res.statusCode = result.statusCode || 200;
        if (result.headers) {
          for (const [headerKey, headerVal] of Object.entries(result.headers)) {
            res.setHeader(headerKey, headerVal);
          }
        }
        res.end(result.body || '');
      } catch (err) {
        res.statusCode = 500;
        res.setHeader('content-type', 'application/json');
        res.end(
          JSON.stringify({
            status: 'error',
            error: 'SIMULATION_SERVER_ERROR',
            message: err.message,
          })
        );
      }
    });
  });

  return server;
}

/**
 * Starts the local simulation server on specified port
 * @param {number} [port=DEFAULT_PORT]
 * @returns {Promise<{ server: http.Server, port: number, close: Function }>}
 */
export async function startLocalServer(port = DEFAULT_PORT) {
  // Ensure database is initialized
  getDatabase();

  const server = createLocalServer();
  return new Promise((resolve, reject) => {
    server.listen(port, () => {
      const actualPort = server.address().port;
      console.log(`[SecureVault Local Simulator] Running at http://localhost:${actualPort}`);
      resolve({
        server,
        port: actualPort,
        close: () => new Promise((res) => server.close(res)),
      });
    });
    server.on('error', reject);
  });
}

// Standalone execution check
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  startLocalServer(DEFAULT_PORT).catch((err) => {
    console.error('[SecureVault Local Simulator] Failed to start:', err);
    process.exit(1);
  });
}

export default createLocalServer;
