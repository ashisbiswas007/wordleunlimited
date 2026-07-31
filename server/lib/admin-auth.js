import { randomBytes } from "node:crypto";
import { hashPassword, verifyPassword } from "./crypto.js";
import { query, queryStrict, isDbEnabled } from "../db/pool.js";
import config from "../config.js";

/**
 * Resolves the admin password from, in order of precedence:
 *
 *   1. a hash stored in the database  — set via "change password" in /admin,
 *      so a change made in the UI actually sticks and outranks the env var
 *   2. ADMIN_PASSWORD_HASH            — pre-hashed, the most secure option
 *   3. ADMIN_PASSWORD                 — plain text in the deploy environment,
 *      hashed at boot and never stored in the clear
 *   4. auto-generated on first boot   — printed once to the container logs
 *
 * Option 3 is the practical one for Coolify: type a password into the
 * environment variables and deploy. Option 4 means a fresh deploy is never
 * locked out even if you forget to set anything.
 */

let cachedHash = null;
let source = "none";
let mustChange = false;
let generatedOnce = null;

/** Readable, hyphenated, and safe to copy out of a log pane. */
function generatePassword() {
  const alphabet = "abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(20);
  let out = "";
  for (let i = 0; i < 20; i++) {
    if (i > 0 && i % 5 === 0) out += "-";
    out += alphabet[bytes[i] % alphabet.length];
  }
  return out;
}

/** ASCII only — log viewers and terminals mangle box-drawing characters. */
function banner(lines) {
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  const bar = "=".repeat(width + 2);
  console.log(`\n+${bar}+`);
  for (const l of lines) console.log(`|  ${l.padEnd(width - 2)}  |`);
  console.log(`+${bar}+\n`);
}

async function readStoredHash() {
  if (!isDbEnabled()) return null;
  const { rows, ok } = await query(
    "SELECT password_hash, must_change FROM admin_credentials WHERE username = $1",
    [config.admin.user]
  );
  if (!ok || !rows.length) return null;
  return { hash: rows[0].password_hash, mustChange: rows[0].must_change };
}

async function storeHash(hash, needsChange) {
  if (!isDbEnabled()) return false;
  try {
    await queryStrict(
      `INSERT INTO admin_credentials (username, password_hash, must_change, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (username) DO UPDATE
         SET password_hash = EXCLUDED.password_hash,
             must_change   = EXCLUDED.must_change,
             updated_at    = now()`,
      [config.admin.user, hash, needsChange]
    );
    return true;
  } catch (err) {
    console.error("[admin] could not persist password:", err.message);
    return false;
  }
}

export async function initAdminAuth() {
  const stored = await readStoredHash();
  if (stored) {
    cachedHash = stored.hash;
    mustChange = stored.mustChange;
    source = "database";
    console.log(`[admin] login ready for "${config.admin.user}" (password set in /admin)`);
    return { source, mustChange };
  }

  if (config.admin.passwordHash) {
    cachedHash = config.admin.passwordHash;
    source = "env:ADMIN_PASSWORD_HASH";
    console.log(`[admin] login ready for "${config.admin.user}" (ADMIN_PASSWORD_HASH)`);
    return { source, mustChange: false };
  }

  if (config.admin.password) {
    cachedHash = await hashPassword(config.admin.password);
    source = "env:ADMIN_PASSWORD";
    // Persisted so the login keeps working even if the variable is later removed.
    await storeHash(cachedHash, false);
    console.log(`[admin] login ready for "${config.admin.user}" (ADMIN_PASSWORD)`);
    return { source, mustChange: false };
  }

  // Nothing configured — mint one so a fresh deploy is never locked out.
  const password = generatePassword();
  cachedHash = await hashPassword(password);
  mustChange = true;
  source = "generated";
  const persisted = await storeHash(cachedHash, true);
  generatedOnce = password;

  banner([
    "ADMIN PASSWORD GENERATED",
    "",
    `  URL:       ${config.siteUrl}/admin`,
    `  Username:  ${config.admin.user}`,
    `  Password:  ${password}`,
    "",
    "This is shown ONCE. Copy it now, then change it in /admin.",
    persisted
      ? "Saved to the database — it survives restarts."
      : "No database configured, so this resets on every restart.",
    "To set your own instead: add ADMIN_PASSWORD to the environment.",
  ]);

  return { source, mustChange: true, password };
}

export async function verifyAdminPassword(password) {
  if (!cachedHash) return false;
  return verifyPassword(password, cachedHash);
}

export async function changeAdminPassword(currentPassword, newPassword) {
  if (!cachedHash) return { error: "not_configured" };
  if (!(await verifyPassword(currentPassword, cachedHash))) {
    return { error: "wrong_password" };
  }
  if (typeof newPassword !== "string" || newPassword.length < 12) {
    return { error: "too_short", message: "Use at least 12 characters." };
  }
  if (!isDbEnabled()) {
    return {
      error: "no_database",
      message: "Changing the password needs DATABASE_URL configured.",
    };
  }

  const hash = await hashPassword(newPassword);
  const ok = await storeHash(hash, false);
  if (!ok) return { error: "save_failed" };

  cachedHash = hash;
  source = "database";
  mustChange = false;
  generatedOnce = null;
  return { ok: true };
}

export function adminAuthStatus() {
  return {
    configured: Boolean(cachedHash),
    source,
    mustChange,
    // Surfaced in the admin UI as a "change this" nudge, never the password itself.
    usingGeneratedPassword: source === "generated",
  };
}

/** Reprints the generated password — used only by the /admin bootstrap notice. */
export function peekGeneratedPassword() {
  return generatedOnce;
}
