// Tiny static server for the ShotLab frontend. Serving over HTTP (not file://)
// is required so cookies + fetch to the API work.
//   node serve.mjs           → http://localhost:5173
//   PORT=3000 node serve.mjs
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const PORT = parseInt(process.env.PORT || '5173', 10);
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
  '.json': 'application/json',
};

http
  .createServer((req, res) => {
    let p = decodeURIComponent(req.url.split('?')[0]);
    if (p === '/') p = '/ShotLab.dc.html';
    const fp = path.join(DIR, p);
    if (!fp.startsWith(DIR) || !fs.existsSync(fp) || fs.statSync(fp).isDirectory()) {
      res.writeHead(404);
      return res.end('Not found');
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(fp)] || 'application/octet-stream' });
    fs.createReadStream(fp).pipe(res);
  })
  .listen(PORT, () => {
    console.log(`\n  ShotLab frontend  →  http://localhost:${PORT}\n  (make sure the API is running on http://localhost:4000)\n`);
  });
