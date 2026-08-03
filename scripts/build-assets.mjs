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
import { brotliCompress, gzip, constants, brotliDecompressSync } from "node:zlib";
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

/**
 * Strips comments and collapses whitespace in the shipped copies. Source files
 * keep their comments; only what leaves the server is stripped. This is a size
 * and tidiness measure, not a security one — anything the browser runs can be
 * read by whoever wants to.
 */
function minifyCss(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\s*([{}:;,>~])\s*/g, "$1")
    .replace(/;\}/g, "}")
    .replace(/\s+/g, " ")
    .replace(/\s*\n\s*/g, "")
    .trim();
}

/** Conservative: only removes whole-line // and /* *\/ comments outside strings. */
function minifyJs(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  let quote = null;
  while (i < n) {
    const c = src[i];
    const next = src[i + 1];
    if (quote) {
      out += c;
      if (c === "\\") { out += src[i + 1] ?? ""; i += 2; continue; }
      if (c === quote) quote = null;
      i++;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { quote = c; out += c; i++; continue; }
    if (c === "/" && next === "/") { while (i < n && src[i] !== "\n") i++; continue; }
    if (c === "/" && next === "*") { i += 2; while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i++; i += 2; continue; }
    out += c;
    i++;
  }
  return out
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join("\n");
}

async function minify(files) {
  let before = 0;
  let after = 0;
  for (const file of files) {
    const ext = extname(file);
    if (ext !== ".css" && ext !== ".js") continue;
    if (/\.min\./.test(file)) continue;

    const src = await readFile(file, "utf8");
    const out = ext === ".css" ? minifyCss(src) : minifyJs(src);
    if (!out.length) continue;

    if (ext === ".js") {
      try {
        new Function(out);
      } catch (err) {
        throw new Error(`minifying ${relative(ROOT, file)} broke it: ${err.message}`);
      }
    }
    before += Buffer.byteLength(src);
    after += Buffer.byteLength(out);
    await writeFile(file, out, "utf8");
  }
  if (before) {
    console.log(
      `[assets] minified ${((1 - after / before) * 100).toFixed(0)}% off js/css ` +
        `(${(before / 1024).toFixed(0)} KB -> ${(after / 1024).toFixed(0)} KB)`
    );
  }
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

    // Verify before writing. A truncated .br is served in place of the real
    // file and silently breaks the site, which is very hard to spot.
    if (b.length < buf.length) {
      if (!brotliDecompressSync(b).equals(buf)) {
        throw new Error(`brotli round-trip failed for ${file} — refusing to write a corrupt asset`);
      }
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

/**
 * Parse every shipped script. A syntax error in one file silently blanks the
 * page that loads it, which is almost impossible to spot from the server side —
 * the file serves with a 200 and the right byte count either way.
 */
async function checkScripts(files) {
  const scripts = [
    ...files.filter((f) => extname(f) === ".js"),
    ...(await walk(join(ROOT, "server", "admin-ui"))).filter((f) => extname(f) === ".js"),
  ];
  const broken = [];
  for (const file of scripts) {
    const src = await readFile(file, "utf8");
    try {
      new Function(src);
    } catch (err) {
      broken.push(`${relative(ROOT, file)}: ${err.message}`);
    }
  }
  if (broken.length) {
    throw new Error(`refusing to build, ${broken.length} script(s) will not parse:\n  ` + broken.join("\n  "));
  }
  console.log(`[assets] ${scripts.length} script(s) parse cleanly`);
}

async function main() {
  const files = await walk(PUBLIC);
  if (!files.length) {
    console.warn("[assets] public/ is empty — nothing to do");
    return;
  }

  await checkScripts(files);

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

  // Rewrites files in place, so it must never run against a working tree.
  // The Dockerfile passes --minify; the repo keeps its readable source.
  if (process.argv.includes("--minify")) await minify(files);

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
