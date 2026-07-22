import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
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

// .../server/src -> repo root's web/ (frontend), served by this same process in production.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(__dirname, '../../web');
const hasWebDir = fs.existsSync(path.join(webDir, 'ShotLab.dc.html'));

export function createApp() {
  ensureUploadDir();
  const app = express();

  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  // CSP/COEP off: this app serves a self-booting HTML template that loads React
  // from a CDN and embeds cross-origin media — a strict default CSP would break it.
  // The other helmet defaults (X-Content-Type-Options, X-Frame-Options, HSTS, etc.)
  // still apply.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));
  app.use(express.json({ limit: '1mb' }));
  app.use(cookieParser());

  // CORS — reflect only allowed origins, allow credentials (cookies). Computed
  // per-request so genuinely same-origin calls (the merged prod deploy, where the
  // browser still sends an Origin header on POSTs even though it's the app's own
  // host) are always accepted without needing to be listed in CORS_ORIGIN.
  app.use((req, res, next) => {
    const selfOrigin = `${req.protocol}://${req.get('host')}`;
    return cors({
      origin(origin, cb) {
        // Allow same-origin/curl (no Origin header), the app's own origin, and exact
        // matches against the configured allow-list. Do NOT blanket-allow just because
        // 'null' is listed — that would only make sense as a match when the incoming
        // origin IS literally 'null'.
        if (!origin || origin === selfOrigin || env.corsOrigins.includes(origin)) {
          return cb(null, true);
        }
        return cb(new Error(`Origin ${origin} not allowed by CORS`));
      },
      credentials: true,
    })(req, res, next);
  });

  // Serve locally-stored uploads in dev.
  if (env.storageDriver === 'local') {
    app.use('/uploads', express.static(path.resolve(process.cwd(), env.uploadDir)));
  }

  // Curated, git-tracked media for the seeded library prompts (not user uploads).
  app.use('/library-media', express.static(path.resolve(process.cwd(), 'public/library')));

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

  // Serve the frontend from this same process/origin in production (single Render
  // service) — cookie-based auth is simplest and safest same-site. In local dev the
  // frontend runs separately via `web/serve.mjs`, so this is skipped if web/ isn't
  // reachable from here.
  if (hasWebDir) {
    app.use(express.static(webDir, { index: 'ShotLab.dc.html' }));
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
