#!/usr/bin/env node
/**
 * Builds public/src/dict/<region>/<len>.txt (answers) and
 * extended-<len>.txt (additional accepted guesses) from the editable
 * lexicons in data/.
 *
 * Answers (what the game CHOOSES) are common base-form words: SCOWL's common
 * levels plus the hand-curated lexicons, spelled for the page's dialect, with
 * nothing from blocklist.txt or not-answers.txt.
 *
 * Accepted guesses (what the game ALLOWS) are every real word of the length —
 * dwyl, all of SCOWL, the curated and allow lists — minus the blocklist only.
 * Being generous about what we accept and strict about what we choose is what
 * stops "not in word list" from being annoying.
 *
 *   node scripts/gen-words.mjs
 */

import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const DATA = join(ROOT, "data");
const OUT = join(ROOT, "public", "src", "dict");

const LENGTHS = [3, 4, 5, 6, 7];
const MIN_LEN = 3;
const MAX_LEN = 7;

/* ------------------------------------------------------------------ */
/* reading                                                             */
/* ------------------------------------------------------------------ */

async function readWords(file) {
  let raw;
  try {
    raw = await readFile(join(DATA, file), "utf8");
  } catch {
    console.warn(`[words] ${file} not found — skipping`);
    return [];
  }
  return raw
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .join(" ")
    .split(/[\s,]+/)
    .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))
    .filter(Boolean);
}

/**
 * Reference dictionaries cached by scripts/fetch-reference.mjs.
 * Returns null when absent so the build still works offline — it just falls
 * back to trusting the curated lists verbatim.
 */
async function readReference(lang) {
  try {
    const raw = await readFile(join(DATA, "reference", `${lang}-reference.txt`), "utf8");
    const set = new Set(
      raw.split(/\s+/).map((w) => w.toLowerCase().replace(/[^a-z]/g, "")).filter(Boolean)
    );
    console.log(`[words] reference ${lang}: ${set.size.toLocaleString()} words`);
    return set;
  } catch {
    console.warn(
      `[words] no ${lang} reference — run "node scripts/fetch-reference.mjs" to enable ` +
        `spell-checking and full accepted-guess lists`
    );
    return null;
  }
}

async function readAllMatching(prefix) {
  const files = (await readdir(DATA)).filter(
    (f) => f.startsWith(prefix) && f.endsWith(".txt")
  );
  const out = [];
  for (const f of files.sort()) out.push(...(await readWords(f)));
  return out;
}

/* ------------------------------------------------------------------ */
/* SCOWL — commonness and dialect for every English word                */
/* ------------------------------------------------------------------ */

/**
 * SCOWL (Spell Checker Oriented Word Lists) files every word by how common it
 * is — level 10 is the most common thousand, 35 is what spell-checkers ship as
 * "small", 70 is a large dictionary — and by dialect. Those two facts decide
 * the answers: common enough to be fair, and spelled the way the page's
 * players spell it.
 *
 * Built by scripts/fetch-reference.mjs into data/reference/en-scowl.tsv.
 */
const ANSWER_LEVEL = { 3: 20, 4: 35, 5: 35, 6: 35, 7: 35 };

async function readScowl() {
  let raw;
  try {
    raw = await readFile(join(DATA, "reference", "en-scowl.tsv"), "utf8");
  } catch {
    console.warn('[words] no SCOWL cache — run "node scripts/fetch-reference.mjs"');
    return null;
  }
  const map = new Map();
  for (const line of raw.split("\n")) {
    if (!line || line.startsWith("#")) continue;
    const [w, level, dialects] = line.split("\t");
    map.set(w, { level: Number(level), dialects });
  }
  console.log(`[words] SCOWL: ${map.size.toLocaleString()} words`);
  return map;
}

/* "e" is shared by every dialect. American answers may use e/a, British e/b. */
const inUS = (d) => d.includes("e") || d.includes("a");
const inUK = (d) => d.includes("e") || d.includes("b");
const americanOnly = (d) => !inUK(d) && d.includes("a");
const britishOnly = (d) => !inUS(d) && (d.includes("b") || d.includes("u"));

