/**
 * Normalizes API Gateway events into one shape for the router and handlers.
 *
 * Production uses API Gateway REST API (payload v1: httpMethod / path /
 * requestContext.authorizer.claims) so AWS WAF can be attached to the stage.
 * HTTP API (payload v2) events are accepted too. Handlers always see the v2-like shape:
 *   rawPath, requestContext.http.{method,path,sourceIp,userAgent},
 *   requestContext.authorizer.jwt.claims, lower-cased headers, decoded body.
 */

function lowerCaseHeaders(headers) {
  const out = {};
  for (const [key, value] of Object.entries(headers || {})) {
    if (value !== undefined && value !== null) out[key.toLowerCase()] = String(value);
  }
  return out;
}

function decodeBody(event) {
  if (event.body && event.isBase64Encoded) {
    return Buffer.from(event.body, 'base64').toString('utf8');
  }
  return event.body ?? null;
}

export function isRestApiEvent(event) {
  return Boolean(event && event.httpMethod && !event.requestContext?.http);
}

export function normalizeEvent(event = {}) {
  const headers = lowerCaseHeaders(event.headers);
  const rc = event.requestContext || {};

  if (isRestApiEvent(event)) {
    const claims = rc.authorizer?.claims || rc.authorizer?.jwt?.claims;
    return {
      version: '2.0',
      rawPath: event.path || '/',
      rawQueryString: new URLSearchParams(event.queryStringParameters || {}).toString(),
      headers,
      queryStringParameters: event.queryStringParameters || {},
      pathParameters: event.pathParameters || {},
      body: decodeBody(event),
      isBase64Encoded: false,
      requestContext: {
        requestId: rc.requestId,
        stage: rc.stage,
        http: {
          method: String(event.httpMethod).toUpperCase(),
          path: event.path || '/',
          sourceIp: rc.identity?.sourceIp || '0.0.0.0',
          userAgent: rc.identity?.userAgent || headers['user-agent'] || '',
        },
        authorizer: claims ? { jwt: { claims } } : undefined,
      },
    };
  }

  return {
    ...event,
    rawPath: event.rawPath || event.path || '/',
    headers,
    queryStringParameters: event.queryStringParameters || {},
    body: decodeBody(event),
    isBase64Encoded: false,
    requestContext: {
      ...rc,
      http: {
        ...(rc.http || {}),
        method: String(rc.http?.method || event.httpMethod || 'GET').toUpperCase(),
        sourceIp: rc.http?.sourceIp || '0.0.0.0',
        userAgent: rc.http?.userAgent || headers['user-agent'] || '',
      },
    },
  };
}

export function getSourceIp(event) {
  return event?.requestContext?.http?.sourceIp || '0.0.0.0';
}

export function getUserAgent(event) {
  return event?.requestContext?.http?.userAgent || event?.headers?.['user-agent'] || '';
}
