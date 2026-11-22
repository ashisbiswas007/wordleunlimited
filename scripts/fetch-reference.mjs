#!/usr/bin/env node
/**
 * Downloads reference dictionaries once and caches them under data/reference/.
 *
 * The cached files are committed to the repo so `docker build` never needs
 * network access — run this locally when you want to refresh them.
 *
 * Sources:
 *   English    dwyl/english-words (words_alpha.txt) — Unlicense / public domain
 *   English    SCOWL via the wordlist-english package — SCOWL licence, notice
 *              kept in data/reference/SCOWL-COPYRIGHT.txt. Carries a
 *              commonness level and a dialect for every word, which is what
 *              picks answers and keeps American and British spellings apart.
 *   Indonesian geovedi/indonesian-wordlist (KBBI 3rd ed. + aggregate list)
 *
 *   node scripts/fetch-reference.mjs                 everything
 *   node scripts/fetch-reference.mjs --scowl-dir DIR  SCOWL from an unpacked
 *                                                     wordlist-english package
 *
 * The reference lists are used two ways by gen-words.mjs:
 *   1. to VALIDATE the hand-curated answer lists (drops typos)
 *   2. to BUILD the accepted-guess lists (so real words are never rejected)
 *
 *   node scripts/fetch-reference.mjs
 */

import { writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const REF_DIR = join(HERE, "..", "data", "reference");

const MIN_LEN = 3;
const MAX_LEN = 7;
const TIMEOUT_MS = 60_000;

const SOURCES = {
  en: [
    "https://raw.githubusercontent.com/dwyl/english-words/master/words_alpha.txt",
  ],
  id: [
    "https://raw.githubusercontent.com/geovedi/indonesian-wordlist/master/01-kbbi3-2001-sort-alpha.lst",
    "https://raw.githubusercontent.com/geovedi/indonesian-wordlist/master/00-indonesian-wordlist.lst",
  ],
};

async function download(url) {
  process.stdout.write(`  fetching ${url.split("/").pop()} … `);
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  console.log(`${(text.length / 1048576).toFixed(1)} MB`);
  return text;
}

function normalise(text) {
  const out = new Set();
  for (const raw of text.split(/[\s,]+/)) {
    const w = raw
      .toLowerCase()
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/[^a-z]/g, "");
    if (w.length >= MIN_LEN && w.length <= MAX_LEN) out.add(w);
  }
  return out;
}

async function build(lang, urls) {
  console.log(`\n[reference] ${lang}`);
  const all = new Set();
  let ok = 0;

  for (const url of urls) {
    try {
      const text = await download(url);
      for (const w of normalise(text)) all.add(w);
      ok++;
    } catch (err) {
      console.log(`  ! failed: ${err.message}`);
    }
  }

  if (!ok) {
    console.log(`  ! no sources succeeded for ${lang} — keeping any existing cache`);
    return null;
  }

  const sorted = [...all].sort();
  await mkdir(REF_DIR, { recursive: true });
  const file = join(REF_DIR, `${lang}-reference.txt`);
  await writeFile(file, sorted.join("\n") + "\n", "utf8");

  const byLen = {};
  for (const w of sorted) byLen[w.length] = (byLen[w.length] || 0) + 1;

  console.log(`  wrote ${sorted.length.toLocaleString()} words -> data/reference/${lang}-reference.txt`);
  console.log(
    `  ${Object.entries(byLen)
      .map(([l, n]) => `${l}:${n.toLocaleString()}`)
      .join("  ")}`
  );
  return sorted.length;
}

/* ---------- SCOWL ---------- */

const SCOWL_VERSION = "1.2.1"; // wordlist-english on npm
const SCOWL_LEVELS = [10, 20, 35, 40, 50, 55, 60, 70];
// e = every dialect, a = American, b = British, c = Canadian, u = Australian
const SCOWL_DIALECTS = { english: "e", american: "a", british: "b", canadian: "c", australian: "u" };

async function scowlList(dir, name) {
  if (dir) {
    const { readFile } = await import("node:fs/promises");
    try {
      return JSON.parse(await readFile(join(dir, `${name}.json`), "utf8"));
    } catch {
      return [];
    }
  }
  const url = `https://cdn.jsdelivr.net/npm/wordlist-english@${SCOWL_VERSION}/${name}.json`;
  try {
    return JSON.parse(await download(url));
  } catch (err) {
    console.log(`  ! ${name}: ${err.message}`);
    return [];
  }
}

/** One line per word: word, lowest SCOWL level it appears at, its dialects. */
async function buildScowl(dir) {
  console.log("\n[reference] SCOWL");
  const words = new Map();
  for (const lvl of SCOWL_LEVELS) {
    for (const [dialect, code] of Object.entries(SCOWL_DIALECTS)) {
      for (const raw of await scowlList(dir, `${dialect}-words-${lvl}`)) {
        // café -> cafe, cliché -> cliche; apostrophes and capitals are not words here
        const w = raw.normalize("NFD").replace(/[\u0300-\u036f]/g, "");
        if (!/^[a-z]+$/.test(w) || w.length < MIN_LEN || w.length > MAX_LEN) continue;
        const cur = words.get(w) || { level: lvl, dialects: new Set() };
        cur.level = Math.min(cur.level, lvl);
        cur.dialects.add(code);
        words.set(w, cur);
      }
    }
  }
  if (!words.size) {
    console.log("  ! nothing fetched — keeping any existing cache");
    return;
  }
  const lines = [...words.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([w, { level, dialects }]) => `${w}\t${level}\t${[...dialects].sort().join("")}`);
  await mkdir(REF_DIR, { recursive: true });
  await writeFile(
    join(REF_DIR, "en-scowl.tsv"),
    "# word<TAB>SCOWL level (10 = most common … 70)<TAB>dialects (e any, a US, b UK, c CA, u AU)\n" +
      lines.join("\n") + "\n",
    "utf8"
  );
  console.log(`  wrote ${lines.length.toLocaleString()} words -> data/reference/en-scowl.tsv`);
}

async function main() {
  const dirIdx = process.argv.indexOf("--scowl-dir");
  const scowlDir = dirIdx > -1 ? process.argv[dirIdx + 1] : null;
  if (scowlDir) {
    await buildScowl(scowlDir);
    return;
  }
  console.log("[reference] downloading dictionaries (one-off; results are committed)");
  for (const [lang, urls] of Object.entries(SOURCES)) {
    await build(lang, urls);
  }
  await buildScowl(null);
  console.log("\n[reference] done — now run: node scripts/gen-words.mjs\n");
}

main().catch((err) => {
  console.error("[reference] failed:", err.message);
  process.exit(1);
});
