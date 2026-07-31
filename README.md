# Wordle Unlimited

The game engine behind [wordleunlimited.dev](https://wordleunlimited.dev) — a free,
unlimited word game with Daily, Unlimited, Time, Topic and live Multiplayer modes,
in English, British English and Indonesian.

Rebuilt from the WordPress version as a self-contained Node service: static HTML
for the content pages (fast, crawlable), a vanilla-JS game engine (no framework,
no hydration) and a Fastify server handling the API, admin panel and WebSocket
multiplayer.

---

## Quick start

```bash
npm install
node scripts/fetch-reference.mjs   # one-off: caches reference dictionaries
npm run build                      # generates word lists + precompresses assets
npm run dev                        # http://localhost:3000
```

The database is optional in development — without `DATABASE_URL` the site runs on
built-in defaults and reads topic packs straight from `public/src/topics/`.

---

## Layout

```
server/
  index.js            Fastify bootstrap: CSP, static, rate limits, shutdown
  config.js           env → typed config, fails fast on a missing prod secret
  db/                 pg pool + idempotent SQL migrations
  lib/
    words.js          dictionaries in memory; guess validation and scoring
    settings.js       runtime settings cache backed by admin_settings
    topics.js         topic packs: DB-first, JSON-pack fallback
    crypto.js         scrypt password hashing + signed session tokens
  realtime/
    room.js           one authoritative match state machine
    hub.js            room registry, open-room reveal, WebSocket endpoint
  routes/             api.js · admin.js · pages.js
public/
  index.html          English landing page + game
  wordle-uk/          British English
  id/                 Bahasa Indonesia
  admin/              admin panel shell
  src/
    wordle.css        the game's styles
    wordle.js         the game engine
    dict/<region>/    generated word lists — do not edit by hand
    topics/*.json     topic packs
data/                 editable lexicons (the source of truth for words)
scripts/              build + maintenance scripts
```

---

## Word lists

Word lists are **generated**, never edited directly. The source of truth is the
plain-text lexicons in `data/`:

| File | Purpose |
|---|---|
| `en-core.txt`, `en-core-long.txt` | curated English answers (3–7 letters) |
| `uk-extra.txt` | British spellings and dialect the transforms can't derive |
| `id-core.txt` | Indonesian answers, KBBI *baku* forms only |
| `en-allow.txt` | valid modern words the reference dictionary lacks |
| `blocklist.txt` | profanity, slurs, proper nouns — never chosen or accepted |

To add words, edit the relevant file and re-run:

```bash
npm run words
```

Every curated word is spell-checked against a cached reference dictionary, so a
typo becomes a build warning instead of an unguessable puzzle. Words are filed by
their **actual** length, so putting a word in the wrong section is harmless.

Two helper scripts:

```bash
node scripts/fetch-reference.mjs      # refresh the cached reference dictionaries
node scripts/find-truncations.mjs en  # flag likely typos in a curated list
```

### Answers vs accepted guesses

- `<len>.txt` — words the game may **choose**. Curated and common.
- `extended-<len>.txt` — words the game will **accept** as a guess. Comprehensive.

Being generous about what we accept and strict about what we choose is what stops
"not in word list" from being annoying.

---

## Configuration

Copy `.env.example` to `.env`. The values that matter:

| Variable | Notes |
|---|---|
| `SITE_URL` | canonical origin — drives sitemap, OG tags, challenge links |
| `DATABASE_URL` | PostgreSQL. Omit to run on defaults |
| `SESSION_SECRET` | **required in production**; signs the admin cookie |
| `ADMIN_USER` / `ADMIN_PASSWORD_HASH` | `/admin` login |
| `GOOGLE_CLIENT_ID` | Drive appData cloud save; safe to expose |
| `TRUST_PROXY` | `1` behind Coolify's Traefik, so rate limits see real IPs |

Generate the admin credentials:

```bash
node scripts/hash-password.mjs "your admin password"
```

---

## Deploying to Coolify

1. New resource → **Docker Compose** → this repository.
2. Set the environment variables above (`POSTGRES_PASSWORD` too).
3. Point `wordleunlimited.dev` at the `app` service, port `3000`.
4. Deploy. Migrations and topic seeding run automatically at boot.

The image is multi-stage: word generation and asset compression happen at build
time, so the runtime container only serves bytes. Health check is `/healthz`.

Maintenance mode is a toggle in `/admin` — it returns 503 with a branded page
and `Disallow: /` in robots.txt, while leaving `/admin` reachable so you can turn
it back off.

---

## Performance notes

Choices made specifically to keep CPU low under traffic:

- **No framework on the client.** The content pages are static HTML; the game is
  one vanilla JS file. Nothing to hydrate.
- **Assets are pre-compressed at build time** to `.br`/`.gz` siblings, so the
  server streams bytes instead of compressing per request.
- **Immutable asset caching** with a content-hash `?v=` stamp, so repeat visits
  and CDN hits cost nothing.
- **One global 1/2-second tick** drives every multiplayer room, rather than a
  timer per room.
- **Leaderboard broadcasts are batched and serialised once** per room, not once
  per socket — the difference between 1 and 50 JSON encodes for a full room.
- **`perMessageDeflate` is off** on WebSockets; room frames are small and
  compressing them costs more CPU and memory than it saves.
- Dictionaries load once at boot and are shared by every room.

---

## Multiplayer

Answers live **on the server**. Clients receive the word's length and any clue,
then send guesses to be validated and scored — otherwise the answer would be
readable in devtools.

- **Open rooms** run continuously, CS-style: vote → play → results → vote.
  Room 1 is always listed; room N+1 is only revealed once room N is 80% full,
  up to 5 rooms of 50 players. A room with players in it always stays visible.
- **Custom rooms** are created via `POST /api/rooms` and shared by link.
  They start when two players are in.
- Formats are `race` (first to N words) and `timed` (most words before the clock).
