import { SESSION_COOKIE, verifySession } from '../lib/jwt.js';
import { unauthorized, forbidden } from '../lib/errors.js';

// Populates req.session = { role, sub?, name?, email? } from the httpOnly cookie.
// Never throws — downstream guards decide what a given route requires.
export function loadSession(req, _res, next) {
  const token = req.cookies?.[SESSION_COOKIE];
  req.session = token ? verifySession(token) : null;
  next();
}

// Requires a real authenticated user (not a guest, not anonymous).
export function requireUser(req, _res, next) {
  if (!req.session) return next(unauthorized());
  if (req.session.role === 'guest') {
    return next(forbidden('Guests cannot perform this action. Please sign up.'));
  }
  if (!req.session.sub) return next(unauthorized());
  req.userId = req.session.sub;
  next();
}

// Allows either a user or a guest (e.g. browsing the library).
export function requireSession(req, _res, next) {
  if (!req.session) return next(unauthorized());
  if (req.session.sub) req.userId = req.session.sub;
  next();
}
