#!/usr/bin/env node
/**
 * Builds public/src/dict/<region>/<len>.txt (answers) and
 * extended-<len>.txt (additional accepted guesses) from the editable
 * lexicons in data/.
 *
 * Answers are the curated words only. The extended lists add inflected forms
 * so a player typing a legitimate plural or past tense is never told
 * "not in word list" — being slightly permissive about what we ACCEPT is far
 * less annoying than rejecting a real word, while the words we CHOOSE stay
 * tightly curated.
 *
 *   node scripts/gen-words.mjs
 *   node scripts/gen-words.mjs --augment path/to/big-wordlist.txt
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
/* morphology — generates plausible inflections of a base word          */
/* ------------------------------------------------------------------ */

const VOWELS = new Set(["a", "e", "i", "o", "u"]);
const isVowel = (c) => VOWELS.has(c);

/** Consonant–vowel–consonant ending (but not w/x/y) doubles: hop → hopped. */
function doublesFinal(w) {
  if (w.length < 3) return false;
  const [a, b, c] = [w.at(-3), w.at(-2), w.at(-1)];
  return !isVowel(a) && isVowel(b) && !isVowel(c) && !"wxy".includes(c);
}

function pluralOf(w) {
  const last = w.at(-1);
  const last2 = w.slice(-2);
  if (["s", "x", "z"].includes(last) || ["ch", "sh", "ss"].includes(last2)) {
    return [`${w}es`];
  }
  if (last === "y" && !isVowel(w.at(-2))) return [`${w.slice(0, -1)}ies`];
  if (last === "f") return [`${w.slice(0, -1)}ves`, `${w}s`];
  if (last2 === "fe") return [`${w.slice(0, -2)}ves`, `${w}s`];
  if (last === "o" && !isVowel(w.at(-2))) return [`${w}es`, `${w}s`];
  return [`${w}s`];
}

function pastOf(w) {
  const last = w.at(-1);
  if (last === "e") return [`${w}d`];
  if (last === "y" && !isVowel(w.at(-2))) return [`${w.slice(0, -1)}ied`];
  if (doublesFinal(w)) return [`${w}${last}ed`];
  return [`${w}ed`];
}

function ingOf(w) {
  const last = w.at(-1);
  if (last === "e" && w.at(-2) !== "e" && w.length > 3) {
    return [`${w.slice(0, -1)}ing`];
  }
  if (doublesFinal(w)) return [`${w}${last}ing`];
  return [`${w}ing`];
}

function comparativesOf(w) {
  // Only worth generating for short, adjective-shaped words.
  if (w.length > 6) return [];
  const last = w.at(-1);
  if (last === "e") return [`${w}r`, `${w}st`];
  if (last === "y" && !isVowel(w.at(-2))) {
    return [`${w.slice(0, -1)}ier`, `${w.slice(0, -1)}iest`];
  }
  if (doublesFinal(w)) return [`${w}${last}er`, `${w}${last}est`];
  return [`${w}er`, `${w}est`];
}

function inflect(w) {
  const out = [];
  out.push(...pluralOf(w), ...pastOf(w), ...ingOf(w), ...comparativesOf(w));
  return out.filter((x) => x.length >= MIN_LEN && x.length <= MAX_LEN);
}

/* ------------------------------------------------------------------ */
/* British English derivation                                          */
/* ------------------------------------------------------------------ */

/** Suffix rules that are safe to apply — but only to the words below. */
const UK_SUFFIX_RULES = [
  [/ization$/, "isation"],
  [/izations$/, "isations"],
  [/izing$/, "ising"],
  [/ized$/, "ised"],
  [/izes$/, "ises"],
  [/ize$/, "ise"],
  [/yzing$/, "ysing"],
  [/yzed$/, "ysed"],
  [/yzes$/, "yses"],
  [/yze$/, "yse"],
];

/**
 * Words where -ize/-yze is part of the ROOT, not the verb-forming suffix.
 * Applying the rule to these produces nonsense (MAIZE -> MAISE, CAPSIZE ->
 * CAPSISE), and they are spelled with a Z in British English too.
 */
