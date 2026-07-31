import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const DICT_DIR = join(HERE, "..", "..", "public", "src", "dict");

const REGIONS = ["en", "gb", "id"];
const LENGTHS = [3, 4, 5, 6, 7];

/**
 * answers[region][len] -> string[]   words the server may pick as a solution
 * valid[region][len]   -> Set        everything accepted as a guess
 *
 * Loaded once at boot and shared by every room. Roughly 6–10 MB resident for
 * all three regions, which is far cheaper than re-reading per match.
 */
const answers = Object.create(null);
const valid = Object.create(null);
let ready = false;

function parseList(txt) {
  const s = String(txt).replace(/^﻿/, "").trim();
  let arr = null;
  if (s.charAt(0) === "[") {
    try {
      arr = JSON.parse(s);
    } catch {
      arr = null;
    }
  }
  if (!arr) arr = s.split(/[\s,]+/);
  return arr
    .map((w) => String(w).replace(/["'[\],]/g, "").toUpperCase().trim())
    .filter((w) => /^[A-Z]+$/.test(w));
}

async function readListFile(...parts) {
  try {
    return parseList(await readFile(join(DICT_DIR, ...parts), "utf8"));
  } catch {
    return [];
  }
}

export async function loadDictionaries() {
  if (ready) return { ready: true };

  for (const region of REGIONS) {
    answers[region] = Object.create(null);
    valid[region] = Object.create(null);

    for (const len of LENGTHS) {
      const core = (await readListFile(region, `${len}.txt`)).filter(
        (w) => w.length === len
      );
      const extended = (await readListFile(region, `extended-${len}.txt`)).filter(
        (w) => w.length === len
      );

      answers[region][len] = core;
      // A guess is valid if it is an answer OR in the wider acceptance list.
      const set = new Set(core);
      for (const w of extended) set.add(w);
      valid[region][len] = set;
    }
  }

  ready = true;
  const total = REGIONS.reduce(
    (sum, r) => sum + LENGTHS.reduce((s, l) => s + valid[r][l].size, 0),
    0
  );
  console.log(`[words] dictionaries loaded — ${total.toLocaleString()} accepted guesses`);
  return { ready: true, total };
}

export function isReady() {
  return ready;
}

export function hasWords(region, len) {
  return Boolean(answers[region]?.[len]?.length);
}

export function answerCount(region, len) {
  return answers[region]?.[len]?.length || 0;
}

/** Falls back to `en` if a region pack is missing, so a match never dead-ends. */
function pool(region, len) {
  const list = answers[region]?.[len];
  if (list && list.length) return list;
  return answers.en?.[len] || [];
}

export function randomWord(region, len) {
  const list = pool(region, len);
  if (!list.length) return "";
  return list[(Math.random() * list.length) | 0];
}

/**
 * A deterministic, non-repeating sequence for a match, so every player in a
 * room gets the same words in the same order.
 */
export function wordSequence(region, len, count, seed = Date.now()) {
  const list = pool(region, len);
  if (!list.length) return [];

  const out = [];
  const used = new Set();
  let s = seed >>> 0;
  const next = () => {
    // mulberry32
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const target = Math.min(count, list.length);
  let guard = 0;
  while (out.length < target && guard++ < count * 50) {
    const w = list[(next() * list.length) | 0];
    if (!used.has(w)) {
      used.add(w);
      out.push(w);
    }
  }
  return out;
}

export function isValidGuess(region, len, word) {
  const w = String(word || "").toUpperCase();
  if (w.length !== len) return false;
  const set = valid[region]?.[len];
  if (set && set.has(w)) return true;
  // Region pack missing entirely — accept against English rather than
  // rejecting every guess the player makes.
  return Boolean(!set?.size && valid.en?.[len]?.has(w));
}

/**
 * Standard Wordle scoring with correct duplicate-letter handling:
 * greens are claimed first, then yellows consume remaining letter counts.
 * Returns an array of "correct" | "present" | "absent".
 */
export function evaluate(guess, answer) {
  const n = answer.length;
  const res = new Array(n).fill("absent");
  const counts = Object.create(null);

  for (let i = 0; i < n; i++) counts[answer[i]] = (counts[answer[i]] || 0) + 1;
  for (let i = 0; i < n; i++) {
    if (guess[i] === answer[i]) {
      res[i] = "correct";
      counts[guess[i]]--;
    }
  }
  for (let i = 0; i < n; i++) {
    if (res[i] === "correct") continue;
    if (counts[guess[i]] > 0) {
      res[i] = "present";
      counts[guess[i]]--;
    }
  }
  return res;
}

/** Compact wire form: 2 = correct, 1 = present, 0 = absent. */
export function encodePattern(evals) {
  return evals.map((e) => (e === "correct" ? 2 : e === "present" ? 1 : 0));
}

export function stats() {
  const out = {};
  for (const r of REGIONS) {
    out[r] = {};
    for (const l of LENGTHS) {
      out[r][l] = {
        answers: answers[r]?.[l]?.length || 0,
        accepted: valid[r]?.[l]?.size || 0,
      };
    }
  }
  return out;
}
