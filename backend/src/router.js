/**
 * Secure Vault Cloud — API router (single Lambda behind API Gateway REST API)
 *
 * - Accepts REST API (v1) and HTTP API (v2) events; see http/event.js.
 * - Every response gets the same CORS headers and error envelope (http/response.js).
 * - Unhandled errors are logged as structured JSON to CloudWatch and returned as a generic
 *   500 without internal details.
 * - Requests are cut off shortly before the Lambda timeout with a 504 JSON response.
 */

import { normalizeEvent } from './http/event.js';
import { corsHeaders, fail } from './http/response.js';

import {
  getSaltHandler,
  getMeHandler,
  createMeHandler,
  updateMeHandler,
  updateKeysHandler,
  recordSessionHandler,
} from './handlers/users.js';

import {
  listVaultsHandler,
  listVaultItemsHandler,
  getVaultItemHandler,
  createVaultItemHandler,
  updateVaultItemHandler,
  deleteVaultItemHandler,
} from './handlers/vault.js';

import {
  lookupUserHandler,
  shareItemHandler,
  listSharedItemsHandler,
  revokeShareHandler,
} from './handlers/share.js';

import {
  getHistoryHandler,
  rollbackHistoryHandler,
} from './handlers/history.js';

import {
  getSecurityNotificationsHandler,
  simulateSecurityEventHandler,
  getAdminAuditLogsHandler,
  getUserActivityLogsHandler,
} from './handlers/logs.js';

import {
  healthHandler,
  getMonitoringMetricsHandler,
  recordRequestMetric,
} from './handlers/monitoring.js';

import {
  createGroupHandler,
  listGroupsHandler,
  getGroupHandler,
  updateGroupHandler,
  deleteGroupHandler,
  addGroupMemberHandler,
  listGroupMembersHandler,
  removeGroupMemberHandler,
} from './handlers/group.js';

import {
  createCollectionHandler,
  listCollectionsHandler,
  getCollectionHandler,
  updateCollectionHandler,
  deleteCollectionHandler,
  grantCollectionAccessHandler,
  listCollectionAccessHandler,
  revokeCollectionAccessHandler,
  storeCollectionKeyHandler,
  getCollectionKeyHandler,
  addCollectionItemHandler,
  listCollectionItemsHandler,
  removeCollectionItemHandler,
} from './handlers/collection.js';

// Route Definitions
// Static path pattern accepting the optional /api/v1 or /api prefix.
const R = (staticPath) => new RegExp(`^/(?:api/v1/|api/)?${staticPath}/?$`);

const routes = [
  // Health
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?health\/?$/, handler: healthHandler, public: true },

  // Auth & profile (UC-1, UC-2, UC-3, UC-7 — credentials themselves live in Cognito)
  { method: 'GET', pattern: R('auth/salt'), handler: getSaltHandler, public: true },
  { method: 'POST', pattern: R('auth/session'), handler: recordSessionHandler },
  { method: 'GET', pattern: R('users/me'), handler: getMeHandler },
  { method: 'POST', pattern: R('users/me'), handler: createMeHandler },
  { method: 'PATCH', pattern: R('users/me'), handler: updateMeHandler },
  { method: 'PUT', pattern: R('users/me/keys'), handler: updateKeysHandler },

  // Vaults & Items (UC-4, UC-5, UC-6)
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?vaults\/?$/, handler: listVaultsHandler },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/?$/,
    paramNames: ['vaultId'],
    handler: listVaultItemsHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/?$/,
    paramNames: ['vaultId'],
    handler: createVaultItemHandler,
  },
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?items\/?$/, handler: listVaultItemsHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?items\/?$/, handler: createVaultItemHandler },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: getVaultItemHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/?$/,
    paramNames: ['itemId'],
    handler: getVaultItemHandler,
  },
  {
    method: 'PUT',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: updateVaultItemHandler,
  },
  {
    method: 'PUT',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/?$/,
    paramNames: ['itemId'],
    handler: updateVaultItemHandler,
  },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: deleteVaultItemHandler,
  },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/?$/,
    paramNames: ['itemId'],
    handler: deleteVaultItemHandler,
  },

  // Sharing (UC-10)
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?users\/lookup\/?$/, handler: lookupUserHandler },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/share\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: shareItemHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/share\/?$/,
    paramNames: ['itemId'],
    handler: shareItemHandler,
  },
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?shared-items\/?$/, handler: listSharedItemsHandler },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/share\/([^/]+)\/?$/,
    paramNames: ['vaultId', 'itemId', 'userId'],
    handler: revokeShareHandler,
  },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?shares\/([^/]+)\/?$/,
    paramNames: ['shareId'],
    handler: revokeShareHandler,
  },

  // History & Rollback (UC-11)
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/history\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: getHistoryHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/history\/?$/,
    paramNames: ['itemId'],
    handler: getHistoryHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?vaults\/([^/]+)\/items\/([^/]+)\/rollback\/?$/,
    paramNames: ['vaultId', 'itemId'],
    handler: rollbackHistoryHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?items\/([^/]+)\/rollback\/?$/,
    paramNames: ['itemId'],
    handler: rollbackHistoryHandler,
  },

  // Security & Logs (UC-8, UC-9, UC-12)
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?admin\/security\/notifications\/?$/,
    handler: getSecurityNotificationsHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?admin\/security\/simulate-event\/?$/,
    handler: simulateSecurityEventHandler,
  },
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?admin\/audit-logs\/?$/, handler: getAdminAuditLogsHandler },
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?user\/activity-logs\/?$/, handler: getUserActivityLogsHandler },

  // Monitoring (UC-13)
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?admin\/monitoring\/metrics\/?$/,
    handler: getMonitoringMetricsHandler,
  },

  // Groups & Memberships (M3: R1)
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/members\/([^/]+)\/?$/,
    paramNames: ['groupId', 'userId'],
    handler: removeGroupMemberHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/members\/?$/,
    paramNames: ['groupId'],
    handler: addGroupMemberHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/members\/?$/,
    paramNames: ['groupId'],
    handler: listGroupMembersHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/?$/,
    paramNames: ['groupId'],
    handler: getGroupHandler,
  },
  {
    method: 'PUT',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/?$/,
    paramNames: ['groupId'],
    handler: updateGroupHandler,
  },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/([^/]+)\/?$/,
    paramNames: ['groupId'],
    handler: deleteGroupHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/?$/,
    handler: createGroupHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?groups\/?$/,
    handler: listGroupsHandler,
  },

  // Collection Access RBAC (M3: R1, R3)
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/access\/([^/]+)\/([^/]+)\/?$/,
    paramNames: ['collectionId', 'targetType', 'targetId'],
    handler: revokeCollectionAccessHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/access\/?$/,
    paramNames: ['collectionId'],
    handler: grantCollectionAccessHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/access\/?$/,
    paramNames: ['collectionId'],
    handler: listCollectionAccessHandler,
  },

  // Collection Keys (M3: R1, R2)
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/keys\/?$/,
    paramNames: ['collectionId'],
    handler: storeCollectionKeyHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/keys\/?$/,
    paramNames: ['collectionId'],
    handler: getCollectionKeyHandler,
  },

  // Collection Items Association (M3: R1)
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/items\/([^/]+)\/?$/,
    paramNames: ['collectionId', 'itemId'],
    handler: removeCollectionItemHandler,
  },
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/items\/?$/,
    paramNames: ['collectionId'],
    handler: addCollectionItemHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/items\/?$/,
    paramNames: ['collectionId'],
    handler: listCollectionItemsHandler,
  },

  // Collections (M3: R1)
  {
    method: 'POST',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/?$/,
    handler: createCollectionHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/?$/,
    handler: listCollectionsHandler,
  },
  {
    method: 'GET',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/?$/,
    paramNames: ['collectionId'],
    handler: getCollectionHandler,
  },
  {
    method: 'PUT',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/?$/,
    paramNames: ['collectionId'],
    handler: updateCollectionHandler,
  },
  {
    method: 'DELETE',
    pattern: /^\/(?:api\/v1\/|api\/)?collections\/([^/]+)\/?$/,
    paramNames: ['collectionId'],
    handler: deleteCollectionHandler,
  },
];

