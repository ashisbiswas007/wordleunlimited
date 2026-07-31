#!/usr/bin/env node
/**
 * Prepares public/ for production:
 *
 *  1. Stamps a content-derived build id into every `?v=` cache buster in the
 *     HTML, so assets can be served immutable for a year and still update
 *     the instant you deploy.
 *  2. Pre-compresses every text asset to .br and .gz siblings. @fastify/static
 *     serves those directly, so the server never spends CPU compressing.
 *  3. Extracts inline <script> blocks and writes their sha256 hashes to
 *     server/generated/csp-hashes.json, letting the CSP drop 'unsafe-inline'.
 *
 *   node scripts/build-assets.mjs
 */

import { readdir, readFile, writeFile, stat, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, extname, relative } from "node:path";
import { brotliCompress, gzip, constants } from "node:zlib";
import { promisify } from "node:util";
import { createHash } from "node:crypto";

const brotli = promisify(brotliCompress);
const gz = promisify(gzip);

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const PUBLIC = join(ROOT, "public");
const GENERATED = join(ROOT, "server", "generated");

const COMPRESSIBLE = new Set([".html", ".css", ".js", ".mjs", ".json", ".txt", ".xml", ".svg", ".webmanifest"]);
const MIN_COMPRESS_BYTES = 512;

async function walk(dir, out = []) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) {
      await walk(full, out);
    } else if (e.isFile() && !/\.(br|gz)$/.test(e.name)) {
      out.push(full);
    }
  }
  return out;
}

/** Short, stable id derived from the content of every shipped asset. */
async function computeBuildId(files) {
  const hash = createHash("sha256");
  for (const f of files.sort()) {
    if (extname(f) === ".html") continue; // HTML embeds the id; would be circular
    hash.update(relative(PUBLIC, f).replace(/\\/g, "/"));
    hash.update(await readFile(f));
  }
  return hash.digest("hex").slice(0, 10);
}

async function stampBuildId(htmlFiles, buildId) {
  let stamped = 0;
  for (const file of htmlFiles) {
    const src = await readFile(file, "utf8");
    // Idempotent: matches whatever id is currently there, including none.
    const out = src.replace(/(\?v=)[A-Za-z0-9_-]*/g, `$1${buildId}`);
    if (out !== src) {
      await writeFile(file, out, "utf8");
      stamped++;
    }
  }
  return stamped;
}

async function collectCspHashes(htmlFiles) {
  const hashes = new Set();
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;

  for (const file of htmlFiles) {
    const src = await readFile(file, "utf8");
    let m;
    while ((m = re.exec(src))) {
      const body = m[1];
      if (!body.trim()) continue;
      // CSP hashes the script body exactly as it appears between the tags.
      hashes.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
    }
  }
  return [...hashes];
}

async function compress(files) {
  let count = 0;
  let saved = 0;

  for (const file of files) {
    if (!COMPRESSIBLE.has(extname(file))) continue;
    const buf = await readFile(file);
    if (buf.length < MIN_COMPRESS_BYTES) continue;

    const [b, g] = await Promise.all([
      brotli(buf, {
        params: {
          [constants.BROTLI_PARAM_QUALITY]: 11,
          [constants.BROTLI_PARAM_SIZE_HINT]: buf.length,
        },
      }),
      gz(buf, { level: 9 }),
    ]);

    // Only keep a variant if it actually helps.
    if (b.length < buf.length) {
      await writeFile(`${file}.br`, b);
      saved += buf.length - b.length;
      count++;
    }
    if (g.length < buf.length) {
      await writeFile(`${file}.gz`, g);
    }
  }
  return { count, saved };
}

async function main() {
  const files = await walk(PUBLIC);
  if (!files.length) {
    console.warn("[assets] public/ is empty — nothing to do");
    return;
  }

  const htmlFiles = files.filter((f) => extname(f) === ".html");

  const buildId = await computeBuildId(files);
  const stamped = await stampBuildId(htmlFiles, buildId);
  console.log(`[assets] build id ${buildId} stamped into ${stamped} HTML file(s)`);

  const hashes = await collectCspHashes(htmlFiles);
  await mkdir(GENERATED, { recursive: true });
  await writeFile(
    join(GENERATED, "csp-hashes.json"),
    JSON.stringify(hashes, null, 2) + "\n",
    "utf8"
  );
  await writeFile(
    join(GENERATED, "build.json"),
    JSON.stringify({ buildId, builtAt: new Date().toISOString() }, null, 2) + "\n",
    "utf8"
  );
  console.log(`[assets] ${hashes.length} inline script hash(es) written for CSP`);

  const { count, saved } = await compress(files);
  console.log(
    `[assets] pre-compressed ${count} file(s), saving ${(saved / 1024).toFixed(0)} KB on the wire`
  );

  const total = await Promise.all(files.map(async (f) => (await stat(f)).size));
  console.log(
    `[assets] ${files.length} static files, ${(total.reduce((a, b) => a + b, 0) / 1048576).toFixed(2)} MB uncompressed\n`
  );
}

main().catch((err) => {
  console.error("[assets] build failed:", err);
  process.exit(1);
});
