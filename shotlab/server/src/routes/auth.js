import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { prisma } from '../db.js';
import { env, flags } from '../env.js';
import { ah } from '../middleware/error.js';
import { authLimiter } from '../middleware/rateLimit.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { signSession, setSessionCookie, clearSessionCookie } from '../lib/jwt.js';
import { badRequest, unauthorized, conflict, notImplemented } from '../lib/errors.js';
import { sendResetEmail } from '../services/mailer.js';

const router = Router();

const publicUser = (u) => ({ id: u.id, name: u.name, email: u.email, avatarUrl: u.avatarUrl, provider: u.provider });

function issueUserSession(res, user) {
  const token = signSession({ sub: user.id, role: 'user', name: user.name, email: user.email });
  setSessionCookie(res, token);
}

// ---------------- signup ----------------
const signupSchema = z.object({
  name: z.string().trim().min(1).max(80),
  email: z.string().trim().email().max(200),
  password: z.string().min(6).max(200),
});

router.post(
  '/signup',
  authLimiter,
  ah(async (req, res) => {
    const { name, email, password } = signupSchema.parse(req.body);
    const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (existing) throw conflict('An account with that email already exists.');
    const passwordHash = await bcrypt.hash(password, 12);
    const user = await prisma.user.create({
      data: { name, email: email.toLowerCase(), passwordHash, provider: 'password' },
    });
    issueUserSession(res, user);
    res.status(201).json({ user: publicUser(user) });
  })
);

// ---------------- login ----------------
const loginSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
});

router.post(
  '/login',
  authLimiter,
  ah(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user || !user.passwordHash) throw unauthorized('Invalid email or password.');
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) throw unauthorized('Invalid email or password.');
    issueUserSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

// ---------------- logout ----------------
router.post(
  '/logout',
  ah(async (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  })
);

// ---------------- guest ----------------
router.post(
  '/guest',
  ah(async (_req, res) => {
    const token = signSession({ role: 'guest' });
    setSessionCookie(res, token);
    res.json({ guest: true });
  })
);

// ---------------- me ----------------
router.get(
  '/me',
  loadSession,
  ah(async (req, res) => {
    if (!req.session) return res.json({ user: null, guest: false });
    if (req.session.role === 'guest') return res.json({ user: null, guest: true });
    const user = await prisma.user.findUnique({ where: { id: req.session.sub } });
    if (!user) {
      clearSessionCookie(res);
      return res.json({ user: null, guest: false });
    }
    res.json({ user: publicUser(user), guest: false });
  })
);

// ---------------- password reset ----------------
const resetReqSchema = z.object({ email: z.string().trim().email() });

router.post(
  '/reset/request',
  authLimiter,
  ah(async (req, res) => {
    const { email } = resetReqSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    // Always respond 200 to avoid leaking which emails exist.
    if (user && user.passwordHash) {
      const raw = crypto.randomBytes(32).toString('hex');
      const tokenHash = crypto.createHash('sha256').update(raw).digest('hex');
      await prisma.passwordResetToken.create({
        data: { userId: user.id, tokenHash, expiresAt: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await sendResetEmail(user.email, raw);
    }
    res.json({ ok: true, message: 'If an account exists for that email, a reset link has been sent.' });
  })
);

const resetConfirmSchema = z.object({
  token: z.string().min(10),
  newPassword: z.string().min(6).max(200),
});

router.post(
  '/reset/confirm',
  authLimiter,
  ah(async (req, res) => {
    const { token, newPassword } = resetConfirmSchema.parse(req.body);
    const tokenHash = crypto.createHash('sha256').update(token).digest('hex');
    const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw badRequest('This reset link is invalid or has expired.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.$transaction([
      prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
      prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    ]);
    res.json({ ok: true });
  })
);

// ---------------- change password (signed-in) ----------------
const changePwSchema = z.object({
  currentPassword: z.string().min(1).optional(),
  newPassword: z.string().min(6).max(200),
});
router.post(
  '/change-password',
  loadSession,
  requireUser,
  ah(async (req, res) => {
    const { currentPassword, newPassword } = changePwSchema.parse(req.body);
    const user = await prisma.user.findUnique({ where: { id: req.userId } });
    if (user.passwordHash) {
      if (!currentPassword) throw badRequest('Current password is required.');
      const ok = await bcrypt.compare(currentPassword, user.passwordHash);
      if (!ok) throw unauthorized('Current password is incorrect.');
    }
    const passwordHash = await bcrypt.hash(newPassword, 12);
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
    res.json({ ok: true });
  })
);

// ---------------- update profile ----------------
const profileSchema = z.object({ name: z.string().trim().min(1).max(80) });
router.patch(
  '/profile',
  loadSession,
  requireUser,
  ah(async (req, res) => {
    const { name } = profileSchema.parse(req.body);
    const user = await prisma.user.update({ where: { id: req.userId }, data: { name } });
    res.json({ user: publicUser(user) });
  })
);

// ---------------- Google OAuth ----------------
router.get('/google', (req, res) => {
  if (!flags.hasGoogle) throw notImplemented('Google OAuth is not configured. Set GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET.');
  const state = crypto.randomBytes(16).toString('hex');
  res.cookie('sl_oauth_state', state, { httpOnly: true, sameSite: 'lax', maxAge: 10 * 60 * 1000, path: '/' });
  const params = new URLSearchParams({
    client_id: env.googleClientId,
    redirect_uri: env.googleCallbackUrl,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    access_type: 'offline',
    prompt: 'select_account',
  });
  res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
});

router.get(
  '/google/callback',
  ah(async (req, res) => {
    if (!flags.hasGoogle) throw notImplemented('Google OAuth is not configured.');
    const { code, state } = req.query;
    if (!code || !state || state !== req.cookies?.sl_oauth_state) {
      throw badRequest('Invalid OAuth state.');
    }
    res.clearCookie('sl_oauth_state', { path: '/' });

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: String(code),
        client_id: env.googleClientId,
        client_secret: env.googleClientSecret,
        redirect_uri: env.googleCallbackUrl,
        grant_type: 'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (!tokens.access_token) throw badRequest('Google token exchange failed.');

    const profRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await profRes.json();
    if (!profile.email) throw badRequest('Could not read Google profile.');

    const email = profile.email.toLowerCase();
    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      user = await prisma.user.create({
        data: {
          email,
          name: profile.name || email.split('@')[0],
          provider: 'google',
          providerId: profile.sub,
          avatarUrl: profile.picture || null,
        },
      });
    } else if (user.provider !== 'google') {
      user = await prisma.user.update({
        where: { id: user.id },
        data: { providerId: profile.sub, avatarUrl: user.avatarUrl || profile.picture || null },
      });
    }
    issueUserSession(res, user);
    res.redirect(env.oauthSuccessRedirect);
  })
);

export default router;
