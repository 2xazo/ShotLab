import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '../db.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { aiLimiter } from '../middleware/rateLimit.js';
import { badRequest } from '../lib/errors.js';
import { imageReferenceUrl } from '../services/storage.js';
import { generatePrompt, scorePrompt, improvePrompt, customizePrompt, optimizePrompt } from '../services/llm.js';

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

// ---------------- customize an existing prompt ----------------
const customizeSchema = z.object({
  originalPrompt: z.string().trim().min(1).max(6000),
  changeRequest: z.string().trim().min(1).max(2000),
  additionalInstructions: z.string().trim().max(2000).optional().default(''),
  language: langSchema,
});

router.post(
  '/customize',
  aiLimiter,
  ah(async (req, res) => {
    const input = customizeSchema.parse(req.body);
    const result = await customizePrompt(input);
    await logHistory(req.userId, 'improve', input.changeRequest.slice(0, 120));
    res.json({ success: true, prompt: result.prompt });
  })
);

// ---------------- optimize for a target platform ----------------
const platforms = [
  'chatgpt',
  'claude',
  'gemini',
  'midjourney',
  'flux',
  'dalle',
  'stable-diffusion',
  'veo',
  'sora',
  'runway',
  'kling',
];
const optimizeSchema = z.object({
  originalPrompt: z.string().trim().min(1).max(6000),
  platform: z.enum(platforms),
  outputType: z.enum(['auto', 'text', 'image', 'video']).default('auto'),
  optimizationLevel: z.enum(['balanced', 'concise', 'detailed', 'creative', 'professional']).default('balanced'),
  language: langSchema,
});

router.post(
  '/optimize-platform',
  aiLimiter,
  ah(async (req, res) => {
    const input = optimizeSchema.parse(req.body);
    const result = await optimizePrompt(input);
    await logHistory(req.userId, 'improve', `${input.platform}: ${input.originalPrompt.slice(0, 100)}`);
    res.json({ success: true, prompt: result.prompt });
  })
);

export default router;
