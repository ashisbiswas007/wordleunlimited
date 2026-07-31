#!/usr/bin/env node
/**
 * Hand-written lexicons pick up truncation typos ("comfor" for "comfort").
 * They have a recognisable shape: the fragment is a strict prefix of a longer
 * word in the same list, where the extra letter is NOT a normal inflection.
 *
 * Reports candidates for review — it does not delete anything, because
 * legitimate pairs exist (close/closer, plant/plants).
 *
 *   node scripts/find-truncations.mjs [region]
 */

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DICT = join(HERE, "..", "public", "src", "dict");
const LENGTHS = [3, 4, 5, 6, 7];

// Endings that make a longer word a legitimate inflection of the shorter one.
const INFLECTION_TAILS = new Set(["s", "d", "r", "n", "y", "g"]);

async function load(region, len, kind = "") {
  const file = join(DICT, region, `${kind}${len}.txt`);
  try {
    return (await readFile(file, "utf8")).split("\n").map((w) => w.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

async function main() {
  const region = process.argv[2] || "en";

  // Only answer lists matter here: the extended lists are generated, not typed.
  const byLen = {};
  for (const len of LENGTHS) byLen[len] = await load(region, len);

  const setByLen = {};
  for (const len of LENGTHS) setByLen[len] = new Set(byLen[len]);

  const suspects = [];
  for (const len of LENGTHS) {
    const longer = byLen[len + 1];
    if (!longer || !longer.length) continue;

    // Index the longer list by its first `len` characters for a linear scan.
    const prefixes = new Map();
    for (const cand of longer) {
      const key = cand.slice(0, len);
      if (!prefixes.has(key)) prefixes.set(key, []);
      prefixes.get(key).push(cand);
    }

    for (const w of byLen[len]) {
      const matches = prefixes.get(w);
      if (!matches) continue;
      for (const cand of matches) {
        const tail = cand.slice(len);
        if (tail.length !== 1 || INFLECTION_TAILS.has(tail)) continue;
        suspects.push({ fragment: w, likely: cand, len });
        break;
      }
    }
  }

  suspects.sort((a, b) => a.len - b.len || a.fragment.localeCompare(b.fragment));

  console.log(`\n[${region}] ${suspects.length} truncation candidate(s):\n`);
  for (const s of suspects) {
    console.log(`  ${s.fragment.padEnd(10)} -> probably "${s.likely}"`);
  }
  console.log(
    `\nReview these. Real words (e.g. "plan" next to "plant") are false positives —\n` +
      `only add genuine typos to data/blocklist.txt, then re-run gen-words.\n`
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
