import { createHash } from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { Router } from 'express';
import { ah } from '../middleware/error.js';
import { notFound } from '../lib/errors.js';

const DEFAULT_ROOT = fileURLToPath(new URL('../../../prompt-library/', import.meta.url));
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif']);
const VIDEO_EXTS = new Set(['.mp4', '.webm', '.mov']);
const OUTPUT_EXTS = new Set([...IMAGE_EXTS, ...VIDEO_EXTS, '.html']);
const SAFE_ASSET_EXTS = new Set([
  ...OUTPUT_EXTS,
  '.css',
  '.js',
  '.json',
  '.svg',
  '.woff',
  '.woff2',
  '.ttf',
  '.ico',
  '.webp',
  '.avif',
  '.download',
]);
const MIME = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.avif': 'image/avif',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mov': 'video/quicktime',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
};

const rootDir = path.resolve(process.env.PROMPT_LIBRARY_DIR || DEFAULT_ROOT);
const stableId = (name) => createHash('sha256').update(name.normalize('NFC')).digest('hex').slice(0, 16);
const publicPath = (id, relativePath) =>
  `/showcase-assets/${encodeURIComponent(id)}/${relativePath.split(path.sep).map(encodeURIComponent).join('/')}`;
const inside = (root, target) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

function outputType(file) {
  const ext = path.extname(file).toLowerCase();
  if (IMAGE_EXTS.has(ext)) return 'image';
  if (VIDEO_EXTS.has(ext)) return 'video';
  if (ext === '.html') return 'html';
  return null;
}

function chooseOutput(files) {
  const valid = files
    .filter((f) => f.isFile() && !f.name.startsWith('.') && OUTPUT_EXTS.has(path.extname(f.name).toLowerCase()))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
  const startsOutput = (f) => path.parse(f.name).name.toLowerCase().startsWith('output');
  return (
    valid.find((f) => startsOutput(f) && VIDEO_EXTS.has(path.extname(f.name).toLowerCase())) ||
    valid.find((f) => startsOutput(f) && IMAGE_EXTS.has(path.extname(f.name).toLowerCase())) ||
    valid.find((f) => f.name.toLowerCase() === 'output.html') ||
    valid[0] ||
    null
  );
}

async function findFallback(folder, outputName) {
  const candidates = [`${path.parse(outputName).name}_files`, 'output_files'];
  for (const candidate of candidates) {
    const dir = path.join(folder, candidate);
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    const image = entries
      .filter((entry) => entry.isFile() && IMAGE_EXTS.has(path.extname(entry.name).toLowerCase()))
      .sort((a, b) => a.name.localeCompare(b.name))[0];
    if (image) return path.join(candidate, image.name);
  }
  return null;
}