/**
 * True when the word is a plural, past tense, -ing form, or -iest/-est
 * superlative of another real word. Wordle answers are base forms: CANYON,
 * not CANYONS; TUCK, not TUCKED. The old 6- and 7-letter lists were a third
 * inflections because nothing checked.
 *
 * -er is left alone on purpose: CORNER, NUMBER, POWER and BUTTER all look like
 * a word plus -er and are not.
 */
/* Base words the rules below would otherwise mistake for an inflection. */
const NOT_INFLECTIONS = new Set(["bus", "gas", "yes", "shed", "number"]);

function isInflection(w, D, { pluralsOnly = false } = {}) {
  if (NOT_INFLECTIONS.has(w)) return false;
  const has = (x) => x.length >= 3 && D.has(x);
  if (!w.endsWith("ss")) {
    // HES, UPS, INS: the 2-letter stem is not in a 3–7 letter dictionary
    if (w.length === 3 && w.endsWith("s")) return true;
    if (w.endsWith("ies") && has(w.slice(0, -3) + "y")) return true;
    if (w.endsWith("es") && has(w.slice(0, -2))) return true; // CHILIES, HEROES
    if (w.endsWith("s") && has(w.slice(0, -1))) return true;
    if (w.endsWith("men") && has(w.slice(0, -3) + "man")) return true; // SANDMEN
  }
  if (pluralsOnly) return false;
  if (w.endsWith("ied") && has(w.slice(0, -3) + "y")) return true;
  if (w.endsWith("ed") && w.length >= 4) {
    const b = w.slice(0, -2);
    if (w.length > 4 && has(b)) return true;
    // ACED -> ACE, BAKED -> BAKE, but not SEED -> SEE or FREED -> FREE
    if (w.at(-3) !== "e" && has(w.slice(0, -1))) return true;
    if (b.length >= 3 && b.at(-1) === b.at(-2) && has(b.slice(0, -1))) return true;
  }
  if (w.endsWith("ying") && has(w.slice(0, -4) + "ie")) return true;
  if (w.endsWith("ing") && w.length > 5) {
    const b = w.slice(0, -3);
    if (has(b) || has(b + "e")) return true;
    if (b.length >= 3 && b.at(-1) === b.at(-2) && has(b.slice(0, -1))) return true;
  }
  if (w.endsWith("ier") && w.length >= 5 && has(w.slice(0, -3) + "y")) return true;
  if (w.endsWith("iest") && has(w.slice(0, -4) + "y")) return true;
  // A comparative is an -ER word whose -EST form also exists: CUTER (CUTEST),
  // FREER (FREEST), DIMMER (DIMMEST). CORNER, POWER, BUTTER have none.
  if (w.endsWith("er") && w.length >= 5) {
    if (D.has(w.slice(0, -2) + "est") || D.has(w.slice(0, -1) + "st")) return true;
  }
  if (w.endsWith("est") && w.length > 5) {
    const b = w.slice(0, -3);
    if (has(b) || has(b + "e")) return true;
    if (b.length > 2 && b.at(-1) === b.at(-2) && has(b.slice(0, -1))) return true;
  }
  return false;
}

/**
 * American spellings SCOWL files as shared English. Kept out of the British
 * answer pool; still accepted as guesses there.
 */
const AMERICAN_ONLY = new Set(
  `color honor favor labor humor neighbor armor odor rumor vapor vigor harbor parlor
   savior splendor endeavor behavior clamor glamor tumor center theater liter fiber
   saber somber luster specter caliber meager defense offense pretense gray mold plow
   aluminum jewelry donut airplane traveled traveler canceled modeled labeled
   counselor marvelous skillful fulfill instill enroll appall analyze paralyze
   maneuver mustache pajamas sulfur whiskey ax`
    .split(/\s+/)
    .filter(Boolean)
);

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

