import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { badRequest } from '../lib/errors.js';
import { imageReferenceUrl } from '../services/storage.js';
import { generatePrompt, scorePrompt, improvePrompt, customizePrompt } from '../services/llm.js';

const router = Router();
router.use(loadSession, requireUser); // all AI routes require a real user (guests get 403)

const langSchema = z.enum(['en', 'ar']).optional().default('en');

async function logHistory(userId, type, label) {
  await prisma.history.create({ data: { userId, type, label: String(label || '').slice(0, 200) } });
  // Cap at 60 most-recent per user.
  const extra = await prisma.history.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    skip: 60,
    select: { id: true },
  });
  if (extra.length) {
    await prisma.history.deleteMany({ where: { id: { in: extra.map((h) => h.id) } } });
  }
}

// ---------------- generate (Studio) ----------------
const generateSchema = z.object({
  inputType: z.enum(['text', 'image', 'video']),
  idea: z.string().max(2000).optional().default(''),
  fileId: z.string().optional(),
  attributes: z.record(z.string(), z.string()).optional().default({}),
  lang: langSchema,
});

router.post(
  '/generate',
  aiLimiter,
  ah(async (req, res) => {
    const { inputType, idea, fileId, attributes, lang } = generateSchema.parse(req.body);
    if (inputType === 'text' && !idea.trim()) throw badRequest('Please describe your idea.');

    let referenceName = '';
    let imageUrl = null;
    if (inputType !== 'text') {
      if (!fileId) throw badRequest(`A ${inputType} reference (fileId) is required.`);
      const upload = await prisma.upload.findFirst({ where: { fileId, userId: req.userId } });
      if (!upload) throw badRequest('Reference file not found.');
      // Never surface the internal fileId in the prompt; give the model the image itself.
      if (upload.kind === 'image') imageUrl = imageReferenceUrl(upload);
    }

    const result = await generatePrompt({ inputType, idea, attributes, referenceName, imageUrl, lang });
    await logHistory(req.userId, 'generate', idea || `${inputType} reference`);
    res.json({ prompt: result.prompt, source: result.source });
  })
);

// ---------------- score (Lab) ----------------
const scoreSchemaBody = z.object({
  prompt: z.string().min(1).max(6000),
  lang: langSchema,
});

router.post(
  '/score',
  aiLimiter,
  ah(async (req, res) => {
    const { prompt, lang } = scoreSchemaBody.parse(req.body);
    const result = await scorePrompt({ prompt, lang });
    await logHistory(req.userId, 'score', prompt.slice(0, 60));
    res.json({ total: result.total, elements: result.elements, source: result.source });
  })
);

// ---------------- improve (Lab) ----------------
router.post(
  '/improve',
  aiLimiter,
  ah(async (req, res) => {
    const { prompt, lang } = scoreSchemaBody.parse(req.body);
    const result = await improvePrompt({ prompt, lang });
    await logHistory(req.userId, 'improve', prompt.slice(0, 60));
    res.json(result);
  })
);

// ---------------- customize (Library: "with AI" / "to a specific platform") ----------------
const customizeSchemaBody = z.object({
  prompt: z.string().min(1).max(6000),
  instruction: z.string().max(500).optional().default(''),
  platform: z.string().max(60).optional().default(''),
  platformType: z.string().max(20).optional().default(''),
  lang: langSchema,
});

router.post(
  '/customize',
  aiLimiter,
  ah(async (req, res) => {
    const { prompt, instruction, platform, platformType, lang } = customizeSchemaBody.parse(req.body);
    if (!instruction.trim() && !platform.trim()) throw badRequest('Provide an instruction or a target platform.');
    const result = await customizePrompt({
      prompt,
      instruction: instruction.trim(),
      platform: platform.trim() ? { name: platform.trim(), type: platformType } : null,
      lang,
    });
    await logHistory(req.userId, 'customize', platform || instruction.slice(0, 60));
    res.json({ prompt: result.prompt, source: result.source });
  })
);

export default router;
