import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { query, queryStrict, isDbEnabled } from "../db/pool.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PACKS_DIR = join(HERE, "..", "..", "public", "src", "topics");

const INDEX_TTL_MS = 60_000;
const ITEMS_TTL_MS = 5 * 60_000;

let indexCache = { at: 0, list: [] };
const itemsCache = new Map(); // slug -> { at, topic, items }

/* ---------- disk packs (seed source + no-DB fallback) ---------- */

async function readPacks() {
  let files;
  try {
    files = (await readdir(PACKS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }

  const packs = [];
  for (const file of files) {
    if (file === "index.json") continue;
    try {
      const parsed = JSON.parse(await readFile(join(PACKS_DIR, file), "utf8"));
      // A file may hold a single pack or an array of them, so related topics
      // can be grouped together instead of one file each.
      const list = Array.isArray(parsed) ? parsed : [parsed];
      for (const pack of list) {
        if (pack && pack.slug && Array.isArray(pack.items)) packs.push(normalisePack(pack));
      }
    } catch (err) {
      console.warn(`[topics] skipping malformed pack ${file}: ${err.message}`);
    }
  }
  return packs;
}

function normalisePack(pack) {
  const seen = new Set();
  const items = [];

  for (const raw of pack.items) {
    const entry = typeof raw === "string" ? { answer: raw } : raw || {};
    // Answers are matched against A-Z tiles, so strip spaces/punctuation/accents.
    const answer = String(entry.answer || "")
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .toUpperCase()
      .replace(/[^A-Z]/g, "");

    if (answer.length < 3 || answer.length > 7) continue;
    if (seen.has(answer)) continue;
    seen.add(answer);

    // Every answer carries a clue. Hand-written ones win; the rest get a
    // generated one, because a name you have never heard of with no hint at
    // all is not a puzzle, it is a wall.
    const written = entry.clue ? String(entry.clue).slice(0, 120) : null;
    items.push({
      answer,
      length: answer.length,
      clue: written || `Starts with ${answer[0]} · ${answer.length} letters`,
    });
  }

  return {
    slug: String(pack.slug).toLowerCase().replace(/[^a-z0-9-]/g, ""),
    name: String(pack.name || pack.slug),
    category: String(pack.category || "general"),
    region: String(pack.region || "en"),
    blurb: pack.blurb ? String(pack.blurb).slice(0, 300) : null,
    icon: pack.icon || null,
    featured: Boolean(pack.featured),
    sortOrder: Number.isFinite(pack.sortOrder) ? pack.sortOrder : 100,
    items,
  };
}

/* ---------- seeding ---------- */

/**
 * Inserts any pack that is not already in the database. Existing rows are left
 * alone so admin edits are never overwritten by a redeploy.
 */
export async function seedTopics() {
  if (!isDbEnabled()) return { seeded: 0, skipped: true };

  const packs = await readPacks();
  if (!packs.length) return { seeded: 0, skipped: false };

  const { rows } = await query("SELECT slug FROM topics");
  const existing = new Set(rows.map((r) => r.slug));
  const todo = packs.filter((p) => !existing.has(p.slug));
  if (!todo.length) return { seeded: 0, skipped: false };

  let seeded = 0;
  for (const pack of todo) {
    try {
      const res = await queryStrict(
        `INSERT INTO topics (slug, name, category, region, blurb, icon, featured, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (slug) DO NOTHING
         RETURNING id`,
        [pack.slug, pack.name, pack.category, pack.region, pack.blurb,
         pack.icon, pack.featured, pack.sortOrder]
      );
      if (!res.rows.length) continue;

      const topicId = res.rows[0].id;
      // Single multi-row insert per pack keeps seeding to one round trip.
      const values = [];
      const params = [];
      pack.items.forEach((it, i) => {
        const b = i * 5;
        values.push(`($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5})`);
        params.push(topicId, it.answer, it.length, it.clue, i);
      });
      if (values.length) {
        await queryStrict(
          `INSERT INTO topic_items (topic_id, answer, length, clue, sort_order)
           VALUES ${values.join(",")} ON CONFLICT DO NOTHING`,
          params
        );
      }
      seeded++;
    } catch (err) {
      console.warn(`[topics] seed failed for ${pack.slug}: ${err.message}`);
    }
  }

  invalidate();
  console.log(`[topics] seeded ${seeded} topic pack(s)`);
  return { seeded, skipped: false };
}

/* ---------- reads ---------- */

export async function listTopics({ region = null, force = false } = {}) {
  const fresh = Date.now() - indexCache.at < INDEX_TTL_MS;
  if (!force && fresh && indexCache.list.length) {
    return region ? indexCache.list.filter((t) => t.region === region) : indexCache.list;
  }

  let list = [];

  if (isDbEnabled()) {
    const { rows, ok } = await query(
      `SELECT t.slug, t.name, t.category, t.region, t.blurb, t.icon,
              t.featured, t.play_count, t.sort_order,
              COUNT(i.id)::int AS item_count
         FROM topics t
         LEFT JOIN topic_items i ON i.topic_id = t.id
        WHERE t.enabled
        GROUP BY t.id
       HAVING COUNT(i.id) > 0
        ORDER BY t.featured DESC, t.sort_order ASC, t.play_count DESC, t.name ASC`
    );
    if (ok) {
      list = rows.map((r) => ({
        slug: r.slug,
        name: r.name,
        category: r.category,
        region: r.region,
        blurb: r.blurb,
        icon: r.icon,
        featured: r.featured,
        plays: Number(r.play_count),
        count: r.item_count,
      }));
    }
  }

  // No DB, or DB unreachable — serve straight off the packs so Topic mode still works.
  if (!list.length) {
    const packs = await readPacks();
    list = packs.map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      region: p.region,
      blurb: p.blurb,
      icon: p.icon,
      featured: p.featured,
      plays: 0,
      count: p.items.length,
    }));
    list.sort(
      (a, b) => Number(b.featured) - Number(a.featured) || a.name.localeCompare(b.name)
    );
  }

  indexCache = { at: Date.now(), list };
  return region ? list.filter((t) => t.region === region) : list;
}

