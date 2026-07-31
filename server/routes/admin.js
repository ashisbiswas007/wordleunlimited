import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import config from "../config.js";
import { signToken, verifyToken } from "../lib/crypto.js";
import {
  verifyAdminPassword,
  changeAdminPassword,
  adminAuthStatus,
} from "../lib/admin-auth.js";
import { getSettings, setSetting, loadSettings, DEFAULTS } from "../lib/settings.js";
import { query, queryStrict, isDbEnabled, isDbAvailable } from "../db/pool.js";
import { invalidate as invalidateTopics, normalisePack, listTopics } from "../lib/topics.js";
import { hubStats } from "../realtime/hub.js";
import { stats as wordStats } from "../lib/words.js";
import { invalidateSitemap } from "./pages.js";

const HERE = dirname(fileURLToPath(import.meta.url));
// Deliberately outside public/: keeping the admin UI out of the static root
// avoids a route collision with @fastify/static and guarantees the noindex /
// no-store headers below always apply to it.
const ADMIN_UI = join(HERE, "..", "admin-ui");

const COOKIE = "wu_admin";
const LOGIN_LIMIT = { max: 8, timeWindow: "5 minutes" };
const API_LIMIT = { max: 120, timeWindow: "1 minute" };

const uiCache = new Map();

async function adminAsset(name) {
  if (config.isProd && uiCache.has(name)) return uiCache.get(name);
  const body = await readFile(join(ADMIN_UI, name), "utf8");
  uiCache.set(name, body);
  return body;
}

function currentAdmin(req) {
  const raw = req.cookies?.[COOKIE];
  if (!raw) return null;
  const payload = verifyToken(raw, config.sessionSecret);
  return payload?.u ? payload : null;
}

async function audit(req, action, detail = {}) {
  if (!isDbEnabled()) return;
  const admin = currentAdmin(req);
  query(
    "INSERT INTO audit_log (actor, action, detail, ip) VALUES ($1,$2,$3::jsonb,$4)",
    [admin?.u || "anonymous", action, JSON.stringify(detail), req.ip || null]
  ).catch(() => {});
}

