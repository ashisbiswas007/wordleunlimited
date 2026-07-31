#!/usr/bin/env node
/**
 * Downloads reference dictionaries once and caches them under data/reference/.
 *
 * The cached files are committed to the repo so `docker build` never needs
 * network access — run this locally when you want to refresh them.
 *
 * Sources:
 *   English    dwyl/english-words (words_alpha.txt) — Unlicense / public domain
 *   Indonesian geovedi/indonesian-wordlist (KBBI 3rd ed. + aggregate list)
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

async function main() {
  console.log("[reference] downloading dictionaries (one-off; results are committed)");
  for (const [lang, urls] of Object.entries(SOURCES)) {
    await build(lang, urls);
  }
  console.log("\n[reference] done — now run: node scripts/gen-words.mjs\n");
}

main().catch((err) => {
  console.error("[reference] failed:", err.message);
  process.exit(1);
});
