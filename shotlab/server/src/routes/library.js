import { Router } from 'express';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireSession } from '../middleware/auth.js';

const router = Router();

// Curated prompt in the frontend shape: { id, cats, en:{title,body}, ar:{title,body}, mine:false }
const serCurated = (p) => ({
  id: p.id,
  cats: p.cats,
  en: { title: p.titleEn, body: p.bodyEn },
  ar: { title: p.titleAr, body: p.bodyAr },
  fields: p.fields,
  mine: false,
});

// User template flattened the way allLibrary() expects: { id, cats, title, body, mine:true }
const serMine = (t) => ({ id: t.id, cats: t.cats, title: t.title, body: t.body, fields: t.fields, mine: true });

const matches = (p, q) => {
  const hay = [p.titleEn, p.bodyEn, p.titleAr, p.bodyAr].join('\n').toLowerCase();
  return hay.includes(q);
};
const matchesMine = (t, q) => (t.title + '\n' + t.body).toLowerCase().includes(q);

// Library is browsable by guests too (read-only). Guests just get the curated set.
router.get(
  '/',
  loadSession,
  requireSession,
  ah(async (req, res) => {
    const category = (req.query.category || 'all').toString();
    const q = (req.query.q || '').toString().trim().toLowerCase();
    const mineOnly = req.query.mine === 'true' || req.query.mine === '1';
    const favOnly = req.query.fav === 'true' || req.query.fav === '1';
    const isUser = !!req.userId;

    // Curated
    let curated = await prisma.libraryPrompt.findMany({ orderBy: { sort: 'asc' } });
    if (category !== 'all') curated = curated.filter((p) => p.cats.includes(category));
    if (q) curated = curated.filter((p) => matches(p, q));

    // User templates (only for signed-in users)
    let mine = [];
    if (isUser) {
      mine = await prisma.template.findMany({ where: { userId: req.userId }, orderBy: { createdAt: 'desc' } });
      if (category !== 'all') mine = mine.filter((t) => t.cats.includes(category) || (category === 'mine'));
      if (q) mine = mine.filter((t) => matchesMine(t, q));
    }

    let favorites = [];
    if (isUser) {
      const favRows = await prisma.favorite.findMany({ where: { userId: req.userId }, select: { promptId: true } });
      favorites = favRows.map((f) => f.promptId);
    }

    let prompts = [...mine.map(serMine), ...curated.map(serCurated)];
    if (mineOnly) prompts = prompts.filter((p) => p.mine);
    if (favOnly) prompts = prompts.filter((p) => favorites.includes(p.id));

    res.json({ prompts, favorites });
  })
);

export default router;
