import {
  scrypt as _scrypt,
  randomBytes,
  timingSafeEqual,
  createHmac,
} from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(_scrypt);

const KEYLEN = 32;
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };

/** Produce `scrypt$<saltHex>$<hashHex>` for storing in ADMIN_PASSWORD_HASH. */
export async function hashPassword(password) {
  const salt = randomBytes(16);
  const key = await scrypt(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return `scrypt$${salt.toString("hex")}$${key.toString("hex")}`;
}

/** Constant-time verify against a stored `scrypt$salt$hash` string. */
export async function verifyPassword(password, stored) {
  if (typeof stored !== "string") return false;
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;

  let salt, expected;
  try {
    salt = Buffer.from(parts[1], "hex");
    expected = Buffer.from(parts[2], "hex");
  } catch {
    return false;
  }
  if (expected.length !== KEYLEN) return false;

  const key = await scrypt(String(password), salt, KEYLEN, SCRYPT_PARAMS);
  return timingSafeEqual(key, expected);
}

/* ---------- stateless signed tokens (admin session cookie) ---------- */

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function unb64url(str) {
  const pad = str.length % 4 === 0 ? "" : "=".repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, "+").replace(/_/g, "/") + pad, "base64");
}

/**
 * Sign an arbitrary payload with an expiry. Self-contained, so restarting the
 * server does not log the admin out and there is no session store to scale.
 */
export function signToken(payload, secret, ttlMs) {
  const body = { ...payload, exp: Date.now() + ttlMs };
  const data = b64url(JSON.stringify(body));
  const sig = b64url(createHmac("sha256", secret).update(data).digest());
  return `${data}.${sig}`;
}

/** Returns the payload, or null if malformed, tampered with, or expired. */
export function verifyToken(token, secret) {
  if (typeof token !== "string" || token.length > 4096) return null;
  const dot = token.indexOf(".");
  if (dot < 1) return null;

  const data = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expectedSig = b64url(createHmac("sha256", secret).update(data).digest());
  const a = Buffer.from(sig);
  const b = Buffer.from(expectedSig);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let payload;
  try {
    payload = JSON.parse(unb64url(data).toString("utf8"));
  } catch {
    return null;
  }
  if (!payload || typeof payload.exp !== "number" || Date.now() > payload.exp) {
    return null;
  }
  return payload;
}

export function randomId(bytes = 9) {
  return b64url(randomBytes(bytes));
}
