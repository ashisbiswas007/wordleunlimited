import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { getPool, queryStrict, isDbEnabled } from "./pool.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(HERE, "migrations");

async function ensureMigrationsTable() {
  await queryStrict(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
}

/**
 * Applies any .sql file in migrations/ that has not run yet, in filename order.
 * Each file runs inside a transaction so a failure leaves nothing half-applied.
 */
export async function migrate({ silent = false } = {}) {
  if (!isDbEnabled()) {
    if (!silent) console.warn("[db] DATABASE_URL not set — skipping migrations");
    return { applied: [], skipped: true };
  }

  await ensureMigrationsTable();

  const { rows } = await queryStrict("SELECT name FROM schema_migrations");
  const done = new Set(rows.map((r) => r.name));

  const files = (await readdir(MIGRATIONS_DIR))
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const applied = [];
  const pool = getPool();

  for (const file of files) {
    if (done.has(file)) continue;
    const sql = await readFile(join(MIGRATIONS_DIR, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      applied.push(file);
      if (!silent) console.log(`[db] applied migration ${file}`);
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw new Error(`Migration ${file} failed: ${err.message}`);
    } finally {
      client.release();
    }
  }

  if (!silent && applied.length === 0) console.log("[db] schema up to date");
  return { applied, skipped: false };
}

// Allow `npm run migrate` as a standalone command.
if (process.argv[1] && process.argv[1].endsWith("migrate.js")) {
  migrate()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err.message);
      process.exit(1);
    });
}