export default async function registerAdminRoutes(app) {
  /* Admin pages must never be indexed, even if something links to them. */
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("X-Robots-Tag", "noindex, nofollow, noarchive");
    reply.header("Cache-Control", "no-store");
    return payload;
  });

  /** Gate for every /admin/api route except login. */
  async function requireAdmin(req, reply) {
    if (!currentAdmin(req)) {
      reply.code(401).send({ error: "unauthorized" });
      return reply;
    }
  }

  /* ---------- shell ---------- */

  app.get("/", async (req, reply) => {
    reply.type("text/html; charset=utf-8");
    return adminAsset("index.html");
  });

  app.get("/admin.js", async (req, reply) => {
    reply.type("text/javascript; charset=utf-8");
    return adminAsset("admin.js");
  });

  /* ---------- auth ---------- */

  app.post(
    "/api/login",
    {
      config: { rateLimit: LOGIN_LIMIT },
      schema: {
        body: {
          type: "object",
          required: ["username", "password"],
          additionalProperties: false,
          properties: {
            username: { type: "string", maxLength: 64 },
            password: { type: "string", maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const { username, password } = req.body;
      const status = adminAuthStatus();

      if (!status.configured) {
        return reply.code(500).send({
          error: "not_configured",
          message:
            "No admin password is set. Add ADMIN_PASSWORD to the environment and redeploy.",
        });
      }

      const userOk = username === config.admin.user;
      // Always run the hash so a wrong username and a wrong password take the
      // same amount of time.
      const passOk = await verifyAdminPassword(password);

      if (!userOk || !passOk) {
        await audit(req, "login_failed", { username });
        return reply.code(401).send({ error: "invalid_credentials" });
      }

      const token = signToken({ u: username }, config.sessionSecret, config.admin.sessionTtlMs);
      reply.setCookie(COOKIE, token, {
        path: "/admin",
        httpOnly: true,
        sameSite: "lax",
        secure: config.isProd,
        maxAge: Math.floor(config.admin.sessionTtlMs / 1000),
      });

      await audit(req, "login_ok", { username });
      return { ok: true, user: username, ...adminAuthStatus() };
    }
  );

  /* Tells the login screen whether a password even exists yet. */
  app.get("/api/auth-status", { config: { rateLimit: LOGIN_LIMIT } }, async () => {
    const s = adminAuthStatus();
    return {
      configured: s.configured,
      usingGeneratedPassword: s.usingGeneratedPassword,
      username: config.admin.user,
    };
  });

  app.post(
    "/api/password",
    {
      preHandler: requireAdmin,
      config: { rateLimit: LOGIN_LIMIT },
      schema: {
        body: {
          type: "object",
          required: ["currentPassword", "newPassword"],
          additionalProperties: false,
          properties: {
            currentPassword: { type: "string", maxLength: 256 },
            newPassword: { type: "string", minLength: 12, maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const res = await changeAdminPassword(
        req.body.currentPassword,
        req.body.newPassword
      );
      if (res.error) {
        await audit(req, "password_change_failed", { reason: res.error });
        const code = res.error === "wrong_password" ? 401 : 400;
        return reply.code(code).send(res);
      }
      // Force a fresh login so any other session signed with the old state dies.
      reply.clearCookie(COOKIE, { path: "/admin" });
      await audit(req, "password_changed", {});
      return { ok: true };
    }
  );

  app.post("/api/logout", async (req, reply) => {
    reply.clearCookie(COOKIE, { path: "/admin" });
    return { ok: true };
  });

  app.get("/api/me", async (req, reply) => {
    const admin = currentAdmin(req);
    if (!admin) return reply.code(401).send({ error: "unauthorized" });
    return { user: admin.u, expiresAt: admin.exp };
  });

  /* ---------- settings ---------- */

  app.get(
    "/api/settings",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async () => ({ settings: getSettings(), defaults: DEFAULTS })
  );

  app.post(
    "/api/settings",
    {
      preHandler: requireAdmin,
      config: { rateLimit: API_LIMIT },
      schema: {
        body: {
          type: "object",
          required: ["key", "value"],
          additionalProperties: false,
          properties: { key: { type: "string", maxLength: 64 } },
        },
      },
    },
    async (req, reply) => {
      if (!isDbEnabled()) {
        return reply.code(503).send({
          error: "no_database",
          message: "Settings need DATABASE_URL configured to persist.",
        });
      }
      try {
        const settings = await setSetting(req.body.key, req.body.value);
        await audit(req, "settings_update", { key: req.body.key, value: req.body.value });
        return { ok: true, settings };
      } catch (err) {
        return reply.code(400).send({ error: "bad_setting", message: err.message });
      }
    }
  );

  /* ---------- dashboard stats ---------- */

  app.get(
    "/api/stats",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async () => {
      const hub = hubStats();
      const topics = await listTopics({}).catch(() => []);

      const [{ rows: matchRows }, { rows: topRows }] = await Promise.all([
        query("SELECT COUNT(*)::int AS n FROM match_results"),
        query(
          `SELECT slug, name, play_count FROM topics
            WHERE enabled ORDER BY play_count DESC LIMIT 10`
        ),
      ]);

      return {
        db: isDbEnabled() ? (isDbAvailable() ? "up" : "down") : "disabled",
        uptimeSeconds: Math.round(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1048576),
        multiplayer: hub,
        topics: { total: topics.length, top: topRows },
        matches: matchRows[0]?.n ?? 0,
        words: wordStats(),
      };
    }
  );

  app.get(
    "/api/audit",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async () => {
      const { rows } = await query(
        "SELECT actor, action, detail, ip, created_at FROM audit_log ORDER BY created_at DESC LIMIT 100"
      );
      return { entries: rows };
    }
  );

  /* ---------- topics ---------- */

  app.get(
    "/api/topics",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async () => {
      const { rows } = await query(
        `SELECT t.id, t.slug, t.name, t.category, t.region, t.blurb, t.icon,
                t.enabled, t.featured, t.play_count, t.sort_order,
                COUNT(i.id)::int AS item_count
           FROM topics t LEFT JOIN topic_items i ON i.topic_id = t.id
          GROUP BY t.id ORDER BY t.featured DESC, t.sort_order, t.name`
      );
      return { topics: rows };
    }
  );

  app.post(
    "/api/topics",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async (req, reply) => {
      if (!isDbEnabled()) return reply.code(503).send({ error: "no_database" });

      let pack;
      try {
        pack = normalisePack(req.body || {});
      } catch (err) {
        return reply.code(400).send({ error: "bad_pack", message: err.message });
      }
      if (!pack.slug || !pack.items.length) {
        return reply.code(400).send({
          error: "bad_pack",
          message: "A topic needs a slug and at least one 3–7 letter answer.",
        });
      }

      try {
        const res = await queryStrict(
          `INSERT INTO topics (slug, name, category, region, blurb, icon, featured, sort_order)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
           ON CONFLICT (slug) DO UPDATE SET
             name = EXCLUDED.name, category = EXCLUDED.category,
             region = EXCLUDED.region, blurb = EXCLUDED.blurb,
             icon = EXCLUDED.icon, featured = EXCLUDED.featured,
             sort_order = EXCLUDED.sort_order, updated_at = now()
           RETURNING id`,
          [pack.slug, pack.name, pack.category, pack.region, pack.blurb,
           pack.icon, pack.featured, pack.sortOrder]
        );
        const topicId = res.rows[0].id;

        // Replace the answer set wholesale so edits are predictable.
        await queryStrict("DELETE FROM topic_items WHERE topic_id = $1", [topicId]);

        const values = [];
        const params = [];
        pack.items.forEach((it, i) => {
          const b = i * 5;
          values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
          params.push(topicId, it.answer, it.length, it.clue, i);
        });
        await queryStrict(
          `INSERT INTO topic_items (topic_id, answer, length, clue, sort_order)
           VALUES ${values.join(",")}`,
          params
        );

        invalidateTopics(pack.slug);
        invalidateSitemap();
        await audit(req, "topic_upsert", { slug: pack.slug, items: pack.items.length });
        return { ok: true, slug: pack.slug, items: pack.items.length };
      } catch (err) {
        return reply.code(500).send({ error: "save_failed", message: err.message });
      }
    }
  );

  app.patch(
    "/api/topics/:slug",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async (req, reply) => {
      if (!isDbEnabled()) return reply.code(503).send({ error: "no_database" });

      const fields = [];
      const params = [];
      for (const [col, val] of Object.entries({
        enabled: req.body?.enabled,
        featured: req.body?.featured,
        sort_order: req.body?.sortOrder,
        name: req.body?.name,
        blurb: req.body?.blurb,
      })) {
        if (val === undefined) continue;
        params.push(val);
        fields.push(`${col} = $${params.length}`);
      }
      if (!fields.length) return reply.code(400).send({ error: "nothing_to_update" });

      params.push(req.params.slug);
      const res = await query(
        `UPDATE topics SET ${fields.join(", ")}, updated_at = now()
          WHERE slug = $${params.length} RETURNING slug`,
        params
      );
      if (!res.rows.length) return reply.code(404).send({ error: "not_found" });

      invalidateTopics(req.params.slug);
      invalidateSitemap();
      await audit(req, "topic_patch", { slug: req.params.slug, ...req.body });
      return { ok: true };
    }
  );

  app.delete(
    "/api/topics/:slug",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async (req, reply) => {
      if (!isDbEnabled()) return reply.code(503).send({ error: "no_database" });
      const res = await query("DELETE FROM topics WHERE slug = $1 RETURNING slug", [
        req.params.slug,
      ]);
      if (!res.rows.length) return reply.code(404).send({ error: "not_found" });

      invalidateTopics(req.params.slug);
      invalidateSitemap();
      await audit(req, "topic_delete", { slug: req.params.slug });
      return { ok: true };
    }
  );

  /* Bulk import — paste an array of packs straight from a JSON file. */
  app.post(
    "/api/topics/import",
    { preHandler: requireAdmin, config: { rateLimit: { max: 10, timeWindow: "1 minute" } } },
    async (req, reply) => {
      if (!isDbEnabled()) return reply.code(503).send({ error: "no_database" });
      const packs = Array.isArray(req.body) ? req.body : req.body?.packs;
      if (!Array.isArray(packs)) {
        return reply.code(400).send({ error: "expected_array" });
      }

      let imported = 0;
      const failures = [];
      for (const raw of packs.slice(0, 500)) {
        try {
          const pack = normalisePack(raw);
          if (!pack.slug || !pack.items.length) {
            failures.push({ slug: raw?.slug, reason: "no valid answers" });
            continue;
          }
          const res = await queryStrict(
            `INSERT INTO topics (slug, name, category, region, blurb, icon, featured, sort_order)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
             ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name, updated_at = now()
             RETURNING id`,
            [pack.slug, pack.name, pack.category, pack.region, pack.blurb,
             pack.icon, pack.featured, pack.sortOrder]
          );
          const topicId = res.rows[0].id;
          await queryStrict("DELETE FROM topic_items WHERE topic_id = $1", [topicId]);

          const values = [];
          const params = [];
          pack.items.forEach((it, i) => {
            const b = i * 5;
            values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
            params.push(topicId, it.answer, it.length, it.clue, i);
          });
          await queryStrict(
            `INSERT INTO topic_items (topic_id, answer, length, clue, sort_order)
             VALUES ${values.join(",")}`,
            params
          );
          imported++;
        } catch (err) {
          failures.push({ slug: raw?.slug, reason: err.message });
        }
      }

      invalidateTopics();
      invalidateSitemap();
      await audit(req, "topic_import", { imported, failed: failures.length });
      return { ok: true, imported, failures };
    }
  );

  /* ---------- maintenance shortcuts ---------- */

  app.post(
    "/api/maintenance",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async (req, reply) => {
      if (!isDbEnabled()) return reply.code(503).send({ error: "no_database" });
      const on = Boolean(req.body?.enabled);
      await setSetting("maintenance", on);
      if (typeof req.body?.message === "string" && req.body.message.trim()) {
        await setSetting("maintenanceMessage", req.body.message.trim().slice(0, 300));
      }
      await audit(req, "maintenance", { enabled: on });
      return { ok: true, maintenance: on };
    }
  );

  app.post(
    "/api/reload",
    { preHandler: requireAdmin, config: { rateLimit: API_LIMIT } },
    async (req) => {
      await loadSettings();
      invalidateTopics();
      invalidateSitemap();
      await audit(req, "reload", {});
      return { ok: true };
    }
  );
}
