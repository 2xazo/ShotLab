# ShotLab

A bilingual (EN/AR), light/dark, RTL-aware **prompt-engineering app for visual
creators**. Turn any idea, image or video into a professional AI image/video prompt
built on the **RCTCF** framework (Role · Context · Task · Constraints · Format).

```
shotlab/
├── web/                     # frontend (existing design) + API wiring
│   ├── ShotLab.dc.html      # the app (seams wired to the backend)
│   ├── shotlab-api.js       # window.SL — the API client
│   ├── support.js           # DC runtime (loads React, mounts the app)
│   ├── serve.mjs            # tiny static server (run over HTTP, not file://)
│   └── assets/
├── server/                  # backend (Node + Express + Prisma + OpenAI)
│   ├── src/                  routes · services · middleware · prompts
│   ├── prisma/               schema + seed
│   ├── data/seed-library.json
│   ├── test/api.mjs          44-check e2e suite
│   ├── docker-compose.yml · Dockerfile · .env.example
│   └── ShotLab.postman_collection.json
└── Start ShotLab.command    # double-click launcher (macOS)
```

## Run it

**Easiest:** double-click **`Start ShotLab.command`** (first run installs deps,
provisions the DB, seeds the library, then opens the app).

**Manual:**

```bash
# 1) backend
cd server
cp .env.example .env      # fill in OPENAI_API_KEY + DATABASE_URL (see server/README.md)
npm install && npm run setup && npm run dev     # → :4000

# 2) frontend (new terminal)
cd ../web && node serve.mjs                      # → :5173  (open this)
```

## What's wired

| Frontend seam | → Backend |
|---|---|
| `runModel` → Studio generate | `POST /ai/generate` |
| Lab score | `POST /ai/score` |
| Lab "Improve" | `POST /ai/improve` |
| `submitAuth` (login/signup) | `POST /auth/login` · `/auth/signup` |
| `submitReset` | `POST /auth/reset/request` |
| `socialSeam` (Google GIS) | `GET /auth/google/config` · `POST /auth/google` |
| `continueGuest` / `logout` | `POST /auth/guest` · `/auth/logout` |
| Studio file upload | `POST /uploads` → `fileId` |
| `saved` / `userTemplates` / `favs` / `history` | `/templates` · `/favorites` · `/history` |
| Library | `GET /library` (seeded from the frontend's own prompt set) |

Guests can browse the library only; every write/AI action is blocked server-side
(401/403) and the app shows its sign-up modal. Bilingual behavior is preserved:
library prompt **bodies stay English, only titles are localized**.

See **`server/README.md`** for the full API reference, env vars, and Docker.
