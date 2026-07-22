// Seeds the curated library from data/seed-library.json (copied verbatim from
// the frontend `library` array — EN/AR titles, English + Arabic bodies).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

async function main() {
  const file = path.join(__dirname, '..', 'data', 'seed-library.json');
  const items = JSON.parse(fs.readFileSync(file, 'utf8'));

  let n = 0;
  for (const [i, p] of items.entries()) {
    // Library bodies stay English; only titles are localized. For entries that
    // ship an Arabic body use it, otherwise fall back to the English body.
    const bodyEn = p.en?.body ?? p.body ?? '';
    const row = {
      cats: p.cats || [],
      titleEn: p.en?.title ?? p.title ?? '',
      bodyEn,
      titleAr: p.ar?.title ?? p.en?.title ?? p.title ?? '',
      bodyAr: p.ar?.body ?? bodyEn,
      fields: p.fields || [],
      sort: i,
    };
    await prisma.libraryPrompt.upsert({
      where: { id: p.id },
      update: row,
      create: { id: p.id, ...row },
    });
    n++;
  }
  console.log(`Seeded ${n} curated library prompts.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