function emptyBuckets() {
  return Object.fromEntries(LENGTHS.map((l) => [l, new Set()]));
}

const okLength = (w) => w.length >= MIN_LEN && w.length <= MAX_LEN;

function sortedList(set) {
  return [...set].sort();
}

async function writeRegion(region, answers, extended) {
  const dir = join(OUT, region);
  await mkdir(dir, { recursive: true });

  const report = {};
  for (const len of LENGTHS) {
    const ans = sortedList(answers[len]);
    const ext = sortedList(extended[len]);

    // One word per line: diffs stay readable when the lists are edited later.
    await writeFile(join(dir, `${len}.txt`), ans.join("\n") + "\n", "utf8");
    await writeFile(join(dir, `extended-${len}.txt`), ext.join("\n") + "\n", "utf8");

    report[len] = { answers: ans.length, extended: ext.length, accepted: ans.length + ext.length };
  }
  return report;
}

function table(region, report) {
  const rows = LENGTHS.map((l) => {
    const r = report[l];
    return `    ${l} letters  ${String(r.answers).padStart(6)} answers  ${String(
      r.accepted
    ).padStart(7)} accepted`;
  });
  return `  ${region}\n${rows.join("\n")}`;
}

/**
 * English answers for one dialect: common SCOWL words, the hand-curated
 * lexicon and the allow-list — base forms only, spelled for that dialect,
 * nothing blocked, nothing from not-answers.txt.
 */
function englishAnswers({ scowl, curated, trusted, trustedInflections, allow, blocked, notAnswers, dialect }) {
  const D = new Set(scowl.keys());
  const fits = dialect === "us" ? inUS : inUK;
  const wrongDialect = dialect === "us" ? britishOnly : americanOnly;
  const out = emptyBuckets();
  const dropped = { inflection: 0, dialect: 0, unknown: 0 };

  const consider = (w, { trust = false, pluralsOnly = false } = {}) => {
    if (!okLength(w) || blocked.has(w) || notAnswers.has(w)) return;
    const info = scowl.get(w);
    if (info && wrongDialect(info.dialects)) return void dropped.dialect++;
    if (dialect === "uk" && AMERICAN_ONLY.has(w)) return void dropped.dialect++;
    // A curated word SCOWL has never heard of is almost always a typo or a
    // truncation (FULCRU, GLACIE, CUISIN) — exactly the unguessable puzzle the
    // spell-check exists to stop. Trusted lists (allow-list, UK dialect) skip it.
    if (!info && !trust) return void dropped.unknown++;
    if (isInflection(w, D, { pluralsOnly })) return void dropped.inflection++;
    out[w.length].add(w);
  };

  for (const [w, info] of scowl) {
    if (!okLength(w) || info.level > ANSWER_LEVEL[w.length] || !fits(info.dialects)) continue;
    consider(w);
  }
  for (const w of curated) consider(w);
  for (const w of allow) consider(w, { trust: true });
  for (const w of trusted) consider(w, { trust: true, pluralsOnly: trustedInflections });
  return { byLen: out, dropped };
}

/** Accepted guesses: every real word of the length that is not an answer. */
function acceptedGuesses(sources, answers, blocked) {
  const ext = emptyBuckets();
  for (const src of sources) {
    for (const w of src) {
      if (!okLength(w) || blocked.has(w) || answers[w.length].has(w)) continue;
      ext[w.length].add(w);
    }
  }
  return ext;
}

