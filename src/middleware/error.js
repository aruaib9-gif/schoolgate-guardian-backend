// Central error helpers + Express error handler.

export class ApiError extends Error {
  constructor(status, message, extra = undefined) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const badRequest = (msg = 'Bad request', extra) => new ApiError(400, msg, extra);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, msg);
export const forbidden = (msg = 'Forbidden', extra) => new ApiError(403, msg, extra);

// Wrap an async route handler so thrown/rejected errors reach the error handler.
export const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

export function errorHandler(err, req, res, _next) {
  // Prisma known errors -> friendlier statuses
  if (err && err.code === 'P2025') {
    return res.status(404).json({ error: 'Record not found' });
  }
  if (err && err.code === 'P2002') {
    return res.status(409).json({ error: 'Unique constraint violation', fields: err.meta?.target });
  }
  const status = err.status || 500;
  if (status >= 500) {
    console.error('[error]', err);
  }
  const payload = { error: err.message || 'Internal server error' };
  if (err.extra) payload.extra_data = err.extra;
  res.status(status).json(payload);
}
