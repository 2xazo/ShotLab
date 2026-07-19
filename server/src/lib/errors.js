// Consistent JSON error shape across the API:
//   { "error": { "code": "BAD_REQUEST", "message": "...", "details"?: any } }

export class ApiError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, 'BAD_REQUEST', msg, details);
export const unauthorized = (msg = 'Authentication required') =>
  new ApiError(401, 'UNAUTHORIZED', msg);
export const forbidden = (msg = 'Not allowed') => new ApiError(403, 'FORBIDDEN', msg);
export const notFound = (msg = 'Not found') => new ApiError(404, 'NOT_FOUND', msg);
export const conflict = (msg) => new ApiError(409, 'CONFLICT', msg);
export const googleLinkConflict = () =>
  new ApiError(409, 'GOOGLE_LINK_CONFLICT', 'This Google account could not be linked safely.');
export const tooMany = (msg = 'Too many requests') => new ApiError(429, 'RATE_LIMITED', msg);
export const notImplemented = (msg = 'Not configured') =>
  new ApiError(501, 'NOT_IMPLEMENTED', msg);
export const serverError = (msg = 'Internal server error') =>
  new ApiError(500, 'SERVER_ERROR', msg);
