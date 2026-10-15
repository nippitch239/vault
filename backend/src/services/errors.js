/**
 * Expected business-rule failures. Services throw these; the router turns them into the
 * standard { status: 'fail', error, message } response with the given HTTP status.
 */
export class ServiceError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'ServiceError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const notFound = (message, code = 'NOT_FOUND') => new ServiceError(404, code, message);
export const forbidden = (message, code = 'FORBIDDEN') => new ServiceError(403, code, message);
export const badRequest = (message, code = 'BAD_REQUEST', details) => new ServiceError(400, code, message, details);
export const conflict = (message, code = 'CONFLICT') => new ServiceError(409, code, message);
