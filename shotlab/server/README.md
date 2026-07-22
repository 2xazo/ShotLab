# ShotLab — Backend

Backend + AI for **ShotLab**, a bilingual (EN/AR) prompt-engineering app for visual
creators. It powers Studio (generate a structured RCTCF prompt), Lab (score /25 +
improve), the prompt Library, per-user data, and auth — for the existing
`web/ShotLab.dc.html` frontend.

- **Stack:** Node.js + Express, PostgreSQL (Prisma), JWT httpOnly-cookie sessions.
- **AI:** swappable provider (OpenAI default, Anthropic optional) with deterministic
  heuristic fallbacks so nothing hard-fails when a key is missing.
- **Framework:** every generated / scored prompt uses **RCTCF** — Role · Context ·
  Task · Constraints · Format.

---

## 1. Quick start

```bash
cd server
cp .env.example .env        # then fill in the values (see §3)
npm install
npm run setup               # prisma generate + db push + seed library
npm run dev                 # → http://localhost:4000
```

Check it's alive:

```bash
curl localhost:4000/health
```

Run the frontend against it (separate terminal):

```bash
cd ../web && node serve.mjs   # → http://localhost:5173
```

Or from the project root just double-click **`Start ShotLab.command`**.

### Run the test suite

With the server running:

```bash
npm test        # 44 end-to-end checks incl. guest-blocking + cross-user isolation
```

---

## 2. Run with Docker

```bash
cd server
cp .env.example .env         # fill in OPENAI_API_KEY etc.
docker compose up --build
```

This starts Postgres **and** the API (the API container runs `prisma db push`,
seeds, then boots). If you use a hosted DB instead (Supabase/Neon), set
`DATABASE_URL`/`DIRECT_URL` in `.env` and run only `docker compose up api`.

---

## 3. Environment variables

See `.env.example` for the annotated list. The important ones:

| Var | Meaning |
|---|---|
| `DATABASE_URL` / `DIRECT_URL` | Postgres connection. ShotLab keeps its tables in a dedicated **`shotlab`** schema (via `?schema=shotlab`) so it can share a database with other apps. `DIRECT_URL` is used only for migrations. |
| `JWT_SECRET` | Signs session cookies. Use a long random string. |
| `CORS_ORIGIN` | Comma-separated allowed frontend origins. |
| `LLM_PROVIDER` | `openai` (default) or `anthropic`. |
| `OPENAI_API_KEY` / `OPENAI_MODEL` | Model key + model id (default `gpt-4o-mini`). |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | Only if `LLM_PROVIDER=anthropic`. |
| `SMTP_*`, `MAIL_FROM`, `APP_URL` | Password-reset email. **If `SMTP_HOST` is empty, the reset link is logged to the server console** (dev mode). |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | "Continue with Google". Leave blank to disable — the endpoint returns `501` until set. Redirect URI must be `<API>/auth/google/callback`. |
| `STORAGE_DRIVER` | `local` (disk, dev) or `s3` (S3-compatible). |

> **Credentials to provide:** the model API key (OpenAI), and — only if you want
> those features — SMTP creds (email reset) and Google OAuth client id/secret.
> Everything else has working defaults.

---

## 4. API reference

Consistent error shape everywhere: `{ "error": { "code", "message", "details"? } }`.
Auth is a JWT in an httpOnly cookie (`sl_session`); send credentials with each request.

### Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/auth/signup` | `{name,email,password}` | bcrypt hash, issues session |
| POST | `/auth/login` | `{email,password}` | |
| POST | `/auth/logout` | | clears cookie |
| POST | `/auth/guest` | | browse-only guest session |
| GET | `/auth/me` | | `{user, guest}` |
| POST | `/auth/reset/request` | `{email}` | always 200; emails/logs a link |
| POST | `/auth/reset/confirm` | `{token,newPassword}` | |
| POST | `/auth/change-password` | `{currentPassword?,newPassword}` | signed-in |
| PATCH | `/auth/profile` | `{name}` | |
| GET | `/auth/google` → `/auth/google/callback` | | OAuth2 |

### AI (require a real user — guests get 403)
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/ai/generate` | `{inputType:'text'|'image'|'video', idea, fileId?, attributes{}, lang}` | `{prompt, source}` |
| POST | `/ai/score` | `{prompt, lang}` | `{total:0-25, elements:[{key,score,reason,fix,example}], source}` |
| POST | `/ai/improve` | `{prompt, lang}` | `{before, after, beforeScore, afterScore, source}` |

`source` is `"model"` or `"heuristic"`. Rate-limited per user.

### Uploads
| Method | Path | Body | Returns |
|---|---|---|---|
| POST | `/uploads` | multipart `file` (image/video, MIME+size validated) | `{fileId, url, kind}` |

Reference by `fileId` in `/ai/generate`. Local files are served at `/uploads/<file>`.

### Data (per authenticated user)
| Method | Path | Notes |
|---|---|---|
| GET/POST | `/templates`, PATCH/DELETE `/templates/:id` | `{id,title,body,source,cats,fields,fieldVals,ts}` |
| GET/POST | `/saved`, DELETE `/saved/:id` | `{id,title,body,source,ts}` |
| GET | `/favorites`, POST/DELETE `/favorites/:promptId` | array of prompt ids |
| GET/POST | `/history`, DELETE `/history` | `{id,type,label,ts}`, capped 60 |
| GET | `/library?category=&q=&mine=&fav=` | curated seed + your templates |

Import `ShotLab.postman_collection.json` into Postman/Thunder Client to try them all.

---

## 5. How the frontend points at the API

The frontend loads `web/shotlab-api.js` (defines `window.SL`) before the runtime.
It defaults to `http://localhost:4000`. To change it, set a global **before** the
scripts load, e.g. in `ShotLab.dc.html`:

```html
<script>window.SHOTLAB_API = "https://api.yourdomain.com";</script>
```

Make sure that origin is listed in `CORS_ORIGIN` and that `COOKIE_SECURE=true`
in production (HTTPS) so the session cookie is `Secure; SameSite=None`.

---

## 6. Notes / decisions

- **Schema isolation:** all tables live in the `shotlab` Postgres schema — safe to
  point `DATABASE_URL` at a shared database.
- **Saved vs. My-templates:** the frontend links these two lists by a shared id, so
  both are backed by the single `templates` table (the `saved` list is a derived
  view). The standalone `/saved` table + endpoints are also provided for
  completeness.
- **History:** Studio/Lab actions (`generate`/`score`/`improve`) are auto-logged
  server-side; the client logs `save`/`platform`. Capped at 60 per user.
- **Migrations:** `npm run db:push` is the quick path. For versioned SQL migrations
  use `npm run db:migrate` (needs `DIRECT_URL`).