const IZE_IS_ROOT = new Set(
  `size sizes sized sizing resize resizes resized resizing
   downsize downsized downsizing oversize oversized
   prize prizes prized prizing
   maize baize assize assizes capsize capsizes capsized capsizing
   seize seizes seized seizing
   gaze gazes gazed gazing
   analyzes`
    .split(/\s+/)
    .filter(Boolean)
);

/**
 * Spellings that are American-only. Removed from the UK answer pool so the
 * game never asks a British player to guess COLOR.
 * Words valid in both varieties (METER the device, CHECK the verb, CURB the
 * verb) are deliberately absent from this list.
 */
const AMERICAN_ONLY = new Set(
  `color colors honor honors favor favors labor labors humor humors neighbor neighbors
   armor armors odor odors rumor rumors vapor vapors vigor harbor harbors parlor parlors
   savior saviors splendor endeavor behavior behaviors clamor glamor tumor tumors succor
   center centers centered centering theater theaters liter liters fiber fibers saber sabers
   somber luster specter specters caliber calibers meager sepulcher
   defense defenses offense offenses pretense pretenses
   gray grayer grayest mold molds molding molded plow plows plowed plowing
   aluminum jewelry donut donuts airplane
   traveled traveling traveler canceled canceling modeled modeling labeled labeling
   signaled signaling counselor marvelous
   skillful fulfill fulfills instill instills enroll enrolls appall appalls
   tire tires tired program programs
   analyze analyzed analyzing paralyze paralyzed realize realized realizing
   organize organized apologize apologized recognize recognized criticize criticized
   emphasize emphasized specialize specialized memorize memorized civilize civilized
   check checks maneuver maneuvers mustache pajamas sulfur story stories
   whiskey ax axes`
    .split(/\s+/)
    .filter(Boolean)
);

