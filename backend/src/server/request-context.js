/**
 * Per-request context (client IP) available to handlers without threading `event` through helpers.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

export const requestContext = new AsyncLocalStorage();

/**
 * Real client IP: HTTP API v2 (requestContext.http) or REST API v1 (requestContext.identity)
 * @param {object} event
 * @returns {string}
 */
export function getEventSourceIp(event) {
  return (
    event?.requestContext?.http?.sourceIp ||
    event?.requestContext?.identity?.sourceIp ||
    '127.0.0.1'
  );
}

export function getClientIp() {
  return requestContext.getStore()?.ip || '127.0.0.1';
}
