import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getSettings, settingsLoadedAt } from "./settings.js";
import config from "../config.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const PUBLIC = join(HERE, "..", "..", "public");

const cache = new Map();

const SLOT_MARK = {
  beforeGame: "<!--ad:before-game-->",
  afterGame: "<!--ad:after-game-->",
  inContent: "<!--ad:in-content-->",
};

function slotHtml(ads, key) {
  if (!ads || !ads.enabled) return "";
  const slot = ads[key];
  if (!slot || !slot.enabled || !slot.html.trim()) return "";
  return `<div class="ad-slot ad-${key}">${slot.html}</div>`;
}

/**
 * The Search Console meta tag, if one is configured.
 *
 * Accepts either the bare token or the whole `<meta …>` tag Google shows you,
 * because pasting the entire tag into the environment variable is the obvious
 * thing to do and should not silently produce broken markup.
 */
export function siteVerificationTag() {
  const raw = config.google.siteVerification;
  if (!raw) return "";
  const fromTag = raw.match(/content=["']([^"']+)["']/i);
  const token = (fromTag ? fromTag[1] : raw).replace(/[<>"']/g, "").trim();
  if (!token) return "";
  return `<meta name="google-site-verification" content="${token}">`;
}

export function hasCustomCode() {
  const s = getSettings();
  return Boolean(
    s.inject.headScripts.trim() ||
      s.inject.footScripts.trim() ||
      (s.ads.enabled &&
        Object.keys(SLOT_MARK).some((k) => s.ads[k]?.enabled && s.ads[k].html.trim()))
  );
}

export async function renderPage(relPath) {
  const s = getSettings();
  const key = relPath + "|" + settingsLoadedAt();
  const hit = cache.get(key);
  if (hit) return hit;

  let html = await readFile(join(PUBLIC, relPath), "utf8");

  for (const [slot, mark] of Object.entries(SLOT_MARK)) {
    html = html.replace(mark, slotHtml(s.ads, slot));
  }

  // Search Console proof of ownership. Google will not approve an OAuth consent
  // screen whose home page sits on an unverified domain.
  const verify = siteVerificationTag();
  if (verify) html = html.replace("</head>", verify + "\n</head>");

  const head = s.inject.headScripts.trim();
  if (head) html = html.replace("</head>", head + "\n</head>");

  const foot = s.inject.footScripts.trim();
  if (foot) html = html.replace("</body>", foot + "\n</body>");

  if (cache.size > 40) cache.clear();
  cache.set(key, html);
  return html;
}

export function invalidatePages() {
  cache.clear();
}
