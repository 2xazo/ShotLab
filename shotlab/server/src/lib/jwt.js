import jwt from 'jsonwebtoken';
import { env } from '../env.js';

export const SESSION_COOKIE = 'sl_session';

// Sessions come in two flavours:
//   - user  : { sub: userId, role: 'user',  name, email }
//   - guest : { role: 'guest' }  (no DB row, browse-only)
export function signSession(payload) {
  return jwt.sign(payload, env.jwtSecret, { expiresIn: env.accessTokenTtl });
}

export function verifySession(token) {
  try {
    return jwt.verify(token, env.jwtSecret);
  } catch {
    return null;
  }
}

export function cookieOptions() {
  return {
    httpOnly: true,
    secure: env.cookieSecure,
    sameSite: env.cookieSecure ? 'none' : 'lax',
    domain: env.cookieDomain,
    path: '/',
    maxAge: 1000 * 60 * 60 * 24 * 30, // 30 days
  };
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, cookieOptions());
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}