export async function getTopic(slug) {
  const key = String(slug || "").toLowerCase();
  if (!/^[a-z0-9-]{1,64}$/.test(key)) return null;

  const hit = itemsCache.get(key);
  if (hit && Date.now() - hit.at < ITEMS_TTL_MS) return hit;

  if (isDbEnabled()) {
    const { rows, ok } = await query(
      `SELECT t.slug, t.name, t.category, t.region, t.blurb, t.icon,
              i.answer, i.length, i.clue
         FROM topics t
         JOIN topic_items i ON i.topic_id = t.id
        WHERE t.slug = $1 AND t.enabled
        ORDER BY i.sort_order ASC, i.id ASC`,
      [key]
    );
    if (ok && rows.length) {
      const entry = {
        at: Date.now(),
        topic: {
          slug: rows[0].slug,
          name: rows[0].name,
          category: rows[0].category,
          region: rows[0].region,
          blurb: rows[0].blurb,
          icon: rows[0].icon,
        },
        items: rows.map((r) => ({ answer: r.answer, length: r.length, clue: r.clue })),
      };
      itemsCache.set(key, entry);
      return entry;
    }
  }

  const pack = (await readPacks()).find((p) => p.slug === key);
  if (!pack) return null;

  const entry = {
    at: Date.now(),
    topic: {
      slug: pack.slug,
      name: pack.name,
      category: pack.category,
      region: pack.region,
      blurb: pack.blurb,
      icon: pack.icon,
    },
    items: pack.items,
  };
  itemsCache.set(key, entry);
  return entry;
}

/** Fire-and-forget popularity counter; never blocks a response. */
export function recordPlay(slug) {
  if (!isDbEnabled()) return;
  query("UPDATE topics SET play_count = play_count + 1 WHERE slug = $1", [slug]).catch(
    () => {}
  );
}

export function invalidate(slug) {
  indexCache = { at: 0, list: [] };
  if (slug) itemsCache.delete(String(slug).toLowerCase());
  else itemsCache.clear();
}

export { readPacks, normalisePack };
