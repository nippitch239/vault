/**
 * Small input validators shared by handlers. They return a ready-to-send 400 response
 * (or null when the input is valid) so handlers can `if (err) return err;`.
 */

import { badRequest } from './response.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value) {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** 400 INVALID_ID unless every named value is a UUID. */
export function requireUuids(values) {
  for (const [name, value] of Object.entries(values)) {
    if (!isUuid(value)) return badRequest(`${name} must be a valid UUID`, 'INVALID_ID');
  }
  return null;
}

/** 400 BAD_REQUEST unless value is one of the allowed strings. */
export function requireEnum(name, value, allowed) {
  if (typeof value !== 'string' || !allowed.includes(value.toLowerCase())) {
    return badRequest(`${name} must be one of: ${allowed.join(', ')}`, 'BAD_REQUEST');
  }
  return null;
}

/**
 * Trimmed string with a length range; returns { value } or { error: {field, message} }.
 */
export function checkText(field, value, { min = 0, max, allowNull = false } = {}) {
  if (value === null && allowNull) return { value: null };
  if (typeof value !== 'string') return { error: { field, message: `${field} must be a string` } };
  const trimmed = value.trim();
  if (trimmed.length < min) return { error: { field, message: `${field} is required` } };
  // Count Unicode code points so Thai / emoji are measured like PostgreSQL VARCHAR(n).
  if (max !== undefined && [...trimmed].length > max) {
    return { error: { field, message: `${field} must be at most ${max} characters` } };
  }
  return { value: trimmed };
}

export function isWrappedKey(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof value.ciphertext === 'string' &&
    value.ciphertext.length > 0 &&
    value.ciphertext.length <= 4096
  );
}
