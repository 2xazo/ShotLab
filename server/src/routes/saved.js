import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../lib/errors.js';

const router = Router();
router.use(loadSession, requireUser);

// Matches the frontend `sl_saved` item shape: { id, title, body, source, ts }.
const ser = (s) => ({ id: s.id, title: s.title, body: s.body, source: s.source, ts: s.createdAt.getTime() });

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await prisma.savedPrompt.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } });
    res.json({ saved: rows.map(ser) });
  })
);

const createSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().min(1).max(6000),
  source: z.string().max(40).optional().default('studio'),
});

router.post(
  '/',
  writeLimiter,
  ah(async (req, res) => {
    const data = createSchema.parse(req.body);
    const row = await prisma.savedPrompt.create({ data: { ...data, userId: req.userId } });
    res.status(201).json({ saved: ser(row) });
  })
);

router.delete(
  '/:id',
  writeLimiter,
  ah(async (req, res) => {
    const existing = await prisma.savedPrompt.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw notFound('Saved prompt not found.');
    await prisma.savedPrompt.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

export default router;
