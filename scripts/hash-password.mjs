#!/usr/bin/env node
/**
 * Generates the scrypt hash for ADMIN_PASSWORD_HASH.
 *
 *   node scripts/hash-password.mjs "my admin password"
 *
 * Paste the output into your .env or Coolify environment variables.
 * The plaintext password is never stored anywhere.
 */

import { hashPassword } from "../server/lib/crypto.js";
import { randomBytes } from "node:crypto";

const password = process.argv.slice(2).join(" ").trim();

if (!password) {
  console.error(`
Usage: node scripts/hash-password.mjs "your admin password"

Also handy — generate a SESSION_SECRET:
  ${randomBytes(32).toString("hex")}
`);
  process.exit(1);
}

if (password.length < 12) {
  console.error(
    `\n! That password is ${password.length} characters. /admin is reachable from the\n` +
      `  public internet, so use at least 12 — ideally a passphrase.\n`
  );
  process.exit(1);
}

const hash = await hashPassword(password);

console.log(`
Add these to your environment:

  ADMIN_PASSWORD_HASH=${hash}
  SESSION_SECRET=${randomBytes(32).toString("hex")}

(SESSION_SECRET is freshly generated above — only use it if you do not
 already have one, since changing it logs out every admin session.)
`);
