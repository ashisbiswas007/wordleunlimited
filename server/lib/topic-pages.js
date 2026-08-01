import { createHash } from "node:crypto";
import config from "../config.js";
import { listTopics, getTopic } from "./topics.js";

/**
 * Server-rendered pages for /topics/ and /topics/<slug>/.
 *
 * These exist for search: a crawler must see the topic name, a real
 * description and the answers rendered as HTML, not injected later by
 * JavaScript. The playable board is the same markup as the static pages.
 */

const PAGE_TTL_MS = 10 * 60 * 1000;
const cache = new Map(); // key -> { at, html }

function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]
  );
}

function buildId() {
  // Matches whatever build-assets stamped into the static pages. Read lazily so
  // a rebuild is picked up without a restart.
  return process.env.BUILD_ID || "1";
}

function head({ title, description, canonical, extra = "" }) {
  const b = buildId();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Wordle Unlimited">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="#6aaa64" media="(prefers-color-scheme: light)">
<meta name="theme-color" content="#121213" media="(prefers-color-scheme: dark)">
<link rel="icon" href="/favicon-32.png" sizes="32x32" type="image/png">
<link rel="icon" href="/icon-192.png" sizes="192x192" type="image/png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
<link rel="stylesheet" href="/src/wordle.css?v=${b}">
<link rel="stylesheet" href="/src/site.css?v=${b}">
${extra}
</head>
<body>
<header class="topnav">
  <div class="wrap">
    <a class="logo" href="/"><b>Wordle</b>Unlimited</a>
    <nav>
      <a href="/">English</a>
      <a href="/wordle-uk/">UK</a>
      <a href="/id/">Indonesia</a>
      <a href="/topics/" aria-current="page">Topics</a>
    </nav>
  </div>
</header>`;
}

function foot(scripts = "") {
  const b = buildId();
  return `<footer class="sitefoot">
  <div class="wrap">
    <nav>
      <a href="/">Wordle Unlimited</a>
      <a href="/wordle-uk/">Wordle UK</a>
      <a href="/id/">Wordle Indonesia</a>
      <a href="/topics/">All topics</a>
      <a href="/privacy-policy/">Privacy Policy</a>
      <a href="/disclaimer/">Disclaimer</a>
    </nav>
    <p>&copy; <span id="yr">2026</span> Wordle Unlimited &middot; Free unlimited word game &middot; Not affiliated with The New York Times.</p>
  </div>
</footer>
<script>document.getElementById("yr").textContent=new Date().getFullYear();</script>
${scripts}
<script src="/src/wordle.js?v=${b}" defer></script>
<script src="/src/multiplayer.js?v=${b}" defer></script>
<script src="/src/cloudsave.js?v=${b}" defer></script>
</body>
</html>`;
}

/** The playable board. Same element ids the engine expects. */
function gameShell(brandSuffix) {
  return `<div id="wu-root">
  <div class="app">
    <div class="topbar">
      <div class="wu-brand"><span class="wu-brand-1">Wordle</span><span class="wu-brand-2">${esc(brandSuffix)}</span></div>
      <div class="icons">
        <button class="icon" id="helpBtn" data-open="howtoModal" aria-label="How to play"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg></button>
        <button class="icon" id="statsBtn" data-open="statsModal" aria-label="Statistics"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg></button>
        <button class="icon" id="kbdBtn" data-act="kbd" aria-label="Use my keyboard"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 14h.01M18 14h.01M9 14h6"/></svg></button>
        <button class="icon" id="setBtn" data-open="settingsModal" aria-label="Settings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg></button>
        <button class="icon" id="fsBtn" data-act="fullscreen" aria-label="Fullscreen"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg></button>
      </div>
    </div>
    <div class="tabs">
      <button class="tab" data-mode="daily"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg><span>Daily</span></button>
      <button class="tab" data-mode="unlimited"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7 8a4 4 0 0 0 0 8c2 0 3.2-1.5 5-4s3-4 5-4a4 4 0 0 1 0 8c-2 0-3.2-1.5-5-4S9 8 7 8z"/></svg><span>Unlimited</span></button>
      <button class="tab" data-mode="time"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg><span>Time</span></button>
      <button class="tab" data-mode="topic"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg><span>Topics</span></button>
      <button class="tab" data-mode="multiplayer"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></svg><span>Versus</span><span class="tab-live" id="mpLive" aria-live="polite"></span></button>
    </div>
    <div id="banner"></div>
    <div class="controls" id="controls"></div>
    <div class="tp-clue" id="tpClue"></div>
    <div class="hintline" id="hintline"></div>
    <div class="toast" id="toast"></div>
    <div class="boardwrap">
      <div class="grid" id="board"></div>
      <div class="endwrap" id="endwrap"><div class="endcard" id="endcard"></div></div>
    </div>
    <div class="keyboard" id="keyboard"></div>
    <div class="typebar" id="typebar">
      <span class="tb-ico">&#9000;</span>
      <span class="tb-txt">Your keyboard is on &mdash; just type your guess.</span>
      <button class="tb-x" data-act="kbdoff">On-screen keys</button>
    </div>
    <input id="wuTyper" class="wu-typer" type="text" inputmode="text" autocomplete="off" autocapitalize="characters" autocorrect="off" spellcheck="false" aria-hidden="true" tabindex="-1">
  </div>

  <div class="overlay" id="howtoModal"><div class="modal">
    <button class="x" data-close="howtoModal" aria-label="Close"></button>
    <h2>How to play</h2>
    <p>Guess the hidden answer in 6 tries. Tile colours show how close you were: green is the right letter in the right spot, orange is the right letter in the wrong spot, grey is not in the answer at all.</p>
    <p>In Topic mode the answers are names from the theme, and the word length changes as you move through them.</p>
    <div id="brandSlot"></div>
  </div></div>
  <div class="overlay" id="statsModal"><div class="modal">
    <button class="x" data-close="statsModal" aria-label="Close"></button>
    <h2 id="statsTitle">Statistics</h2><div id="statsBody"></div>
  </div></div>
  <div class="overlay" id="topicModal"><div class="modal">
    <button class="x" data-close="topicModal" aria-label="Close"></button>
    <h2>Choose a topic</h2><div class="tp-pick" id="topicBody"></div>
  </div></div>
  <div class="overlay" id="mpModal"><div class="modal">
    <button class="x" data-close="mpModal" aria-label="Close"></button>
    <h2>Versus &mdash; play live</h2><div id="mpBody"></div>
  </div></div>
  <div class="overlay" id="challengeModal"><div class="modal">
    <button class="x" data-close="challengeModal" aria-label="Close"></button>
    <h2>Challenge a friend</h2>
    <div class="field"><label for="chWord">Your word (3&ndash;7 letters)</label><input id="chWord" type="text" autocomplete="off" maxlength="7"></div>
    <div class="field"><label for="chName">Your name (optional)</label><input id="chName" type="text" autocomplete="off" maxlength="20"></div>
    <div class="field opt"><label>Time limit (optional)</label>
      <div class="seg small" id="chTimeSeg">
        <button data-chtime="0" class="active">None</button><button data-chtime="30">30s</button>
        <button data-chtime="60">1 min</button><button data-chtime="120">2 min</button>
      </div></div>
    <div class="setrow" style="border-bottom:none;padding:8px 0">
      <div><div class="label">Allow hints</div><div class="desc">Let your friend reveal letters</div></div>
      <label class="switch"><input type="checkbox" id="chHints"><span class="slider"></span></label></div>
    <div class="err" id="chErr"></div>
    <button class="cbtn" data-act="makelink"><span class="ic" id="mlIcon"></span><span>Create challenge link</span></button>
    <div id="chResult" style="display:none">
      <div class="linkbox"><input id="chLink" readonly><button class="cbtn ghost" data-act="copylink">Copy</button></div>
      <div id="chShare"></div></div>
  </div></div>
  <div class="overlay" id="settingsModal"><div class="modal">
    <button class="x" data-close="settingsModal" aria-label="Close"></button>
    <h2>Settings</h2>
    <div class="setrow"><div class="label">Theme</div>
      <div class="seg"><button data-seg="theme" data-val="light">Light</button><button data-seg="theme" data-val="dark">Dark</button><button data-seg="theme" data-val="system">Auto</button></div></div>
    <div class="setrow"><div><div class="label">Word length</div><div class="desc">Used outside Topic mode</div></div>
      <div class="seg"><button data-seg="length" data-val="3">3</button><button data-seg="length" data-val="4">4</button><button data-seg="length" data-val="5">5</button><button data-seg="length" data-val="6">6</button><button data-seg="length" data-val="7">7</button></div></div>
    <div class="setrow"><div><div class="label">Hard mode</div><div class="desc">Revealed hints must be reused</div></div>
      <label class="switch"><input type="checkbox" id="setHard"><span class="slider"></span></label></div>
    <div class="setrow"><div><div class="label">Hints</div><div class="desc">Show the hint button while playing</div></div>
      <label class="switch"><input type="checkbox" id="setHints"><span class="slider"></span></label></div>
    <div class="setrow"><div><div class="label">High contrast</div><div class="desc">Colourblind-friendly colours</div></div>
      <label class="switch"><input type="checkbox" id="setContrast"><span class="slider"></span></label></div>
    <div class="setrow"><div><div class="label">Sound</div><div class="desc">Key and result sounds</div></div>
      <label class="switch"><input type="checkbox" id="setSound"><span class="slider"></span></label></div>
    <div class="setrow col" id="cloudRow" style="display:none"></div>
    <div class="setrow col"><div class="label">Language / Region</div><div class="regions" id="regionRow"></div></div>
    <div class="footer"><a href="/privacy-policy/">Privacy Policy</a><a href="/disclaimer/">Disclaimer</a></div>
  </div></div>
</div>`;
}

/* ---------------- /topics/<slug>/ ---------------- */

export async function renderTopicPage(slug) {
  const key = "t:" + slug;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;

  const entry = await getTopic(slug);
  if (!entry) return null;

  const { topic, items } = entry;
  const all = await listTopics({});
  const related = all
    .filter((t) => t.slug !== topic.slug && t.category === topic.category)
    .slice(0, 6);
  const fallbackRelated = all.filter((t) => t.slug !== topic.slug).slice(0, 6);
  const relatedList = related.length ? related : fallbackRelated;

  const byLength = {};
  for (const it of items) (byLength[it.length] ||= []).push(it.answer);
  const lengths = Object.keys(byLength).map(Number).sort((a, b) => a - b);

  const title = `Wordle ${topic.name} — Play the ${topic.name} Word Game Free`;
  const description =
    topic.blurb
      ? `${topic.blurb} Guess all ${items.length} ${topic.name} answers, one after another. Free, unlimited, no login.`
      : `Play the ${topic.name} Wordle. Guess all ${items.length} answers, one after another. Free, unlimited, no login.`;
  const canonical = `${config.siteUrl}/topics/${topic.slug}/`;

  const ld = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "VideoGame",
        name: `Wordle ${topic.name}`,
        url: canonical,
        gamePlatform: "Web browser",
        applicationCategory: "GameApplication",
        operatingSystem: "Any",
        genre: ["Word game", "Puzzle"],
        description,
        offers: { "@type": "Offer", price: "0", priceCurrency: "USD", availability: "https://schema.org/InStock" },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Wordle Unlimited", item: `${config.siteUrl}/` },
          { "@type": "ListItem", position: 2, name: "Topics", item: `${config.siteUrl}/topics/` },
          { "@type": "ListItem", position: 3, name: topic.name, item: canonical },
        ],
      },
    ],
  };

  const html = `${head({ title, description, canonical })}
<main>
  <div class="wrap hero">
    <p class="eyebrow">Topic mode &middot; ${esc(topic.category)}</p>
    <h1>Wordle ${esc(topic.name)}</h1>
    <p>${esc(topic.blurb || `Guess your way through every name in ${topic.name}.`)} There ${items.length === 1 ? "is" : "are"} <b>${items.length}</b> answer${items.length === 1 ? "" : "s"} in this pack, and the word length changes as you go.</p>
    <div class="badges">
      <span>${items.length} answers</span>
      <span>${lengths.length ? lengths[0] + "&ndash;" + lengths[lengths.length - 1] + " letters" : "3&ndash;7 letters"}</span>
      <span>No login</span><span>Free forever</span>
    </div>
  </div>

  <div class="wrap gamehost">
${gameShell(topic.name)}
  </div>

  <div class="wrap prose">
    <section style="border-top:none">
      <h2>How the ${esc(topic.name)} Wordle works</h2>
      <p>This is ordinary Wordle with one difference: instead of a random dictionary word, every
      answer is a name from ${esc(topic.name)}. You get six guesses per answer. Green means the
      letter is in the right place, orange means it is in the answer but somewhere else, and grey
      means it is not there at all.</p>
      <p>Solve one and the next loads straight away &mdash; and because names are not all the same
      length, the grid resizes as you move through the pack. Guessing another name from this same
      topic always counts as a valid guess, even when it is not a dictionary word.</p>
    </section>

    <section>
      <h2>Answers in this pack</h2>
      <p>All ${items.length} answers, grouped by length. Look away now if you would rather not know.</p>
      <ul class="tlist">
        ${lengths
          .map(
            (len) =>
              `<li><b>${len} letters</b> &mdash; ${byLength[len].map((w) => esc(w)).join(", ")}</li>`
          )
          .join("\n        ")}
      </ul>
    </section>

    ${
      relatedList.length
        ? `<section>
      <h2>More topics like this</h2>
      <div class="topicstrip">
        ${relatedList
          .map(
            (t) =>
              `<a href="/topics/${esc(t.slug)}/"><span class="e">${esc(t.icon || "\u{1F3AF}")}</span><span>${esc(t.name)}</span></a>`
          )
          .join("\n        ")}
      </div>
      <p style="margin-top:14px"><a href="/topics/">Browse all ${all.length} topics &rarr;</a></p>
    </section>`
        : ""
    }

    <div class="cta">
      <h2>Play more</h2>
      <p>Unlimited words, a Daily puzzle, Time mode and live multiplayer rooms.</p>
      <div class="btns">
        <a class="btn primary" href="/">Wordle Unlimited</a>
        <a class="btn ghost" href="/topics/">All topics</a>
      </div>
    </div>
  </div>
</main>
${foot(`<script>window.WU_CONFIG={region:"en",ns:"",name:"Wordle Unlimited",url:"${config.siteUrl}/"};window.WU_TOPIC=${JSON.stringify(topic.slug)};</script>
<script type="application/ld+json">${JSON.stringify(ld)}</script>`)}`;

  cache.set(key, { at: Date.now(), html });
  return html;
}

/* ---------------- /topics/ ---------------- */

export async function renderTopicIndex() {
  const hit = cache.get("index");
  if (hit && Date.now() - hit.at < PAGE_TTL_MS) return hit.html;

  const all = await listTopics({});
  const byCategory = {};
  for (const t of all) (byCategory[t.category] ||= []).push(t);
  const categories = Object.keys(byCategory).sort();
  const totalAnswers = all.reduce((n, t) => n + t.count, 0);

  const title = `Wordle Topics — ${all.length} Themed Word Games, Free`;
  const description = `Play Wordle on ${all.length} themes: Spider-Man, Marvel, car brands, countries, animals and more. ${totalAnswers} answers in total. Free, unlimited, no login.`;
  const canonical = `${config.siteUrl}/topics/`;

  const ld = {
    "@context": "https://schema.org",
    "@type": "CollectionPage",
    name: "Wordle Topics",
    url: canonical,
    description,
    hasPart: all.slice(0, 50).map((t) => ({
      "@type": "VideoGame",
      name: `Wordle ${t.name}`,
      url: `${config.siteUrl}/topics/${t.slug}/`,
    })),
  };

  const html = `${head({ title, description, canonical })}
<main>
  <div class="wrap hero">
    <p class="eyebrow">Topic mode</p>
    <h1>Wordle Topics</h1>
    <p>Pick a theme and guess your way through its names, one after another. ${all.length} packs
    and ${totalAnswers} answers so far, from Spider-Man to car brands to the rivers of the world.</p>
    <div class="badges">
      <span>${all.length} topics</span><span>${totalAnswers} answers</span>
      <span>No login</span><span>Free forever</span>
    </div>
  </div>

  <div class="wrap prose">
    ${categories
      .map(
        (cat) => `<section${cat === categories[0] ? ' style="border-top:none"' : ""}>
      <h2>${esc(cat.charAt(0).toUpperCase() + cat.slice(1))}</h2>
      <div class="topicstrip">
        ${byCategory[cat]
          .map(
            (t) =>
              `<a href="/topics/${esc(t.slug)}/"><span class="e">${esc(t.icon || "\u{1F3AF}")}</span><span>${esc(t.name)}</span></a>`
          )
          .join("\n        ")}
      </div>
    </section>`
      )
      .join("\n    ")}

    <div class="cta">
      <h2>Or play the classic game</h2>
      <p>Unlimited words, a Daily puzzle, Time mode and live multiplayer rooms.</p>
      <div class="btns">
        <a class="btn primary" href="/">Wordle Unlimited</a>
        <a class="btn ghost" href="/wordle-uk/">Wordle UK</a>
      </div>
    </div>
  </div>
</main>
${foot(`<script type="application/ld+json">${JSON.stringify(ld)}</script>`)}`;

  cache.set("index", { at: Date.now(), html });
  return html;
}

export function invalidateTopicPages() {
  cache.clear();
}

/**
 * CSP hashes for a rendered page's inline <script> blocks.
 *
 * The build-time hash list only covers the static HTML files, so pages
 * rendered here — including their JSON-LD — would otherwise be blocked.
 * Hashing at render time keeps the policy strict without a nonce, which
 * would make these pages uncacheable.
 */
export function inlineScriptHashes(html) {
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const out = new Set();
  let m;
  while ((m = re.exec(html))) {
    const body = m[1];
    if (!body.trim()) continue;
    out.add(`'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`);
  }
  return [...out];
}

/** Appends the hashes to whatever script-src helmet already set. */
export function extendCsp(reply, hashes) {
  if (!hashes.length) return;
  const current = reply.getHeader("content-security-policy");
  if (!current || typeof current !== "string") return;
  const extended = current.replace(
    /script-src ([^;]*)/,
    (full, body) => `script-src ${body.trim()} ${hashes.join(" ")}`
  );
  reply.header("content-security-policy", extended);
}
