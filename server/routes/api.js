import config from "../config.js";
import { getSettings } from "../lib/settings.js";
import { listTopics, getTopic, recordPlay } from "../lib/topics.js";
import { listOpenRooms, createCustomRoom, describeRoom } from "../realtime/hub.js";
import { query } from "../db/pool.js";

const READ_LIMIT = { max: 240, timeWindow: "1 minute" };
const WRITE_LIMIT = { max: 20, timeWindow: "1 minute" };

export default async function registerApiRoutes(app) {
  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("Vary", "Accept-Encoding");
    return payload;
  });

  /* Feature flags + public config the client boots against. */
  app.get(
    "/status",
    { config: { rateLimit: READ_LIMIT }, compress: { threshold: 512 } },
    async (req, reply) => {
      const s = getSettings();
      reply.header("Cache-Control", "public, max-age=30, stale-while-revalidate=120");
      return {
        maintenance: s.maintenance,
        modes: s.modes,
        features: s.features,
        multiplayer: {
          enabled: s.multiplayer.enabled,
          allowCustomRooms: s.multiplayer.allowCustomRooms,
          maxPlayersPerRoom: s.multiplayer.maxPlayersPerRoom,
          wordsToWin: s.multiplayer.wordsToWin,
        },
        announcement: s.announcement.enabled ? s.announcement : null,
        googleClientId: config.google.clientId || null,
        cloudSave: s.features.cloudSave && Boolean(config.google.clientId),
      };
    }
  );

  /* ---------- topics ---------- */

  app.get(
    "/topics",
    { config: { rateLimit: READ_LIMIT }, compress: { threshold: 512 } },
    async (req, reply) => {
      const s = getSettings();
      if (!s.modes.topic) return reply.code(404).send({ error: "disabled" });

      const region = typeof req.query.region === "string" ? req.query.region : null;
      const list = await listTopics({ region });

      reply.header("Cache-Control", "public, max-age=120, stale-while-revalidate=600");

      const categories = [...new Set(list.map((t) => t.category))].sort();
      return {
        count: list.length,
        categories,
        featured: list.filter((t) => t.featured).slice(0, 12),
        popular: [...list].sort((a, b) => b.plays - a.plays).slice(0, 12),
        topics: list,
      };
    }
  );

  app.get(
    "/topics/:slug",
    { config: { rateLimit: READ_LIMIT }, compress: { threshold: 512 } },
    async (req, reply) => {
      const s = getSettings();
      if (!s.modes.topic) return reply.code(404).send({ error: "disabled" });

      const entry = await getTopic(req.params.slug);
      if (!entry) return reply.code(404).send({ error: "not_found" });

      recordPlay(entry.topic.slug);
      reply.header("Cache-Control", "public, max-age=300, stale-while-revalidate=1800");
      return { topic: entry.topic, items: entry.items };
    }
  );

  /* ---------- multiplayer lobby ---------- */

  app.get(
    "/rooms",
    { config: { rateLimit: READ_LIMIT } },
    async (req, reply) => {
      const s = getSettings();
      if (!s.modes.multiplayer || !s.multiplayer.enabled) {
        return reply.code(404).send({ error: "disabled" });
      }
      // Lobby counts change constantly; never let a proxy cache them.
      reply.header("Cache-Control", "no-store");
      return { rooms: listOpenRooms(), maxPlayers: s.multiplayer.maxPlayersPerRoom };
    }
  );

  app.post(
    "/rooms",
    {
      config: { rateLimit: WRITE_LIMIT },
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            format: { type: "string", enum: ["race", "timed"] },
            maxPlayers: { type: "integer", minimum: 2, maximum: 50 },
            wordsToWin: { type: "integer", minimum: 3, maximum: 30 },
            durationSeconds: { type: "integer", minimum: 60, maximum: 1800 },
            length: { type: "integer", minimum: 3, maximum: 7 },
            region: { type: "string", enum: ["en", "gb", "id"] },
            topic: { type: "string", maxLength: 64 },
            private: { type: "boolean" },
          },
        },
      },
    },
    async (req, reply) => {
      const s = getSettings();
      if (!s.modes.multiplayer || !s.multiplayer.enabled) {
        return reply.code(404).send({ error: "disabled" });
      }
      if (!s.multiplayer.allowCustomRooms) {
        return reply.code(403).send({ error: "custom_rooms_disabled" });
      }

      const result = createCustomRoom(req.body || {});
      if (result.error) return reply.code(400).send(result);

      reply.header("Cache-Control", "no-store");
      return {
        code: result.code,
        joinUrl: `${config.siteUrl}/?room=${result.code}`,
        room: describeRoom(result.code),
      };
    }
  );

  app.get("/rooms/:code", { config: { rateLimit: READ_LIMIT } }, async (req, reply) => {
    const room = describeRoom(req.params.code);
    reply.header("Cache-Control", "no-store");
    if (!room) return reply.code(404).send({ error: "not_found" });
    return { room };
  });

  /* ---------- recent multiplayer winners (social proof strip) ---------- */

  app.get(
    "/recent-matches",
    { config: { rateLimit: READ_LIMIT }, compress: { threshold: 512 } },
    async (req, reply) => {
      const { rows } = await query(
        `SELECT room_kind, format, topic_slug, player_count,
                winner_name, winner_score, finished_at
           FROM match_results
          ORDER BY finished_at DESC
          LIMIT 10`
      );
      reply.header("Cache-Control", "public, max-age=60");
      return { matches: rows };
    }
  );
}
