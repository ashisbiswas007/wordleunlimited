# Deploying to Coolify

Everything is pre-built into the image — word lists, compressed assets, database
migrations and topic seeding all run automatically. You should only need to set
two variables by hand.

---

## 1. Create the resource

In Coolify:

1. **+ New** → **Resource** → **Docker Compose**
2. Choose your server and project
3. Source: **Public Repository**
4. Repository URL: `https://github.com/ashisbiswas007/wordleunlimited`
5. Branch: `main`
6. Docker Compose Location: `/docker-compose.yml`
7. Click **Continue** / **Save**

Coolify reads the compose file and finds two services: `app` and `db`.

---

## 2. Set the environment variables

Open the **Environment Variables** tab and add these two:

| Name | Value |
|---|---|
| `SITE_URL` | `https://wordleunlimited.dev` |
| `ADMIN_PASSWORD` | a strong password you choose |

That is all. These are filled in for you automatically:

- `SERVICE_PASSWORD_POSTGRES` — the database password
- `SERVICE_BASE64_64_SESSION` — the secret that signs admin sessions
- `SERVICE_FQDN_APP_3000` — the domain, wired to the app on port 3000

**Do not** set `DATABASE_URL` yourself — the compose file builds it from the
generated password.

> Leaving `ADMIN_PASSWORD` blank is also fine: a strong one is generated on
> first boot and printed in the `app` container logs, once. Copy it from there
> and change it inside the admin panel.

---

## 3. Set the domain

Coolify assigns a temporary domain automatically. To use your own:

1. Go to the **`app`** service → **Domains**
2. Set it to `https://wordleunlimited.dev`
3. Save

Coolify handles the Let's Encrypt certificate.

Only the `app` service should have a domain. The `db` service must stay internal
— never give it one.

---

## 4. Deploy

Click **Deploy**. The first build takes a few minutes because it compiles the
word lists and pre-compresses every asset. Later deploys are faster thanks to
Docker layer caching.

Watch the logs. A healthy first boot looks like this:

```
[db] applied migration 001_init.sql
[db] applied migration 002_admin_credentials.sql
[topics] seeded 46 topic pack(s)
[words] dictionaries loaded — 230,092 accepted guesses
[admin] login ready for "admin" (ADMIN_PASSWORD)
[boot] wordleunlimited listening on 0.0.0.0:3000 (production, db configured)
```

---

## 5. Check it before pointing DNS

Visit the temporary Coolify domain and confirm:

- [ ] `/` loads and you can play a word
- [ ] `/wordle-uk/` gives British words (try `COLOUR`)
- [ ] `/id/` gives Indonesian words and Indonesian UI text
- [ ] `/topics/` lists all 46 topics
- [ ] `/topics/spider-man/` starts on `PETER` and advances to `PARKER`
- [ ] **Versus** tab shows a live player count and you can join a room
- [ ] `/admin` accepts your password
- [ ] `/healthz` returns `{"ok":true,...,"db":"up"}`
- [ ] `/sitemap.xml` lists 52 URLs

---

## 6. Point DNS

Once the checks pass, point `wordleunlimited.dev` at your Coolify server:

| Type | Name | Value |
|---|---|---|
| `A` | `@` | your server's IP |
| `A` | `www` | your server's IP |

Then confirm `SITE_URL` is `https://wordleunlimited.dev` and redeploy so the
sitemap and share links use the right origin.

**Do not point DNS until step 5 passes** — the WordPress site is currently
ranking, and swapping it for a broken deploy is the one mistake that is
expensive to undo.

---

## Redeploying after a change

```bash
git add -A && git commit -m "your change" && git push
```

Then hit **Redeploy** in Coolify (or enable automatic deploys via webhook in
the resource's settings).

---

## Everyday operations

**Maintenance mode** — `/admin` → Settings → *Take the site offline*. Returns a
branded 503 and tells crawlers to stay away. `/admin` stays reachable so you can
switch it back off.

**Adding topics** — `/admin` → Topics → Bulk import, and paste an array:

```json
[{ "slug": "one-piece", "name": "One Piece", "category": "movies & tv",
   "icon": "🏴‍☠️",
   "items": [{ "answer": "LUFFY" }, { "answer": "ZORO", "clue": "The swordsman" }] }]
```

Answers must be 3–7 letters; anything else is dropped. An existing slug is
replaced. New topics get their own `/topics/<slug>/` page and enter the sitemap
automatically.

**Adding words** — edit the lexicons in `data/`, then:

```bash
npm run words
```

Commit the regenerated `public/src/dict/**` and redeploy. Every curated word is
spell-checked against the cached reference dictionary, so a typo shows up as a
build warning rather than an unguessable puzzle.

**Backups** — Coolify can schedule automatic Postgres backups on the `db`
resource. Worth enabling: it holds your topics, settings and match history.
Player progress lives in each player's own browser (and their Drive if they
signed in), so it is not at risk here.

---

## Optional: Google Drive cloud save

Only needed if you want players to sync progress across devices.

1. Google Cloud Console → **APIs & Services** → **Credentials**
2. Create an **OAuth 2.0 Client ID**, type **Web application**
3. Authorised JavaScript origin: `https://wordleunlimited.dev`
4. Enable the **Google Drive API**
5. Put the client ID in Coolify as `GOOGLE_CLIENT_ID` and redeploy

The scope used is `drive.appdata`, which only ever sees a private folder this
app creates. It cannot read a user's real files. Without `GOOGLE_CLIENT_ID` the
cloud save row simply stays hidden and everything else works normally.

---

## Troubleshooting

**Build fails on `npm ci`** — make sure `package-lock.json` is committed.

**`/healthz` says `"db":"down"`** — the app keeps serving the game, but settings
and topics fall back to defaults. Check the `db` container is healthy and that
`DATABASE_URL` is not overridden in the environment variables.

**Admin login rejects the password** — a password changed inside the admin panel
is stored in the database and overrides `ADMIN_PASSWORD`. To reset, delete the
row: `DELETE FROM admin_credentials;` then redeploy.

**Multiplayer never connects** — WebSockets need the proxy to forward upgrade
headers. Coolify's Traefik does this by default; if you put Cloudflare in front,
make sure WebSockets are enabled there too.

**Topic pages 404** — Topic mode may be switched off. Check `/admin` → Settings
→ Game modes → Topics.