async function main() {
  const blocked = new Set(await readWords("blocklist.txt"));
  const notAnswers = new Set(await readWords("not-answers.txt"));
  console.log(`[words] blocklist: ${blocked.size} · not-answers: ${notAnswers.size}`);

  const enReference = await readReference("en");
  const idReference = await readReference("id");
  const scowl = await readScowl();
  if (!scowl || !enReference) {
    throw new Error("English reference missing — run node scripts/fetch-reference.mjs");
  }

  /* ---- English (shared inputs) ---- */
  const curated = await readAllMatching("en-core");
  const allow = await readWords("en-allow.txt");
  const ukExtra = await readWords("uk-extra.txt");

  // A curated word that is in no dictionary at all gets a warning, not a puzzle.
  const typos = [...new Set(curated)].filter(
    (w) => okLength(w) && !scowl.has(w) && !enReference.has(w)
  );
  if (typos.length) {
    console.log(`\n[words] en: ${typos.length} curated word(s) found in no dictionary — dropped`);
    console.log(`  ${typos.slice(0, 40).join(" ")}${typos.length > 40 ? " …" : ""}`);
  }

  const common = { scowl, curated, allow, blocked, notAnswers };
  const en = englishAnswers({ ...common, trusted: [], dialect: "us" });
  // British dialect (BAIRN, CWTCH, MARDY) and the -T past tenses (BURNT,
  // SPELT) are often missing from SCOWL or look like inflections, so
  // uk-extra.txt is trusted — only its plurals are filtered out.
  const gb = englishAnswers({ ...common, trusted: ukExtra, trustedInflections: true, dialect: "uk" });

  // Both pages accept both spellings: a UK player typing COLOR, or a US
  // player typing COLOUR, has typed a real word.
  // The curated list is not a source here: every real word in it is already in
  // a reference, and the rest are the typos reported above.
  const enSources = [enReference, [...scowl.keys()], allow, ukExtra];
  const enExtended = acceptedGuesses(enSources, en.byLen, blocked);
  const gbExtended = acceptedGuesses(enSources, gb.byLen, blocked);

  /* ---- Indonesian ---- */
  const idWords = await readWords("id-core.txt");
  const idAnswers = emptyBuckets();
  const idRejected = [];
  for (const w of idWords) {
    if (!okLength(w) || blocked.has(w) || notAnswers.has(w)) continue;
    if (idReference && !idReference.has(w)) {
      idRejected.push(w);
      continue;
    }
    idAnswers[w.length].add(w);
  }
  if (idRejected.length) {
    console.log(`\n[words] id: ${idRejected.length} curated word(s) not in KBBI — dropped`);
    console.log(`  ${[...new Set(idRejected)].sort().join(" ")}`);
  }
  // Indonesian affixation changes word class, so inflecting the curated list
  // would invent nonsense. The KBBI reference supplies acceptance instead.
  const idExtended = acceptedGuesses([idReference || [], idWords], idAnswers, blocked);

  for (const [region, r] of Object.entries({ en, gb })) {
    console.log(
      `[words] ${region}: left out ${r.dropped.inflection} inflected forms, ` +
        `${r.dropped.dialect} other-dialect spellings, ${r.dropped.unknown} unknown curated words`
    );
  }

  /* ---- write ---- */
  const reports = {
    en: await writeRegion("en", en.byLen, enExtended),
    gb: await writeRegion("gb", gb.byLen, gbExtended),
    id: await writeRegion("id", idAnswers, idExtended),
  };

  // SCOWL's licence asks for its notice in every copy, and these lists are
  // published at /src/dict/ — so the notice is published beside them.
  await writeFile(
    join(OUT, "SCOWL-COPYRIGHT.txt"),
    await readFile(join(DATA, "reference", "SCOWL-COPYRIGHT.txt"), "utf8"),
    "utf8"
  );

  console.log("\n[words] dictionaries written to public/src/dict\n");
  for (const [region, report] of Object.entries(reports)) {
    console.log(table(region, report));
  }

  // Every length must be playable or a player can pick a dead setting.
  const problems = [];
  for (const [region, report] of Object.entries(reports)) {
    for (const len of LENGTHS) {
      if (report[len].answers < 20) {
        problems.push(`${region}/${len}.txt has only ${report[len].answers} answers`);
      }
    }
  }
  if (problems.length) {
    console.log("\n[words] thin lists (add more words in data/):");
    for (const p of problems) console.log(`  ! ${p}`);
    process.exitCode = 1;
  }
  console.log("");
}

main().catch((err) => {
  console.error("[words] generation failed:", err);
  process.exit(1);
});
