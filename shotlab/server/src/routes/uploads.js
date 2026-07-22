import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { prisma } from '../db.js';
import { env } from '../env.js';
import { ah } from '../middleware/error.js';
import { loadSession, requireUser } from '../middleware/auth.js';
import { writeLimiter } from '../middleware/rateLimit.js';
import { badRequest } from '../lib/errors.js';
import { newFileId, saveFile } from '../services/storage.js';

const router = Router();

const IMAGE_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif']);
const VIDEO_MIME = new Set(['video/mp4', 'video/quicktime', 'video/webm']);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: env.maxUploadMb * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (IMAGE_MIME.has(file.mimetype) || VIDEO_MIME.has(file.mimetype)) return cb(null, true);
    cb(new Error('Unsupported file type. Upload an image or video.'));
  },
});

router.post(
  '/',
  loadSession,
  requireUser,
  writeLimiter,
  (req, res, next) =>
    upload.single('file')(req, res, (err) => (err ? next(badRequest(err.message)) : next())),
  ah(async (req, res) => {
    if (!req.file) throw badRequest('No file uploaded (field name must be "file").');
    const kind = IMAGE_MIME.has(req.file.mimetype) ? 'image' : 'video';
    const fileId = newFileId();
    const ext = path.extname(req.file.originalname) || '';
    const stored = await saveFile({ fileId, buffer: req.file.buffer, mimeType: req.file.mimetype, ext });

    const record = await prisma.upload.create({
      data: {
        userId: req.userId,
        fileId,
        kind,
        mimeType: req.file.mimetype,
        size: req.file.size,
        storage: stored.storage,
        path: stored.path,
        url: stored.url,
      },
    });
    res.status(201).json({ fileId: record.fileId, url: record.url, kind: record.kind });
  })
);

export default router;