export async function loadShowcase() {
  let folders;
  try {
    folders = await fs.readdir(rootDir, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const items = [];
  for (const folderEntry of folders.sort((a, b) => a.name.localeCompare(b.name, 'ar'))) {
    if (!folderEntry.isDirectory() || folderEntry.name.startsWith('.')) continue;
    const folder = path.join(rootDir, folderEntry.name);
    try {
      const files = await fs.readdir(folder, { withFileTypes: true });
      const promptEntry =
        files.find((f) => f.isFile() && f.name.toLowerCase() === 'prompt.txt') ||
        files.find((f) => f.isFile() && f.name.toLowerCase() === 'prombt.txt');
      const outputEntry = chooseOutput(files);
      if (!promptEntry || !outputEntry) {
        console.warn(
          `[prompt-showcase] Skipping "${folderEntry.name}": ${!promptEntry ? 'prompt.txt/prombt.txt missing' : 'supported output missing'}`
        );
        continue;
      }
      const prompt = (await fs.readFile(path.join(folder, promptEntry.name), 'utf8')).replace(/^\uFEFF/, '').trim();
      if (!prompt) {
        console.warn(`[prompt-showcase] Skipping "${folderEntry.name}": prompt is empty`);
        continue;
      }
      const id = stableId(folderEntry.name);
      const type = outputType(outputEntry.name);
      const fallback = type === 'html' ? await findFallback(folder, outputEntry.name) : null;
      items.push({
        id,
        title: folderEntry.name,
        prompt,
        promptPreview: prompt.replace(/\s+/g, ' ').slice(0, 220),
        outputType: type,
        outputUrl: publicPath(id, outputEntry.name),
        fallbackPreviewUrl: fallback ? publicPath(id, fallback) : null,
      });
    } catch (error) {
      console.warn(`[prompt-showcase] Skipping "${folderEntry.name}": ${error.message}`);
    }
  }
  return items;
}

async function itemDirectory(id) {
  const folders = await fs.readdir(rootDir, { withFileTypes: true });
  const match = folders.find((entry) => entry.isDirectory() && !entry.name.startsWith('.') && stableId(entry.name) === id);
  return match ? path.join(rootDir, match.name) : null;
}

function sanitizedHtml(source) {
  return source
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, '')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '')
    .replace(/<meta\b[^>]*(?:og-profile-acct|google-signin)[^>]*>/gi, '')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[redacted]')
    .replace(/(<[^>]+\bclass="[^"]*\bgb_g\b[^"]*"[^>]*>)[\s\S]*?(<\/[^>]+>)/gi, '$1[redacted]$2')
    .replace(/\s(?:on\w+|srcdoc|data-email|data-name)\s*=\s*(?:"[^"]*"|'[^']*')/gi, '')
    .replace(
      /<\/head>/i,
      '<style>.gb_X,.gb_Zc,.gb_g,[aria-label*="Google Account"],[data-email]{display:none!important}</style></head>'
    );
}

const router = Router();

router.get(
  '/api/prompt-showcase',
  ah(async (_req, res) => {
    const items = await loadShowcase();
    res.set('Cache-Control', 'no-cache');
    res.json({ items });
  })
);

router.get(
  '/showcase-assets/:id/*',
  ah(async (req, res) => {
    const base = await itemDirectory(req.params.id);
    if (!base) throw notFound('Showcase asset not found');

    const raw = req.params[0] || '';
    const parts = raw.split(/[\\/]+/).filter(Boolean);
    if (
      !parts.length ||
      parts.some((part) => part === '.' || part === '..' || part.startsWith('.') || part.includes('\0')) ||
      ['prompt.txt', 'prombt.txt', 'thumbs.db', '.ds_store'].includes(parts.at(-1).toLowerCase())
    ) {
      throw notFound('Showcase asset not found');
    }

    const target = path.resolve(base, ...parts);
    const [realRoot, realTarget] = await Promise.all([
      fs.realpath(base),
      fs.realpath(target).catch(() => null),
    ]);
    if (!realTarget || !inside(realRoot, realTarget)) throw notFound('Showcase asset not found');

    const stat = await fs.stat(realTarget);
    if (!stat.isFile()) throw notFound('Showcase asset not found');
    const ext = path.extname(realTarget).toLowerCase();
    const inOutputFiles = parts.slice(0, -1).some((part) => part.toLowerCase().endsWith('_files'));
    if (!SAFE_ASSET_EXTS.has(ext) && !(inOutputFiles && ext === '')) throw notFound('Showcase asset not found');

    res.set('X-Content-Type-Options', 'nosniff');
    if (ext === '.html') {
      const html = await fs.readFile(realTarget, 'utf8');
      res.set({
        'Content-Type': MIME[ext],
        'Cache-Control': 'no-store',
        'Content-Security-Policy':
          "default-src 'none'; style-src 'unsafe-inline' https:; img-src 'self' data: https:; font-src data: https:; media-src 'self' data: https:; script-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'; base-uri 'self'",
      });
      return res.send(sanitizedHtml(html));
    }

    res.type(MIME[ext] || 'application/octet-stream');
    res.set('Cache-Control', 'public, max-age=3600');
    return res.sendFile(realTarget, { acceptRanges: true });
  })
);

export default router;
