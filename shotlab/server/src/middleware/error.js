import { ZodError } from 'zod';
import { ApiError } from '../lib/errors.js';

export function notFoundHandler(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `No route for ${req.method} ${req.path}` } });
}

// Central error formatter — everything ends up as { error: { code, message, details? } }
export function errorHandler(err, _req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request body',
        details: err.errors.map((e) => ({ path: e.path.join('.'), message: e.message })),
      },
    });
  }
  if (err instanceof ApiError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) },
    });
  }
  // Multer / body-size style errors
  if (err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(400).json({ error: { code: 'FILE_TOO_LARGE', message: 'File exceeds the size limit' } });
  }
  console.error('[unhandled]', err);
  res.status(500).json({ error: { code: 'SERVER_ERROR', message: 'Internal server error' } });
}

// Wrap async route handlers so thrown errors reach errorHandler.
export const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
