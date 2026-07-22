import { Router } from 'express';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';

const router = Router();
router.use(loadSession, requireUser);

// Returns a flat array of promptIds to mirror the frontend `sl_favs` shape.
router.get(
  '/',
  ah(async (req, res) => {
    const rows = await prisma.favorite.findMany({
      where: { userId: req.userId },
      orderBy: { createdAt: 'desc' },
      select: { promptId: true },
    });
    res.json({ favorites: rows.map((r) => r.promptId) });
  })
);

router.post(
  '/:promptId',
  writeLimiter,
  ah(async (req, res) => {
    const promptId = req.params.promptId;
    await prisma.favorite.upsert({
      where: { userId_promptId: { userId: req.userId, promptId } },
      create: { userId: req.userId, promptId },
      update: {},
    });
    res.status(201).json({ ok: true, promptId });
  })
);

router.delete(
  '/:promptId',
  writeLimiter,
  ah(async (req, res) => {
    await prisma.favorite.deleteMany({ where: { userId: req.userId, promptId: req.params.promptId } });
    res.json({ ok: true });
  })
);

export default router;
