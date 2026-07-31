import pg from "pg";
import config from "../config.js";

let pool = null;
let available = false;

export function isDbEnabled() {
  return Boolean(config.databaseUrl);
}

/** True only once a query has actually succeeded. Callers use this to degrade gracefully. */
export function isDbAvailable() {
  return available;
}

export function getPool() {
  if (!config.databaseUrl) return null;
  if (pool) return pool;

  pool = new pg.Pool({
    connectionString: config.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    // Coolify's internal Postgres link is plaintext on the private network.
    ssl: /sslmode=require/.test(config.databaseUrl)
      ? { rejectUnauthorized: false }
      : false,
  });

  // Without this an idle-client error takes the whole process down.
  pool.on("error", (err) => {
    available = false;
    console.error("[db] idle client error:", err.message);
  });

  return pool;
}

/**
 * Run a query. Never throws — returns { rows: [] } and flips `available` off on
 * failure so page rendering and gameplay keep working during a DB outage.
 */
export async function query(text, params) {
  const p = getPool();
  if (!p) return { rows: [], rowCount: 0, ok: false };
  try {
    const res = await p.query(text, params);
    available = true;
    return { ...res, ok: true };
  } catch (err) {
    available = false;
    console.error("[db] query failed:", err.message);
    return { rows: [], rowCount: 0, ok: false, error: err };
  }
}

/** Like `query` but propagates errors — for migrations and admin writes. */
export async function queryStrict(text, params) {
  const p = getPool();
  if (!p) throw new Error("DATABASE_URL is not configured");
  const res = await p.query(text, params);
  available = true;
  return res;
}

export async function closePool() {
  if (pool) {
    await pool.end().catch(() => {});
    pool = null;
    available = false;
  }
}
