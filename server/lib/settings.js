import { query, queryStrict, isDbEnabled } from "../db/pool.js";
import config from "../config.js";

/**
 * Runtime-editable site settings.
 *
 * Read path is a plain in-memory object, so hot paths (every page render, every
 * websocket join) never touch the database. Writes go to Postgres and refresh
 * the cache; a periodic reload picks up changes made by another container.
 */
export const DEFAULTS = {
  maintenance: false,
  maintenanceMessage:
    "Wordle Unlimited is getting a quick upgrade. We will be back in a few minutes.",

  modes: {
    daily: true,
    unlimited: true,
    time: true,
    topic: true,
    multiplayer: true,
    challenge: true,
  },

  multiplayer: {
    enabled: true,
    maxOpenRooms: config.rooms.maxOpenRooms,
    maxPlayersPerRoom: config.rooms.maxPlayersPerRoom,
    revealNextAtPercent: config.rooms.revealNextAtPercent,
    roundSeconds: config.rooms.roundSeconds,
    voteSeconds: config.rooms.voteSeconds,
    lobbySeconds: config.rooms.lobbySeconds,
    allowCustomRooms: true,
    wordsToWin: 10,
  },

  features: {
    cloudSave: true,
    sound: true,
    hints: true,
    hardMode: true,
    kidsMode: true,
  },

  announcement: { enabled: false, text: "", href: "" },
};

let cache = structuredClone(DEFAULTS);
let loadedAt = 0;
let reloadTimer = null;

function deepMerge(base, patch) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(patch)) {
    out[k] =
      v && typeof v === "object" && !Array.isArray(v) &&
      out[k] && typeof out[k] === "object" && !Array.isArray(out[k])
        ? deepMerge(out[k], v)
        : v;
  }
  return out;
}

export function getSettings() {
  return cache;
}

export function isMaintenance() {
  return cache.maintenance === true;
}

export async function loadSettings() {
  if (!isDbEnabled()) {
    cache = structuredClone(DEFAULTS);
    loadedAt = Date.now();
    return cache;
  }
  const { rows, ok } = await query("SELECT key, value FROM admin_settings");
  if (!ok) return cache; // DB blip: keep serving the last known-good settings

  let next = structuredClone(DEFAULTS);
  for (const row of rows) {
    next = deepMerge(next, { [row.key]: row.value });
  }
  cache = next;
  loadedAt = Date.now();
  return cache;
}

/** Persist a top-level settings key and refresh the cache immediately. */
export async function setSetting(key, value) {
  if (!Object.prototype.hasOwnProperty.call(DEFAULTS, key)) {
    throw new Error(`Unknown setting: ${key}`);
  }
  await queryStrict(
    `INSERT INTO admin_settings (key, value, updated_at)
     VALUES ($1, $2::jsonb, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
  cache = deepMerge(cache, { [key]: value });
  return cache;
}

export function startSettingsReloader(intervalMs = 30_000) {
  stopSettingsReloader();
  reloadTimer = setInterval(() => {
    loadSettings().catch(() => {});
  }, intervalMs);
  reloadTimer.unref?.();
}

export function stopSettingsReloader() {
  if (reloadTimer) clearInterval(reloadTimer);
  reloadTimer = null;
}

export function settingsLoadedAt() {
  return loadedAt;
}