/**
 * Routes that API Gateway exposes without the Cognito authorizer.
 * (OPTIONS preflight is also unauthenticated.)
 */
export function isPublicRoute(method, path) {
  if (method === 'OPTIONS') return true;
  return routes.some((r) => r.public && r.method === method && r.pattern.test(path));
}

export function findRoute(method, path) {
  for (const route of routes) {
    if (route.method !== method) continue;
    const match = path.match(route.pattern);
    if (match) return { route, match };
  }
  return null;
}

export const routeTable = routes;

const TIMEOUT_MARGIN_MS = 500;

function withTimeout(promise, context) {
  const remaining = typeof context?.getRemainingTimeInMillis === 'function' ? context.getRemainingTimeInMillis() : 0;
  if (!remaining) return promise;
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve(fail(504, 'TIMEOUT', 'The request took too long to complete. Please retry.')),
      Math.max(remaining - TIMEOUT_MARGIN_MS, 0)
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

function logError(event, err) {
  console.error(
    JSON.stringify({
      level: 'error',
      msg: 'Unhandled error in route handler',
      requestId: event.requestContext?.requestId,
      method: event.requestContext?.http?.method,
      path: event.rawPath,
      error: err?.message,
      code: err?.code,
      stack: err?.stack,
    })
  );
}

/**
 * Lambda router entry point.
 * @param {object} rawEvent API Gateway REST (v1) or HTTP API (v2) event
 * @param {object} [context] Lambda context
 */
export async function router(rawEvent, context) {
  const startTime = Date.now();
  const event = normalizeEvent(rawEvent);
  const method = event.requestContext.http.method;
  const path = event.rawPath;
  const cors = corsHeaders(event.headers?.origin);

  if (method === 'OPTIONS') {
    return { statusCode: 204, headers: cors, body: '' };
  }

  const found = findRoute(method, path);
  if (!found) {
    recordRequestMetric(Date.now() - startTime, true);
    const res = fail(404, 'ROUTE_NOT_FOUND', `No handler found for ${method} ${path}`);
    return { ...res, headers: { ...res.headers, ...cors } };
  }

  const { route, match } = found;
  const pathParameters = { ...(event.pathParameters || {}) };
  (route.paramNames || []).forEach((name, idx) => {
    pathParameters[name] = decodeURIComponent(match[idx + 1]);
  });

  let response;
  try {
    response = await withTimeout(Promise.resolve(route.handler({ ...event, pathParameters }, context)), context);
  } catch (err) {
    logError(event, err);
    response = fail(500, 'INTERNAL_SERVER_ERROR', 'An unexpected error occurred. Please try again later.');
  }

  recordRequestMetric(Date.now() - startTime, response.statusCode >= 400);
  // CORS is decided here, not by individual handlers.
  return { ...response, headers: { ...(response.headers || {}), ...cors } };
}

export default router;
