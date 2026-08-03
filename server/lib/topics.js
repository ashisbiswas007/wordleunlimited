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

/**
 * The clue every answer falls back to.
 *
 * A name you have never heard of with no hint at all is not a puzzle, it is a
 * wall — so no answer is ever served without one, whatever its source.
 */
export function defaultClue(answer) {
  return `Starts with ${answer[0]} · ${answer.length} letters`;
}

/** Hand-written clue if there is one, generated clue otherwise. Never empty. */
export function ensureClue(answer, clue) {
  const written = clue == null ? "" : String(clue).trim();
  return written ? written.slice(0, 120) : defaultClue(answer);
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

    items.push({
      answer,
      length: answer.length,
      clue: ensureClue(answer, entry.clue),
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

/**
 * Hand-written clues straight off disk, keyed slug -> answer -> clue.
 *
 * Read from the raw JSON rather than a normalised pack because normalising
 * fills in a generated clue, which would make a real clue indistinguishable
 * from a placeholder.
 */
async function readWrittenClues() {
  let files;
  try {
    files = (await readdir(PACKS_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return new Map();
  }

  const out = new Map();
  for (const file of files) {
    if (file === "index.json") continue;
    let parsed;
    try {
      parsed = JSON.parse(await readFile(join(PACKS_DIR, file), "utf8"));
    } catch {
      continue;
    }
    for (const pack of Array.isArray(parsed) ? parsed : [parsed]) {
      if (!pack || !pack.slug || !Array.isArray(pack.items)) continue;
      const slug = String(pack.slug).toLowerCase().replace(/[^a-z0-9-]/g, "");
      const byAnswer = out.get(slug) || new Map();
      for (const raw of pack.items) {
        if (!raw || typeof raw === "string") continue;
        const clue = raw.clue == null ? "" : String(raw.clue).trim();
        if (!clue) continue;
        const answer = String(raw.answer || "")
          .normalize("NFD")
          .replace(/\p{Diacritic}/gu, "")
          .toUpperCase()
          .replace(/[^A-Z]/g, "");
        if (answer) byAnswer.set(answer, clue.slice(0, 120));
      }
      if (byAnswer.size) out.set(slug, byAnswer);
    }
  }
  return out;
}

/**
 * Pushes clue rewrites from the packs into topics that are already in the
 * database.
 *
 * seedTopics only ever inserts new topics, so without this a clue written after
 * a topic was first seeded would never reach a live deployment. Only the clue
 * column is touched, and only where the pack actually has a written clue, so
 * answers and admin edits are left alone.
 */
export async function syncClues() {
  if (!isDbEnabled()) return { updated: 0, skipped: true };

  const written = await readWrittenClues();
  if (!written.size) return { updated: 0, skipped: false };

  const { rows, ok } = await query("SELECT id, slug FROM topics");
  if (!ok) return { updated: 0, skipped: false };

  let updated = 0;
  for (const { id, slug } of rows) {
    const clues = written.get(slug);
    if (!clues) continue;
    const answers = [...clues.keys()];
    const texts = answers.map((a) => clues.get(a));
    try {
      // One statement per topic: join the incoming pairs against the rows and
      // write only the ones whose text actually differs.
      const res = await query(
        `UPDATE topic_items i
            SET clue = v.clue
           FROM (SELECT * FROM unnest($2::text[], $3::text[]) AS t(answer, clue)) v
          WHERE i.topic_id = $1 AND i.answer = v.answer
            AND (i.clue IS DISTINCT FROM v.clue)`,
        [id, answers, texts]
      );
      updated += res.rowCount || 0;
    } catch (err) {
      console.warn(`[topics] clue sync failed for ${slug}: ${err.message}`);
    }
  }

  if (updated) {
    invalidate();
    console.log(`[topics] refreshed ${updated} clue(s) from the packs`);
  }
  return { updated, skipped: false };
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
        // Rows seeded before clues were generated — or imported without one —
        // still have a NULL clue, and seedTopics deliberately never rewrites an
        // existing topic. Filling the gap on read is what guarantees that every
        // answer has a clue on a live database, not just from the JSON packs.
        items: rows.map((r) => ({
          answer: r.answer,
          length: r.length,
          clue: ensureClue(r.answer, r.clue),
        })),
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
