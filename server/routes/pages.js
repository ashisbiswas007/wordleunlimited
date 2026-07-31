import config from "../config.js";
import { getSettings } from "../lib/settings.js";
import { listTopics } from "../lib/topics.js";
import {
  renderTopicIndex,
  renderTopicPage,
  invalidateTopicPages,
  inlineScriptHashes,
  extendCsp,
} from "../lib/topic-pages.js";

const SITEMAP_TTL_MS = 60 * 60 * 1000;
let sitemapCache = { at: 0, xml: "" };

export default async function registerPageRoutes(app) {
  /* Canonical trailing slashes — /wordle-uk and /wordle-uk/ must not both rank. */
  const slashRedirects = ["/wordle-uk", "/id", "/topics", "/privacy-policy", "/disclaimer"];
  for (const from of slashRedirects) {
    app.get(from, (req, reply) => reply.redirect(`${from}/`, 301));
  }

  /* Old WordPress permalinks that already have links pointing at them. */
  const legacy = {
    "/index.php": "/",
    "/home/": "/",
    "/wordle-unlimited/": "/",
    "/uk/": "/wordle-uk/",
    "/wordle-indonesia/": "/id/",
    "/indonesia/": "/id/",
  };
  for (const [from, to] of Object.entries(legacy)) {
    app.get(from, (req, reply) => reply.redirect(to, 301));
  }

  /* ---------- robots.txt ---------- */
  app.get("/robots.txt", { logLevel: "silent" }, async (req, reply) => {
    const s = getSettings();
    reply.type("text/plain; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=3600");

    if (s.maintenance) {
      return "User-agent: *\nDisallow: /\n";
    }

    return [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /ws",
      "Disallow: /*?room=",
      "Disallow: /*?c=",
      "",
      `Sitemap: ${config.siteUrl}/sitemap.xml`,
      "",
    ].join("\n");
  });

  /* ---------- sitemap.xml ---------- */
  app.get("/sitemap.xml", { logLevel: "silent" }, async (req, reply) => {
    reply.type("application/xml; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=3600");

    if (Date.now() - sitemapCache.at < SITEMAP_TTL_MS && sitemapCache.xml) {
      return sitemapCache.xml;
    }

    const today = new Date().toISOString().slice(0, 10);
    const base = config.siteUrl;

    // The three language pages are alternates of each other, so every entry
    // carries the full hreflang cluster.
    const alternates = config.regions
      .map(
        (r) =>
          `    <xhtml:link rel="alternate" hreflang="${r.lang}" href="${base}${r.path}"/>`
      )
      .join("\n");
    const xDefault = `    <xhtml:link rel="alternate" hreflang="x-default" href="${base}/"/>`;

    const entries = config.regions.map(
      (r) => `  <url>
    <loc>${base}${r.path}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>daily</changefreq>
    <priority>${r.code === "en" ? "1.0" : "0.9"}</priority>
${alternates}
${xDefault}
  </url>`
    );

    entries.push(`  <url>
    <loc>${base}/topics/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);

    // Each topic gets a crawlable URL — this is the whole point of Topic mode
    // for search: one landing page per "wordle <topic>" query.
    try {
      const topics = await listTopics({});
      for (const t of topics) {
        entries.push(`  <url>
    <loc>${base}/topics/${t.slug}/</loc>
    <lastmod>${today}</lastmod>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);
      }
    } catch {
      /* topics unavailable — still emit the core sitemap */
    }

    for (const p of ["/privacy-policy/", "/disclaimer/"]) {
      entries.push(`  <url>
    <loc>${base}${p}</loc>
    <lastmod>${today}</lastmod>
    <changefreq>yearly</changefreq>
    <priority>0.2</priority>
  </url>`);
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:xhtml="http://www.w3.org/1999/xhtml">
${entries.join("\n")}
</urlset>
`;

    sitemapCache = { at: Date.now(), xml };
    return xml;
  });

  /* ---------- topic landing pages ---------- */
  /* Rendered on the server: a crawler has to see the topic name, the copy and
     the answers as HTML. Injecting them client-side would not rank. */

  app.get("/topics/", { logLevel: "silent" }, async (req, reply) => {
    if (!getSettings().modes.topic) return reply.callNotFound();
    const html = await renderTopicIndex();
    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=600, stale-while-revalidate=3600");
    extendCsp(reply, inlineScriptHashes(html));
    return html;
  });

  app.get("/topics/:slug/", { logLevel: "silent" }, async (req, reply) => {
    if (!getSettings().modes.topic) return reply.callNotFound();
    const slug = String(req.params.slug || "").toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) return reply.callNotFound();

    const html = await renderTopicPage(slug);
    if (!html) return reply.callNotFound();

    reply.type("text/html; charset=utf-8");
    reply.header("Cache-Control", "public, max-age=600, stale-while-revalidate=3600");
    extendCsp(reply, inlineScriptHashes(html));
    return html;
  });

  // Without the trailing slash it is a different URL to Google.
  app.get("/topics/:slug", (req, reply) => {
    const slug = String(req.params.slug || "").toLowerCase();
    if (!/^[a-z0-9-]{1,64}$/.test(slug)) return reply.callNotFound();
    return reply.redirect(`/topics/${slug}/`, 301);
  });
}

export function invalidateSitemap() {
  sitemapCache = { at: 0, xml: "" };
  // Topic edits change both the sitemap and the rendered landing pages.
  invalidateTopicPages();
}
