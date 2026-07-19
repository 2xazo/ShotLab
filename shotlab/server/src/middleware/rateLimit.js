import rateLimit from 'express-rate-limit';

// Key by authenticated user when available, else by IP.
const keyByUser = (req) => req.userId || req.session?.sub || req.ip;

const jsonLimit = (message) => (_req, res) =>
  res.status(429).json({ error: { code: 'RATE_LIMITED', message } });

// AI routes are the expensive ones — tighter budget, per user.
export const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimit('AI rate limit reached. Try again in a minute.'),
});

// Auth routes — protect against brute force, per IP.
export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 40,
  standardHeaders: true,
  legacyHeaders: false,
  handler: jsonLimit('Too many auth attempts. Try again later.'),
});

// General write budget.
export const writeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: keyByUser,
  handler: jsonLimit('Too many requests.'),
});