function toBritish(word) {
  if (IZE_IS_ROOT.has(word)) return null;
  for (const [re, rep] of UK_SUFFIX_RULES) {
    if (!re.test(word)) continue;
    // "size" -> stem "s" is not a real verb; require a stem worth suffixing.
    const stem = word.replace(re, "");
    if (stem.length < 4) return null;
    return word.replace(re, rep);
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* build                                                               */
/* ------------------------------------------------------------------ */

/**
 * Files curated words by their ACTUAL length (so a word typed into the wrong
 * section still lands correctly), drops blocked words, and — when a reference
 * dictionary is available — drops anything that is not a real word.
 * `allowExtra` holds words the reference legitimately lacks (British dialect).
 */
function bucket(words, blocked, reference, allowExtra) {
  const byLen = Object.fromEntries(LENGTHS.map((l) => [l, new Set()]));
  const rejected = [];

  for (const w of words) {
    if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
    if (blocked.has(w)) continue;
    if (reference && !reference.has(w) && !(allowExtra && allowExtra.has(w))) {
      rejected.push(w);
      continue;
    }
    byLen[w.length].add(w);
  }

  return { byLen, rejected: [...new Set(rejected)].sort() };
}

/**
 * Accepted-guess list = every real word of that length that is not already an
 * answer. Built from the reference when present; otherwise fall back to
 * inflecting the curated list so at least plurals and past tenses are accepted.
 */
function buildExtended(byLen, blocked, reference) {
  const ext = Object.fromEntries(LENGTHS.map((l) => [l, new Set()]));

  if (reference) {
    for (const w of reference) {
      if (w.length < MIN_LEN || w.length > MAX_LEN) continue;
      if (blocked.has(w)) continue;
      if (byLen[w.length].has(w)) continue;
      ext[w.length].add(w);
    }
    return ext;
  }

  for (const len of LENGTHS) {
    for (const w of byLen[len]) {
      for (const form of inflect(w)) {
        if (blocked.has(form)) continue;
        if (byLen[form.length]?.has(form)) continue;
        ext[form.length].add(form);
      }
    }
  }
  return ext;
}

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

async function main() {
  const augmentIdx = process.argv.indexOf("--augment");
  const augmentFile = augmentIdx > -1 ? process.argv[augmentIdx + 1] : null;

  const blocked = new Set(await readWords("blocklist.txt"));
  console.log(`[words] blocklist: ${blocked.size} entries`);

  const enReference = await readReference("en");
  const idReference = await readReference("id");

  /* ---- English ---- */
  const enBase = await readAllMatching("en-core");
  let enWords = enBase;

  if (augmentFile) {
    try {
      const extra = (await readFile(augmentFile, "utf8"))
        .split(/[\s,]+/)
        .map((w) => w.toLowerCase().replace(/[^a-z]/g, ""))
        .filter((w) => w.length >= MIN_LEN && w.length <= MAX_LEN);
      console.log(`[words] augmenting with ${extra.length} words from ${augmentFile}`);
      enWords = enWords.concat(extra);
    } catch (err) {
      console.warn(`[words] could not read ${augmentFile}: ${err.message}`);
    }
  }

  // Valid words the reference is simply missing (modern vocabulary).
  const enAllow = new Set(await readWords("en-allow.txt"));
  enWords = enWords.concat([...enAllow]);

  const en = bucket(enWords, blocked, enReference, enAllow);
  const enExtended = buildExtended(en.byLen, blocked, enReference);
  // The allow-list words must be accepted as guesses too, not just as answers.
  for (const w of enAllow) {
    if (w.length >= MIN_LEN && w.length <= MAX_LEN && !blocked.has(w)) {
      if (!en.byLen[w.length].has(w)) enExtended[w.length].add(w);
    }
  }

  /* ---- British ---- */
  const ukExtra = await readWords("uk-extra.txt");
  const ukExtraSet = new Set(ukExtra);
  const gbWords = [];

  for (const w of enWords) {
    if (AMERICAN_ONLY.has(w)) {
      const swapped = toBritish(w);
      if (swapped) gbWords.push(swapped);
      continue; // drop the American spelling from the UK answer pool entirely
    }
    gbWords.push(w);
    const swapped = toBritish(w);
    if (swapped) gbWords.push(swapped);
  }
  gbWords.push(...ukExtra);

  // British dialect (BAIRN, CWTCH, MARDY) is often missing from a US-built
  // reference, so uk-extra.txt and the allow-list are trusted as-is.
  const gbTrusted = new Set([...ukExtraSet, ...enAllow]);
  const gb = bucket(gbWords, blocked, enReference, gbTrusted);

  // UK players may still TYPE American spellings — the FAQ promises those are
  // accepted as guesses even though they are never chosen as answers.
  const gbExtended = buildExtended(gb.byLen, blocked, enReference);
  for (const w of AMERICAN_ONLY) {
    if (w.length >= MIN_LEN && w.length <= MAX_LEN && !blocked.has(w)) {
      if (!gb.byLen[w.length].has(w)) gbExtended[w.length].add(w);
    }
  }

  /* ---- Indonesian ---- */
  const idWords = await readWords("id-core.txt");
  const id = bucket(idWords, blocked, idReference, null);
  // Indonesian affixation changes word class, so inflecting the curated list
  // would invent nonsense. The KBBI reference supplies acceptance instead.
  const idExtended = buildExtended(id.byLen, blocked, idReference);

  /* ---- report rejects before writing ---- */
  for (const [region, res] of Object.entries({ en, gb, id })) {
    if (!res.rejected.length) continue;
    console.log(
      `\n[words] ${region}: dropped ${res.rejected.length} curated word(s) not found in the reference dictionary`
    );
    console.log(`  ${res.rejected.slice(0, 40).join(" ")}${res.rejected.length > 40 ? " …" : ""}`);
  }

  /* ---- write ---- */
  const reports = {
    en: await writeRegion("en", en.byLen, enExtended),
    gb: await writeRegion("gb", gb.byLen, gbExtended),
    id: await writeRegion("id", id.byLen, idExtended),
  };

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
  }
  console.log("");
}

main().catch((err) => {
  console.error("[words] generation failed:", err);
  process.exit(1);
});
