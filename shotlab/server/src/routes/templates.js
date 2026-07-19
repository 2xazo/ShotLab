import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { notFound } from '../lib/errors.js';

const router = Router();
router.use(loadSession, requireUser);

// Serialize to the exact shape the frontend `sl_templates` items use, plus a
// numeric `ts` so the existing timeAgo()/sort logic keeps working untouched.
const ser = (t) => ({
  id: t.id,
  title: t.title,
  body: t.body,
  source: t.source,
  cats: t.cats,
  fields: t.fields,
  fieldVals: t.fieldVals,
  ts: t.createdAt.getTime(),
});

router.get(
  '/',
  ah(async (req, res) => {
    const rows = await prisma.template.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } });
    res.json({ templates: rows.map(ser) });
  })
);

const upsertSchema = z.object({
  title: z.string().trim().min(1).max(160),
  body: z.string().min(1).max(6000),
  source: z.string().max(40).optional().default('mine'),
  cats: z.array(z.string()).optional().default([]),
  fields: z.array(z.string()).optional().default([]),
  fieldVals: z.record(z.string(), z.string()).optional().default({}),
});

router.post(
  '/',
  writeLimiter,
  ah(async (req, res) => {
    const data = upsertSchema.parse(req.body);
    const row = await prisma.template.create({ data: { ...data, userId: req.userId } });
    res.status(201).json({ template: ser(row) });
  })
);

const patchSchema = upsertSchema.partial();

router.patch(
  '/:id',
  writeLimiter,
  ah(async (req, res) => {
    const data = patchSchema.parse(req.body);
    const existing = await prisma.template.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw notFound('Template not found.');
    const row = await prisma.template.update({ where: { id: existing.id }, data });
    res.json({ template: ser(row) });
  })
);

router.delete(
  '/:id',
  writeLimiter,
  ah(async (req, res) => {
    const existing = await prisma.template.findFirst({ where: { id: req.params.id, userId: req.userId } });
    if (!existing) throw notFound('Template not found.');
    await prisma.template.delete({ where: { id: existing.id } });
    res.json({ ok: true });
  })
);

export default router;
