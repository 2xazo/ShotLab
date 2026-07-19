import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import { env, flags } from './env.js';
import { notFoundHandler, errorHandler } from './middleware/error.js';
import { ensureUploadDir } from './services/storage.js';

import authRoutes from './routes/auth.js';
import aiRoutes from './routes/ai.js';
import uploadRoutes from './routes/uploads.js';
import templateRoutes from './routes/templates.js';
import savedRoutes from './routes/saved.js';
import favoriteRoutes from './routes/favorites.js';
import historyRoutes from './routes/history.js';
import libraryRoutes from './routes/library.js';
import promptShowcaseRoutes from './routes/promptShowcase.js';

export function createApp() {
  ensureUploadDir();
  const app = express();

  app.set('trust proxy', 1);
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CORS — reflect only allowed origins, allow credentials (cookies).
  app.use(
    cors({
      origin(origin, cb) {
        // allow same-origin / curl (no Origin header) and configured origins
        if (!origin || env.corsOrigins.includes(origin) || (origin === 'null' && env.corsOrigins.includes('null'))) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })
  );

  // Serve locally-stored uploads in dev.
  if (env.storageDriver === 'local') {
    app.use('/uploads', express.static(path.resolve(process.cwd(), env.uploadDir)));
  }

  app.get('/health', (_req, res) =>
    res.json({
      ok: true,
      provider: env.llmProvider,
      llm: flags.hasLLM,
      email: flags.hasSMTP,
      google: flags.hasGoogle,
      storage: env.storageDriver,
    })
  );

  app.use('/auth', authRoutes);
  app.use('/ai', aiRoutes);
  app.use('/uploads', uploadRoutes); // POST /uploads (static GET handled above)
  app.use('/templates', templateRoutes);
  app.use('/saved', savedRoutes);
  app.use('/favorites', favoriteRoutes);
  app.use('/history', historyRoutes);
  app.use('/library', libraryRoutes);
  app.use(promptShowcaseRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
