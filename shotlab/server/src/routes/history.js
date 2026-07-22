import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.use(loadSession, requireUser);

// Matches the frontend `sl_history` item shape: { id, type, label, ts }.
const ser = (h) => ({ id: h.id, type: h.type, label: h.label, ts: h.createdAt.getTime() });

const HISTORY_CAP = 60;

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await prisma.history.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_CAP,
    });
    res.json({ history: rows.map(ser) });
  })
);

const createSchema = z.object({
  type: z.enum(['generate', 'score', 'improve', 'save', 'platform']),
  label: z.string().max(200).default(''),
});

router.post(
  '/',
  writeLimiter,
  ah(async (req, res) => {
    const { type, label } = createSchema.parse(req.body);
    const row = await prisma.history.create({ data: { userId: req.userId, type, label } });
    // Trim to the most-recent 60.
    const extra = await prisma.history.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      skip: HISTORY_CAP,
      select: { id: true },
    });
    if (extra.length) await prisma.history.deleteMany({ where: { id: { in: extra.map((h) => h.id) } } });
    res.status(201).json({ item: ser(row) });
  })
);

router.delete(
  '/',
  writeLimiter,
  ah(async (req, res) => {
    await prisma.history.deleteMany({ where: { userId: req.userId } });
    res.json({ ok: true });
  })
);

export default router;
