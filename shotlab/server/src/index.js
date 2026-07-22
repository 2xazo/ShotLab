import { createApp } from './app.js';
import { env, flags } from './env.js';
import { prisma, disconnect } from './db.js';

const app = createApp();

const server = app.listen(env.port, () => {
  console.log(`\n  ShotLab API  →  http://localhost:${env.port}`);
  console.log(`  env          →  ${env.nodeEnv}`);
  console.log(`  llm          →  ${env.llmProvider} ${flags.hasLLM ? '(key set)' : '(no key — heuristic fallback)'}`);
  console.log(`  email        →  ${flags.hasSMTP ? 'SMTP' : 'dev console'}`);
  console.log(`  google oauth →  ${flags.hasGoogle ? 'enabled' : 'disabled'}`);
  console.log(`  storage      →  ${env.storageDriver}\n`);
});

async function shutdown(sig) {
  console.log(`\n${sig} received, shutting down...`);
  server.close();
  await disconnect();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// Fail fast if the DB is unreachable at boot (clear message for setup issues).
prisma
  .$queryRaw`SELECT 1`
  .then(() => console.log('  db           →  connected'))
  .catch((e) => console.error('  db           →  NOT connected:', e.message));
