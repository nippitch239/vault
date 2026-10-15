/**
 * Uniform HTTP responses for every Lambda route.
 *
 * Success: { status: 'success', ...data }
 * Failure: { status: 'fail' | 'error', error: 'MACHINE_CODE', message: 'human readable', details? }
 *   - 'fail'  = 4xx (caller can fix the request)
 *   - 'error' = 5xx (server side; never includes stack traces or SQL)
 */

/**
 * CORS headers. API Gateway (REST, Lambda proxy) passes these through untouched, so the
 * Lambda is the single place that decides the allowed origin.
 * CORS_ALLOW_ORIGIN may be "*" (local dev) or a comma separated allow-list.
 */
export function corsHeaders(requestOrigin) {
  const configured = (process.env.CORS_ALLOW_ORIGIN || '*').split(',').map((o) => o.trim()).filter(Boolean);
  let allowOrigin = configured[0] || '*';
  if (!configured.includes('*') && requestOrigin && configured.includes(requestOrigin)) {
    allowOrigin = requestOrigin;
  }
  return {
    'access-control-allow-origin': configured.includes('*') ? '*' : allowOrigin,
    'access-control-allow-methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'Content-Type, Authorization, X-Requested-With',
    'access-control-max-age': '86400',
    vary: 'Origin',
  };
}

export function json(statusCode, data, extraHeaders = {}) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(data),
  };
}

export function ok(data = {}, statusCode = 200) {
  return json(statusCode, { status: 'success', success: true, ...data });
}

export function fail(statusCode, error, message, details) {
  const body = {
    status: statusCode >= 500 ? 'error' : 'fail',
    error,
    message,
  };
  if (details !== undefined) body.details = details;
  return json(statusCode, body);
}

export const badRequest = (message, error = 'BAD_REQUEST', details) => fail(400, error, message, details);
export const unauthorized = (message = 'Authentication required', error = 'UNAUTHORIZED') => fail(401, error, message);
export const forbidden = (message = 'Forbidden', error = 'FORBIDDEN') => fail(403, error, message);
export const notFound = (message = 'Not found', error = 'NOT_FOUND') => fail(404, error, message);
export const conflict = (message, error = 'CONFLICT') => fail(409, error, message);

/**
 * Parses a JSON request body. Returns { body } on success or { errorResponse } when the
 * body is present but is not a JSON object.
 */
export function readJsonBody(event) {
  const raw = event?.body;
  if (raw === undefined || raw === null || raw === '') return { body: {} };
  if (typeof raw === 'object') return { body: raw };
  try {
    const parsed = JSON.parse(raw);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { errorResponse: badRequest('Request body must be a JSON object', 'INVALID_JSON') };
    }
    return { body: parsed };
  } catch {
    return { errorResponse: badRequest('Request body is not valid JSON', 'INVALID_JSON') };
  }
}
