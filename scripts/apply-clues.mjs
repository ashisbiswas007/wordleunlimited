#!/usr/bin/env node
/**
 * Merges the riddle clues in data/clues/<slug>.json into the topic packs.
 *
 * Clues are authored separately from the packs so they can be reviewed and
 * rewritten without touching the answer lists, then folded in here. The packs
 * stay the single source of truth the server reads.
 *
 *   node scripts/apply-clues.mjs           # write
 *   node scripts/apply-clues.mjs --check   # report only, non-zero if incomplete
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PACKS_DIR = join(ROOT, "public", "src", "topics");
const CLUES_DIR = join(ROOT, "data", "clues");

const checkOnly = process.argv.includes("--check");

function normalise(answer) {
  return String(answer || "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toUpperCase()
    .replace(/[^A-Z]/g, "");
}

async function loadClueMaps() {
  let files = [];
  try {
    files = (await readdir(CLUES_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    console.error(`No clue directory at ${CLUES_DIR}`);
    return new Map();
  }
  const maps = new Map();
  for (const file of files) {
    const slug = file.replace(/\.json$/, "");
    const raw = JSON.parse(await readFile(join(CLUES_DIR, file), "utf8"));
    const m = new Map();
    for (const [answer, clue] of Object.entries(raw)) {
      const a = normalise(answer);
      const c = String(clue || "").trim();
      if (a && c) m.set(a, c.slice(0, 120));
    }
    maps.set(slug, m);
  }
  return maps;
}

const clueMaps = await loadClueMaps();
const packFiles = (await readdir(PACKS_DIR)).filter((f) => f.endsWith(".json") && f !== "index.json");

let totalAnswers = 0;
let totalClued = 0;
let written = 0;
const gaps = [];
const unused = new Map(clueMaps);

for (const file of packFiles) {
  const path = join(PACKS_DIR, file);
  const src = await readFile(path, "utf8");
  const parsed = JSON.parse(src);
  const packs = Array.isArray(parsed) ? parsed : [parsed];
  let touched = false;

  for (const pack of packs) {
    if (!pack || !pack.slug || !Array.isArray(pack.items)) continue;
    const map = clueMaps.get(pack.slug);
    unused.delete(pack.slug);

    for (let i = 0; i < pack.items.length; i++) {
      const item = typeof pack.items[i] === "string" ? { answer: pack.items[i] } : pack.items[i];
      const answer = normalise(item.answer);
      if (!answer) continue;
      totalAnswers++;

      const clue = map && map.get(answer);
      if (clue) {
        totalClued++;
        if (item.clue !== clue) {
          item.clue = clue;
          pack.items[i] = item;
          touched = true;
          written++;
        }
      } else if (!String(item.clue || "").trim()) {
        gaps.push(`${pack.slug}/${answer}`);
      } else {
        totalClued++;
      }
    }
  }

  if (touched && !checkOnly) {
    await writeFile(path, JSON.stringify(parsed, null, 2) + "\n", "utf8");
  }
}

for (const [slug, m] of unused) {
  if (m.size) console.warn(`[clues] ${slug}.json has no matching pack`);
}

const pct = totalAnswers ? Math.round((totalClued / totalAnswers) * 100) : 0;
console.log(
  `[clues] ${totalClued}/${totalAnswers} answers have a written clue (${pct}%)` +
    (checkOnly ? "" : ` — ${written} updated`)
);

if (gaps.length) {
  console.log(`[clues] ${gaps.length} still on the generated fallback:`);
  const byPack = {};
  for (const g of gaps) {
    const slug = g.split("/")[0];
    (byPack[slug] ||= []).push(g.split("/")[1]);
  }
  for (const [slug, list] of Object.entries(byPack)) {
    console.log(`  ${slug.padEnd(24)} ${list.length}`);
  }
}

if (checkOnly && gaps.length) process.exit(1);
