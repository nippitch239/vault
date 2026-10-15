/**
 * Secure Vault Cloud — API Gateway v2 HTTP Event Router
 *
 * Implements:
 * 1. API Gateway v2 event routing mapping paths and HTTP methods to Lambda handlers.
 * 2. URL parameter pattern matching (:vaultId, :itemId, :userId, :shareId).
 * 3. CORS preflight OPTIONS handling.
 * 4. Error boundaries and metrics collection.
 *
 * Ponytail minimalism: Pure regex path matching, zero external router dependencies.
 */

import {
  registerHandler,
  getSaltHandler,
  loginHandler,
  mfaSetupHandler,
  mfaVerifyHandler,
  mfaValidateHandler,
  resetPasswordRequestHandler,
  resetPasswordConfirmHandler,
} from './handlers/auth.js';

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
const routes = [
  // Health
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?health\/?$/, handler: healthHandler },

  // Auth (UC-1, UC-2, UC-3, UC-7)
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/register\/?$/, handler: registerHandler },
  { method: 'GET', pattern: /^\/(?:api\/v1\/|api\/)?auth\/salt\/?$/, handler: getSaltHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/login\/?$/, handler: loginHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/mfa\/setup\/?$/, handler: mfaSetupHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/mfa\/verify\/?$/, handler: mfaVerifyHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/mfa\/validate\/?$/, handler: mfaValidateHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/reset-password\/request\/?$/, handler: resetPasswordRequestHandler },
  { method: 'POST', pattern: /^\/(?:api\/v1\/|api\/)?auth\/reset-password\/confirm\/?$/, handler: resetPasswordConfirmHandler },

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
 * Main Lambda API Gateway v2 Router Entry Point
 * @param {object} event - API Gateway v2 HTTP event
 * @param {object} [context] - Lambda context
 * @returns {Promise<{ statusCode: number, headers: object, body: string }>}
 */
export async function router(event, context) {
  const startTime = Date.now();
  const method = (
    event.requestContext?.http?.method ||
    event.httpMethod ||
    'GET'
  ).toUpperCase();

  const path = event.rawPath || event.path || '/';

  // Handle CORS preflight
  if (method === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, PUT, DELETE, OPTIONS',
        'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With',
        'access-control-max-age': '86400',
      },
      body: '',
    };
  }

  // Find matching route
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = path.match(route.pattern);
    if (match) {
      // Extract path parameters
      const pathParameters = { ...(event.pathParameters || {}) };
      if (route.paramNames) {
        route.paramNames.forEach((paramName, idx) => {
          pathParameters[paramName] = match[idx + 1];
        });
      }

      const enhancedEvent = {
        ...event,
        pathParameters,
      };

      try {
        const response = await route.handler(enhancedEvent, context);
        const latency = Date.now() - startTime;
        recordRequestMetric(latency, response.statusCode >= 400);

        // Ensure default CORS header
        const headers = {
          'access-control-allow-origin': '*',
          ...(response.headers || {}),
        };

        return {
          ...response,
          headers,
        };
      } catch (err) {
        const latency = Date.now() - startTime;
        recordRequestMetric(latency, true);

        return {
          statusCode: 500,
          headers: {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          },
          body: JSON.stringify({
            status: 'error',
            error: 'INTERNAL_SERVER_ERROR',
            message: err.message || 'An unexpected error occurred',
          }),
        };
      }
    }
  }

  // 404 Route Not Found
  const latency = Date.now() - startTime;
  recordRequestMetric(latency, true);

  return {
    statusCode: 404,
    headers: {
      'content-type': 'application/json',
      'access-control-allow-origin': '*',
    },
    body: JSON.stringify({
      status: 'fail',
      error: 'ROUTE_NOT_FOUND',
      message: `No handler found for ${method} ${path}`,
    }),
  };
}

export default router;
