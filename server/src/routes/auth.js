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
import { verifyGoogleCredential, findOrLinkGoogleUser } from '../services/googleAuth.js';

const router = Router();

const publicUser = (u) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  avatarUrl: u.avatarUrl,
  provider: u.provider,
  hasPassword: !!u.passwordHash,
});

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
    if (user) {
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

// ---------------- Google Identity Services ----------------
// The browser needs the Web Client ID to initialize GIS. Client IDs are public;
// secrets and other server configuration are never returned.
router.get('/google/config', (_req, res) => {
  res.json({
    configured: flags.hasGoogle,
    clientId: flags.hasGoogle ? env.googleClientId : null,
  });
});

const googleSchema = z.object({
  credential: z.string().trim().min(100).max(10_000),
});

router.post(
  '/google',
  authLimiter,
  ah(async (req, res) => {
    if (!flags.hasGoogle) {
      throw notImplemented('Google Sign-In is not configured.');
    }
    const { credential } = googleSchema.parse(req.body);
    const identity = await verifyGoogleCredential(credential);
    const user = await findOrLinkGoogleUser(identity);
    issueUserSession(res, user);
    res.json({ user: publicUser(user) });
  })
);

export default router;
