/* Wordle Unlimited — game engine.
   Vanilla, no dependencies, no build step. Loaded with `defer`.

   Per-page setup comes from window.WU_CONFIG; translations from window.WU_I18N.
   Multiplayer and cloud save attach through window.WU (see the bottom of this
   file) so they can be loaded separately and are optional. */
(function () {
  "use strict";

  var CFG = Object.assign(
    {
      region: "en",
      ns: "",
      name: "Wordle Unlimited",
      url: window.location.origin,
      extOnly: false,
    },
    window.WU_CONFIG || {}
  );

  var ASSET_BASE = "/src/";
  var SITE = String(CFG.url).replace(/\/+$/, "");
  var NS = "wu_" + (CFG.ns ? CFG.ns + "_" : "");
  function K(k) { return NS + k; }

  if (!document.getElementById("board")) return;

  var MAX_HINTS = 2;
  var AUTO_HINT_AFTER = 4;
  var CH_TTL = 6 * 60 * 60 * 1000;
  var CH_DONE_TTL = 7 * 24 * 60 * 60 * 1000;
  var TIME_CAP = 180;
  var IS_TOUCH =
    "ontouchstart" in window ||
    (window.matchMedia && matchMedia("(pointer:coarse)").matches);
  var SENT = " ";

  /* ===================== language ===================== */
  var EN = {
    ord: ["first", "second", "third", "fourth", "fifth", "sixth"],
    word1: "word", wordN: "words", enterKey: "ENTER", hintTag: "HINT",
    checking: "Checking…",
    notEnough: "Not enough letters", notInList: "Not in word list",
    spotMust: "Spot {0} must be {1}", mustUse: "Guess must use {0}",
    hintOn: "Hint unlocked!", hintNone: "No hints left", hintAll: "All letters revealed",
    newWord: "New word loaded", wordWas: "Word was {0}", packMiss: "{0} {1}-letter pack missing",
    copied: "Copied!", linkCopied: "Link copied!", chCopied: "Challenge link copied!",
    dailyNum: "Daily #{0}", nextIn: "Next in", newGame: "New game", restart: "Restart",
    hint: "Hint", chFriend: "Challenge a friend", solvedLbl: "Solved",
    aFriend: "A friend", someone: "Someone", chMine: "{0}’s challenge", chCancel: "Cancel challenge",
    chDone: "You already played {0}’s challenge", chDoneW: "You {0} — the word was {1}",
    won: "won", lost: "lost",
    chYou: "{0} challenged you!", chGuess: "Guess their secret word",
    chTimed: "Timed: {0}", chHints: "hints on", accept: "Accept", reject: "Reject",
    tWon: "Solved!", tWonCh: "You won!", tLost: "Out of guesses", tLostCh: "So close!", tTime: "Time’s up!",
    mWonDaily: "You got today’s word on your {0} guess.",
    mWon: "You got it on your {0} guess. The word was <b class=\"reveal-word\">{1}</b>.",
    mWonCh: "{0} challenged you and you guessed it on your {1} try. The word was <b class=\"reveal-word\">{2}</b>.",
    mLost: "The word was <b class=\"reveal-word\">{0}</b>.",
    mLostCh: "{0}’s challenge beat you. The word was <b class=\"reveal-word\">{1}</b>.",
    mTime: "You solved <b>{0}</b> {1}. Best: <b>{2}</b>.",
    keepPlaying: "Keep playing", shareLbl: "Share:",
    stStats: "Statistics", stCh: "Custom challenge",
    stChNote: "Challenge games aren’t counted in your stats — use the share buttons to send your result back.",
    stTime: "Time mode ({0} letters, {1})", stBest: "Best", stRun: "This run",
    stTimeNote: "Solve as many words as you can before the clock runs out.",
    stPlayed: "Played", stWin: "Win %", stStreak: "Streak", stMax: "Max",
    stDist: "Guess distribution", stDaily: "Daily", stUnl: "Unlimited", stLetters: "{0} — {1} letters",
    errWord: "Enter a 3–7 letter word, letters only.",
    errDict: "“{0}” isn’t in our dictionary — try another.",
    shWonCh: "{0} challenged me and I won on my {1} guess! The word was {2}.",
    shWonChNo: "I won a {site} challenge on my {0} guess! The word was {1}.",
    shLostCh: "{0}I couldn’t crack it. The word was {1}.",
    shDailyW: "I solved {site} Daily #{0} on my {1} guess!",
    shDailyL: "{site} Daily #{0} beat me today!",
    shTime: "I solved {0} {1} in {site} Time mode!",
    shTime0: "Can you beat the clock? Try {site} Time mode!",
    shWon: "I solved a {site} word on my {0} guess! The word was {1}.",
    shLost: "A {site} word beat me — it was {0}.",
    chInvite: "{0} challenged you on {site} — can you guess my word?",
    chInviteMe: "I challenge you on {site} — can you guess my word?",
    chInviteTime: " You’ll have {0}!",
    lvlWord: "Level", statWins: "wins", statPlayed: "played", toNext: "to next", maxRank: "MAX",
    lvlUp: "LEVEL UP", memberSince: "Playing since {0}", rankTitle: "Your rank",
    /* topic mode */
    tpPick: "Choose a topic", tpSearch: "Search topics…", tpAll: "All",
    tpNone: "No topics match that search.",
    tpProgress: "{0} of {1}", tpDone: "Topic complete!",
    tpDoneMsg: "You solved all {0} answers in {1}.",
    tpChange: "Change topic", tpLoading: "Loading topics…",
    tpFailed: "Could not load topics. Try again in a moment.",
    tpClue: "Clue: {0}",
    shTopic: "I solved {0} of {1} in the {2} topic on {site}!",
  };
  var I18N = window.WU_I18N || {};
  function t(k, a, b, c) {
    var s = I18N[k] != null ? I18N[k] : EN[k];
    if (s == null) return k;
    s = String(s).split("{site}").join(CFG.name || "Wordle Unlimited");
    if (a != null) s = s.split("{0}").join(a);
    if (b != null) s = s.split("{1}").join(b);
    if (c != null) s = s.split("{2}").join(c);
    return s;
  }
  function ordN(i) { var o = I18N.ord || EN.ord; return o[i] || i + 1; }
  function wordUnit(n) { return n === 1 ? t("word1") : t("wordN"); }

  /* ===================== small helpers ===================== */
  function b64(s) { try { return btoa(unescape(encodeURIComponent(s))); } catch (e) { return btoa(s); } }
  function unb64(s) {
    try { return decodeURIComponent(escape(atob(s))); }
    catch (e) { try { return atob(s); } catch (e2) { return ""; } }
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function lsGet(k, d) { try { var v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }

  function challengeUrl(enc, name) {
    var u = SITE + "/?c=" + encodeURIComponent(enc);
    if (name) u += "&by=" + encodeURIComponent(name.slice(0, 20));
    return u;
  }

  /* ===================== challenge persistence ===================== */
  function savePendingChallenge(info) {
    lsSet(K("pending_ch"), {
      word: info.word, by: info.by || null, time: info.time || 0,
      hints: !!info.hints, enc: info.enc || null, exp: Date.now() + CH_TTL,
    });
  }
  function loadPendingChallenge() {
    var p = lsGet(K("pending_ch"), null);
    if (!p) return null;
    if (Date.now() > p.exp) { clearPendingChallenge(); return null; }
    if (!(/^[a-z]+$/.test(p.word) && p.word.length >= 3 && p.word.length <= 7)) {
      clearPendingChallenge(); return null;
    }
    return { word: p.word, by: p.by, time: p.time || 0, hints: !!p.hints, enc: p.enc || null };
  }
  function clearPendingChallenge() { try { localStorage.removeItem(K("pending_ch")); } catch (e) {} }
  function leaveToHome() {
    clearPendingChallenge();
    var url = SITE + "/";
    try { (window.top || window).location.href = url; } catch (e) { location.href = url; }
  }
  function chDoneAll() { return lsGet(K("ch_done"), {}); }
  function chDonePrune(o) {
    var now = Date.now(), k, ch = false;
    for (k in o) if (o[k] && o[k].exp && now > o[k].exp) { delete o[k]; ch = true; }
    if (ch) lsSet(K("ch_done"), o);
    return o;
  }
  function getChallengeResult(enc) {
    if (!enc) return null;
    var o = chDonePrune(chDoneAll()), e = o[enc];
    return e ? e.r : null;
  }
  function recordChallengeResult(enc, result, word) {
    if (!enc) return;
    var o = chDoneAll();
    o[enc] = { r: result, word: word || null, exp: Date.now() + CH_DONE_TTL };
    lsSet(K("ch_done"), o);
  }

  /* ===================== icons ===================== */
  var ICON = {
    help: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M9.1 9a3 3 0 0 1 5.8 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>',
    stats: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>',
    fs: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/></svg>',
    fsExit: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 3v3a2 2 0 0 1-2 2H3m18 0h-3a2 2 0 0 1-2-2V3m0 18v-3a2 2 0 0 1 2-2h3M3 16h3a2 2 0 0 1 2 2v3"/></svg>',
    refresh: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15"/></svg>',
    share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><line x1="8.6" y1="13.5" x2="15.4" y2="17.5"/><line x1="15.4" y1="6.5" x2="8.6" y2="10.5"/></svg>',
    target: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.3h6c0-1 .4-1.8 1-2.3A7 7 0 0 0 12 2z"/></svg>',
    shuffle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="16 3 21 3 21 8"/><line x1="4" y1="20" x2="21" y2="3"/><polyline points="21 16 21 21 16 21"/><line x1="15" y1="15" x2="21" y2="21"/><line x1="4" y1="4" x2="9" y2="9"/></svg>',
    clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
    copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    grid: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/></svg>',
    whatsapp: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z"/></svg>',
    facebook: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>',
    telegram: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M9.78 18.65l.28-4.23 7.68-6.92c.34-.31-.07-.46-.52-.19L7.74 13.3 3.64 12c-.88-.25-.89-.86.2-1.3l15.97-6.16c.73-.33 1.43.18 1.15 1.3l-2.72 12.81c-.19.91-.74 1.13-1.5.71L12.6 16.3l-1.99 1.93c-.23.23-.42.42-.83.42z"/></svg>',
    close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
    back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 4H8l-7 8 7 8h13a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2z"/><line x1="18" y1="9" x2="12" y2="15"/><line x1="12" y1="9" x2="18" y2="15"/></svg>',
  };
  var FLAG = {
    en: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#3b5fc4"/><circle cx="10" cy="7" r="4" fill="none" stroke="#fff" stroke-width="1.2"/><path d="M10 3v8M6 7h8" stroke="#fff" stroke-width="1.2"/></svg>',
    gb: '<svg viewBox="0 0 20 14"><rect width="20" height="14" fill="#012169"/><path d="M0 0l20 14M20 0L0 14" stroke="#fff" stroke-width="2.5"/><path d="M0 0l20 14M20 0L0 14" stroke="#C8102E" stroke-width="1.2"/><path d="M10 0v14M0 7h20" stroke="#fff" stroke-width="3.5"/><path d="M10 0v14M0 7h20" stroke="#C8102E" stroke-width="2"/></svg>',
    id: '<svg viewBox="0 0 20 14"><rect width="20" height="7" fill="#e70011"/><rect y="7" width="20" height="7" fill="#fff"/></svg>',
  };
  var REGIONS = [
    { code: "en", name: "English", base: "dict/en", url: SITE + "/" },
    { code: "gb", name: "UK", base: "dict/gb", url: SITE + "/wordle-uk/" },
    { code: "id", name: "Indonesia", base: "dict/id", url: SITE + "/id/" },
  ];

  /* ===================== word data ===================== */
  var WORDS = {}, SETS = {}, extProm = {}, extReady = {}, coreProm = {};
  var _extArmed = false;

  function parseList(txt) {
    var s = String(txt).replace(/^﻿/, "").trim(), arr = null;
    if (s.charAt(0) === "[") { try { arr = JSON.parse(s); } catch (e) { arr = null; } }
    if (!arr) arr = s.split(/[\s,]+/);
    return arr
      .map(function (w) { return String(w).replace(/["'\[\],]/g, "").toLowerCase().trim(); })
      .filter(function (w) { return /^[a-z]+$/.test(w); });
  }
  function fetchFirst(urls) {
    var i = 0;
    function step() {
      if (i >= urls.length) return Promise.reject(0);
      return fetch(urls[i++])
        .then(function (r) { if (!r.ok) throw 0; return r.text(); })
        .catch(step);
    }
    return step();
  }
  function regionBase() {
    var r = REGIONS.filter(function (x) { return x.code === CFG.region; })[0];
    return r && r.base ? r.base : "dict/en";
  }
  function rebuildSet(n) {
    var s = {};
    (WORDS[n] || []).forEach(function (w) { s[w] = true; });
    SETS[n] = Object.assign(s, SETS[n] && SETS[n].__ext ? SETS[n] : {});
    SETS[n].__ext = SETS[n].__ext || false;
  }

  /** Answer pack for a length. Cached per length, fetched once. */
  function loadCore(len) {
    if (coreProm[len]) return coreProm[len];
    coreProm[len] = fetchFirst([ASSET_BASE + regionBase() + "/" + len + ".txt"])
      .then(function (txt) {
        WORDS[len] = parseList(txt).filter(function (w) { return w.length === len; });
        rebuildSet(len);
        return true;
      })
      .catch(function () {
        WORDS[len] = WORDS[len] || [];
        rebuildSet(len);
        toast(t("packMiss", CFG.region.toUpperCase(), len));
        return false;
      });
    return coreProm[len];
  }

  /** Wider acceptance list — loaded lazily on first interaction. */
  function loadExtended(len) {
    if (extProm[len]) return extProm[len];
    if (!SETS[len]) SETS[len] = {};
    extProm[len] = fetchFirst([ASSET_BASE + regionBase() + "/extended-" + len + ".txt"])
      .then(function (txt) {
        parseList(txt).forEach(function (w) { if (w.length === len) SETS[len][w] = true; });
        extReady[len] = true;
      })
      .catch(function () { extReady[len] = true; extProm[len] = null; });
    return extProm[len];
  }
  function armExtended() {
    if (_extArmed) return;
    _extArmed = true;
    loadExtended(game ? game.length : settings.length);
  }

  /* ===================== settings ===================== */
  var settings = Object.assign(
    { theme: "system", hard: false, hints: false, contrast: false, sound: false, length: 5, timeDur: 60 },
    lsGet("wu_settings", {})
  );
  function saveSettings() { lsSet("wu_settings", settings); notifyParent(); if (window.WU.onSave) window.WU.onSave(); }

  var mq = window.matchMedia("(prefers-color-scheme: dark)");
  function resolvedTheme() { return settings.theme === "system" ? (mq.matches ? "dark" : "light") : settings.theme; }
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", resolvedTheme());
    document.body.classList.toggle("high-contrast", settings.contrast);
  }
  function toggleTheme() {
    settings.theme = resolvedTheme() === "dark" ? "light" : "dark";
    saveSettings(); applyTheme(); updateSeg();
  }
  function notifyParent() {
    try {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: "wu-theme", theme: settings.theme, resolved: resolvedTheme() }, "*");
      }
    } catch (e) {}
  }
  mq.addEventListener("change", function () { if (settings.theme === "system") { applyTheme(); notifyParent(); } });

  /* ===================== daily seeding ===================== */
  function mulberry32(a) {
    return function () {
      a |= 0; a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function seededShuffle(arr, seed) {
    var a = arr.slice(), r = mulberry32(seed), i, j, tmp;
    for (i = a.length - 1; i > 0; i--) { j = Math.floor(r() * (i + 1)); tmp = a[i]; a[i] = a[j]; a[j] = tmp; }
    return a;
  }
  var DAILY_EPOCH = Date.UTC(2025, 0, 1);
  function daysSince() { return Math.floor((Date.now() - DAILY_EPOCH) / 86400000); }
  function nextDaily() { return DAILY_EPOCH + (daysSince() + 1) * 86400000; }
  function regSalt() {
    var s = 0, r = CFG.region || "en", i;
    for (i = 0; i < r.length; i++) s = (s * 31 + r.charCodeAt(i)) | 0;
    return s;
  }
  function dailyWord(len) {
    var list = seededShuffle(WORDS[len] || [], 777 + len + regSalt());
    if (!list.length) return "";
    return list[((daysSince() % list.length) + list.length) % list.length].toUpperCase();
  }

  /* ===================== stats ===================== */
  function getStats(key) { return lsGet(K("stats_" + key), { played: 0, wins: 0, cur: 0, max: 0, lastWin: null, dist: [0, 0, 0, 0, 0, 0] }); }
  function setStats(key, s) { lsSet(K("stats_" + key), s); }
  function getTimeBest(len, dur) { return lsGet(K("timebest_" + len + "_" + dur), { score: 0 }); }
  function recordDaily(len, won, n) {
    var key = "daily_" + len, s = getStats(key), d = daysSince();
    s.played++;
    if (won) {
      s.wins++; s.dist[n - 1]++;
      if (s.lastWin === d - 1) s.cur++;
      else if (s.lastWin === d) {} else s.cur = 1;
      s.lastWin = d;
      if (s.cur > s.max) s.max = s.cur;
    } else s.cur = 0;
    setStats(key, s);
  }
  function recordUnlimited(len, won, n) {
    var key = "unlimited_" + len, s = getStats(key);
    s.played++;
    if (won) { s.wins++; s.dist[n - 1]++; s.cur++; if (s.cur > s.max) s.max = s.cur; }
    else s.cur = 0;
    setStats(key, s);
  }

  /* ===================== progression ===================== */
  function computeTimeBonus(left, spent) {
    var b;
    if (left <= 15) b = 100;
    else if (left <= 30) b = 80;
    else if (left <= 60) b = 55;
    else b = 40;
    if (spent <= 10) b += 25;
    else if (spent <= 20) b += 12;
    return b;
  }
  function getProfile() {
    var p = lsGet(K("profile"), null);
    if (!p || typeof p !== "object") p = {};
    if (typeof p.wins !== "number" || !isFinite(p.wins) || p.wins < 0) p.wins = 0;
    if (typeof p.played !== "number" || !isFinite(p.played) || p.played < 0) p.played = 0;
    if (typeof p.since !== "number") p.since = Date.now();
    if (typeof p.seen !== "number") p.seen = levelInfo(p.wins).level;
    return p;
  }
  function saveProfile(p) { lsSet(K("profile"), p); if (window.WU.onSave) window.WU.onSave(); }
  function levelInfo(wins) {
    var lvl = 1, need = 3, step = 3, floor = 0;
    while (wins >= floor + need) {
      floor += need; lvl++; need += step;
      if (lvl % 5 === 0) step += 2;
      if (lvl > 999) break;
    }
    return { level: lvl, floor: floor, next: floor + need, into: wins - floor, span: need };
  }
  var TIERS = [
    { min: 1, name: "Bronze", c1: "#e08b4c", c2: "#a0561f", rim: "#7a3f14", ic: "star" },
    { min: 5, name: "Silver", c1: "#d8dde2", c2: "#8f97a0", rim: "#767e87", ic: "star" },
    { min: 10, name: "Gold", c1: "#ffd75e", c2: "#e0991e", rim: "#b3781a", ic: "star" },
    { min: 16, name: "Platinum", c1: "#7fe3e8", c2: "#2f9aa3", rim: "#1f6f77", ic: "crown" },
    { min: 23, name: "Diamond", c1: "#8fd0ff", c2: "#3b74e0", rim: "#274db0", ic: "crown" },
    { min: 32, name: "Master", c1: "#d59bff", c2: "#7b2cbf", rim: "#551d87", ic: "crown", glow: true },
    { min: 43, name: "Legend", c1: "#ffb04d", c2: "#e03131", rim: "#a01c1c", ic: "crown", flame: true },
  ];
  function tierFor(level) { var tr = TIERS[0], i; for (i = 0; i < TIERS.length; i++) if (level >= TIERS[i].min) tr = TIERS[i]; return tr; }
  function hasRank() { return getProfile().wins > 0; }

  var _bid = 0;
  function badgeSVG(level) {
    var tier = tierFor(level), id = "wb" + ++_bid;
    var hex = "M32 2 L60 16 L60 48 L32 70 L4 48 L4 16 Z";
    var emblem =
      tier.ic === "crown"
        ? '<path d="M20 41 L18 24 L26 33 L32 21 L38 33 L46 24 L44 41 Z" fill="#fff" fill-opacity=".92"/><rect x="20" y="43" width="24" height="4" rx="1.5" fill="#fff" fill-opacity=".92"/>'
        : '<path d="M32 20 l3.6 7.8 8.4 .9 -6.3 5.7 1.8 8.3 -7.5-4.3 -7.5 4.3 1.8-8.3 -6.3-5.7 8.4-.9 z" fill="#fff" fill-opacity=".92"/>';
    var flame = tier.flame
      ? '<g class="wu-badge-flame"><path d="M32 -4 c7 8 2 13 5 17 c5-1 4-8 4-8 c5 6 6 11 6 15 a15 15 0 0 1-30 0 c0-6 4-12 8-15 c0 5 3 7 5 7 c-3-7 -2-12 -3-16 z" fill="url(#' + id + 'f)"/></g>'
      : "";
    return (
      '<svg class="wu-badge' + (tier.glow ? " wu-badge-glow" : "") + (tier.flame ? " wu-badge-fire" : "") +
      '" viewBox="-6 -14 76 92" xmlns="http://www.w3.org/2000/svg">' +
      '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="' + tier.c1 + '"/><stop offset="1" stop-color="' + tier.c2 + '"/></linearGradient>' +
      '<linearGradient id="' + id + 'f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe08a"/><stop offset=".5" stop-color="#ff9a3c"/><stop offset="1" stop-color="#e03131"/></linearGradient></defs>' +
      flame +
      '<path d="' + hex + '" fill="url(#' + id + ')" stroke="' + tier.rim + '" stroke-width="3" stroke-linejoin="round"/>' +
      emblem +
      '<text x="32" y="61" text-anchor="middle" font-size="14" font-weight="800" fill="#fff" font-family="Arial, sans-serif">' + level + "</text></svg>"
    );
  }
  function fmtSince(ts) { try { return new Date(ts).toLocaleDateString(undefined, { month: "short", year: "numeric" }); } catch (e) { return ""; } }
  function rankChip() {
    var pr = getProfile(), li = levelInfo(pr.wins), tier = tierFor(li.level);
    var pct = li.span > 0 ? Math.round((li.into / li.span) * 100) : 100;
    var sub = pr.wins + " " + t("statWins") + " · " + pr.played + " " + t("statPlayed") + " · " +
      (li.level >= 999 ? t("maxRank") : li.next - pr.wins + " " + t("toNext"));
    return (
      '<div class="wu-rank"><div class="wu-rank-badge">' + badgeSVG(li.level) + "</div>" +
      '<div class="wu-rank-main"><div class="wu-rank-top"><span class="wu-rank-lvl">' + t("lvlWord") + " " + li.level +
      '</span><span class="wu-rank-tier" style="color:' + tier.c2 + '">' + tier.name + "</span></div>" +
      '<div class="wu-rank-bar"><i style="width:' + pct + "%;background:linear-gradient(90deg," + tier.c1 + "," + tier.c2 + ')"></i></div>' +
      '<div class="wu-rank-sub">' + sub + "</div></div></div>"
    );
  }
  function updateStatsIcon() {
    var btn = document.getElementById("statsBtn");
    if (!btn) return;
    if (hasRank()) {
      var lvl = levelInfo(getProfile().wins).level;
      btn.classList.add("wu-hasbadge");
      btn.innerHTML = '<span class="wu-tb-badge">' + badgeSVG(lvl) + "</span>";
    } else {
      btn.classList.remove("wu-hasbadge");
      btn.innerHTML = ICON.stats;
    }
  }
  function celebrateLevel(level) {
    var tier = tierFor(level);
    var wasTime = game && game.mode === "time" && game.status === "playing" && game.timerId;
    if (wasTime) { clearInterval(game.timerId); game.timerId = null; }
    var host = document.createElement("div");
    host.className = "wu-lvlup";
    host.innerHTML =
      '<div class="wu-lvlup-card"><div class="wu-lvlup-badge">' + badgeSVG(level) + "</div>" +
      '<div class="wu-lvlup-t">' + t("lvlUp") + "</div>" +
      '<div class="wu-lvlup-lv">' + t("lvlWord") + " " + level + ' — <b style="color:' + tier.c2 + '">' + tier.name + "</b></div></div>";
    document.body.appendChild(host);
    if (settings.sound) sWin();
    setTimeout(function () { host.classList.add("out"); }, 1900);
    setTimeout(function () {
      try { document.body.removeChild(host); } catch (e) {}
      if (wasTime && game && game.mode === "time" && game.status === "playing" && !game.timerId) {
        game.timerId = setInterval(timeTick, 1000);
      }
    }, 2300);
  }
  function awardWin(n) {
    var pr = getProfile();
    pr.wins += n || 1;
    if (pr.wins < 0) pr.wins = 0;
    var li = levelInfo(pr.wins);
    if (li.level > pr.seen) { var reached = li.level; pr.seen = li.level; saveProfile(pr); celebrateLevel(reached); }
    else saveProfile(pr);
    updateStatsIcon();
  }
  function awardPlayed() { var pr = getProfile(); pr.played++; saveProfile(pr); updateStatsIcon(); }
  function flashTimeBonus(sec) {
    var info = document.querySelector(".tm-info");
    if (!info) return;
    info.classList.remove("wu-tpulse");
    void info.offsetWidth;
    info.classList.add("wu-tpulse");
    var f = document.createElement("span");
    f.className = "wu-tadd";
    f.textContent = "+" + fmtTime(sec);
    info.appendChild(f);
    setTimeout(function () { try { info.removeChild(f); } catch (e) {} }, 1200);
  }

  /* ===================== sound ===================== */
  var ac = null;
  function beep(f, dur, type) {
    if (!settings.sound) return;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      var o = ac.createOscillator(), g = ac.createGain();
      o.type = type || "sine"; o.frequency.value = f;
      o.connect(g); g.connect(ac.destination);
      g.gain.setValueAtTime(0.05, ac.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.start(); o.stop(ac.currentTime + dur);
    } catch (e) {}
  }
  function sKey() { beep(220, 0.05); }
  function sWin() { [523, 659, 784].forEach(function (f, i) { setTimeout(function () { beep(f, 0.15); }, i * 110); }); }
  function sLose() { beep(140, 0.4, "sawtooth"); }
  function sBad() { beep(120, 0.15, "square"); }

  /* ===================== DOM refs ===================== */
  var root = document.getElementById("wu-root");
  var appEl = root ? root.querySelector(".app") : null;
  var board = document.getElementById("board"),
    kbEl = document.getElementById("keyboard"),
    controls = document.getElementById("controls"),
    toastEl = document.getElementById("toast"),
    bannerEl = document.getElementById("banner"),
    hintEl = document.getElementById("hintline");
  var typer = document.getElementById("wuTyper");
  var endwrap = document.getElementById("endwrap"), endcard = document.getElementById("endcard");
  var toastTimer, chTimeSel = 0, deviceKbd = false, immersive = false, fsActive = false,
    _scrollY = 0, challengeNotice = null;

  function toast(m) {
    if (!toastEl) return;
    toastEl.textContent = m;
    toastEl.style.display = "block";
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toastEl.style.display = "none"; }, 1500);
  }
  function scrollToBoard() {
    if (!root) return;
    try { root.scrollIntoView({ behavior: "smooth", block: "start" }); }
    catch (e) { root.scrollIntoView(); }
  }
  function doAnim(el, cls) {
    if (!el) return;
    el.classList.add(cls);
    setTimeout(function () { try { el.classList.remove(cls); } catch (e) {} }, 380);
  }

  /* ===================== layout ===================== */
  function lockScroll() {
    _scrollY = window.scrollY || window.pageYOffset || 0;
    document.documentElement.classList.add("wu-lock");
    document.body.classList.add("wu-lock");
    document.body.style.top = -_scrollY + "px";
  }
  function unlockScroll() {
    document.documentElement.classList.remove("wu-lock");
    document.body.classList.remove("wu-lock");
    document.body.style.top = "";
    window.scrollTo(0, _scrollY);
  }
  function setImmersive(on) {
    on = !!on;
    if (on === immersive) { applyVV(); return; }
    immersive = on;
    if (root) root.classList.toggle("wu-immersive", on);
    if (on) lockScroll(); else unlockScroll();
    updateFsIcon(); applyVV(); sizeBoardSoon();
  }
  function deviceTarget() { var w = window.innerWidth; if (w <= 480) return 660; if (w <= 1024) return 700; return 720; }
  var vv = window.visualViewport, _raf = 0, _lockedH = 0;
  /* The app sizes itself from its content. Only the on-screen-keyboard and
     immersive modes pin it, because those genuinely need the visual viewport.
     Locking a pixel height in normal flow made the keyboard overflow the
     container and sit on top of the article below it. */
  function applyVV() {
    var h = vv ? vv.height : window.innerHeight;
    if (root) root.style.setProperty("--vvh", h + "px");
    if (!appEl) return;

    if (deviceKbd && vv) {
      appEl.style.position = "fixed";
      appEl.style.top = (vv.offsetTop || 0) + "px";
      appEl.style.left = "0";
      appEl.style.right = "0";
      appEl.style.margin = "0 auto";
      appEl.style.height = h + "px";
    } else {
      appEl.style.position = "";
      appEl.style.top = "";
      appEl.style.left = "";
      appEl.style.right = "";
      appEl.style.margin = "";
      appEl.style.height = "";
    }
    if (root) root.style.minHeight = "";
  }
  function relock() { applyVV(); }
  /* The board is sized purely in CSS from --len. Measuring the DOM and writing
     pixel sizes back was what made the grid jump on every render. All this does
     now is publish the word length. */
  function sizeBoard() {
    if (!board || !game) return;
    board.style.setProperty("--len", game.length);
  }
  function sizeBoardSoon() { sizeBoard(); }

  /* ===================== device keyboard ===================== */
  function resetTyper() {
    if (!typer) return;
    typer.value = SENT;
    try { typer.setSelectionRange(SENT.length, SENT.length); } catch (e) {}
  }
  function onTyperInput() {
    if (!typer) return;
    var v = typer.value;
    if (v === SENT) { resetTyper(); return; }
    if (v.indexOf(SENT) === -1) { handleKey("BACK"); resetTyper(); return; }
    var typed = v.split(SENT).join(""), i, ch, up;
    for (i = 0; i < typed.length; i++) {
      ch = typed.charAt(i);
      if (ch === "\n" || ch === "\r") { handleKey("ENTER"); continue; }
      up = ch.toUpperCase();
      if (up >= "A" && up <= "Z") handleKey(up);
    }
    resetTyper();
  }
  function onTyperKey(e) {
    if (e.key === "Enter") { e.preventDefault(); handleKey("ENTER"); return; }
    if (e.key === "Backspace") { e.preventDefault(); handleKey("BACK"); resetTyper(); }
  }
  function focusTyper() {
    if (!typer) return;
    try { typer.focus({ preventScroll: true }); } catch (e) { try { typer.focus(); } catch (e2) {} }
    resetTyper();
  }
  function setDeviceKbd(on) {
    deviceKbd = !!on;
    if (root) root.classList.toggle("kbd-device", deviceKbd);
    var btn = document.getElementById("kbdBtn");
    if (btn) btn.classList.toggle("active", deviceKbd);
    if (deviceKbd) { setImmersive(true); focusTyper(); }
    else { if (typer) { try { typer.blur(); } catch (e) {} } if (!fsActive) setImmersive(false); }
    applyVV(); sizeBoardSoon();
  }
  function isFs() { return document.fullscreenElement || document.webkitFullscreenElement; }
  function toggleFs() {
    var goingOn = !immersive;
    setImmersive(goingOn); fsActive = goingOn;
    try {
      if (!IS_TOUCH) {
        if (goingOn) {
          var el = document.documentElement;
          if (el.requestFullscreen) el.requestFullscreen();
          else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
        } else {
          if (document.exitFullscreen) document.exitFullscreen();
          else if (document.webkitExitFullscreen) document.webkitExitFullscreen();
        }
      }
    } catch (e) {}
  }
  function onFsChange() {
    if (!IS_TOUCH && !isFs() && fsActive) { fsActive = false; if (!deviceKbd) setImmersive(false); }
    updateFsIcon(); applyVV();
  }
  function updateFsIcon() { var b = document.getElementById("fsBtn"); if (b) b.innerHTML = immersive ? ICON.fsExit : ICON.fs; }

  /* ===================== game core ===================== */
  var game = null, challengeInfo = null;
  function randomWord(len) {
    var a = WORDS[len];
    if (!a || !a.length) return "";
    return a[Math.floor(Math.random() * a.length)].toUpperCase();
  }
  function isValid(w) {
    var n = w.length;
    return !!(SETS[n] && SETS[n][w.toLowerCase()]);
  }
  function evaluate(guess, ans) {
    var res = [], counts = {}, i;
    for (i = 0; i < ans.length; i++) res.push("absent");
    for (i = 0; i < ans.length; i++) counts[ans[i]] = (counts[ans[i]] || 0) + 1;
    for (i = 0; i < guess.length; i++) if (guess[i] === ans[i]) { res[i] = "correct"; counts[guess[i]]--; }
    for (i = 0; i < guess.length; i++) {
      if (res[i] === "correct") continue;
      if (counts[guess[i]] > 0) { res[i] = "present"; counts[guess[i]]--; }
    }
    return res;
  }
  function clearTimers() {
    if (game) {
      if (game.timerId) clearInterval(game.timerId);
      if (game.dailyTimer) clearInterval(game.dailyTimer);
      if (game.limitTimer) clearInterval(game.limitTimer);
    }
  }

  function startGame(mode, len, opts) {
    clearTimers();
    if (endwrap) endwrap.classList.remove("show");
    opts = opts || {};
    game = {
      mode: mode, length: len, answer: "", guesses: [], current: "", status: "playing",
      dayNum: null, timerId: null, dailyTimer: null, limitTimer: null,
      timeLeft: 0, score: 0, duration: settings.timeDur, wordStart: 0,
      limit: 0, limitLeft: 0, revealed: [], hintsUsed: 0, autoHinted: false,
      _reveal: -1, _shake: false,
      topic: null, topicIndex: 0, topicSolved: 0, clue: null,
    };

    if (mode === "daily") {
      game.answer = dailyWord(len);
      game.dayNum = daysSince() + 1;
      var st = lsGet(K("daily_" + len), null);
      if (st && st.day === daysSince()) { game.guesses = st.guesses || []; game.status = st.status || "playing"; }
      game.dailyTimer = setInterval(dailyTick, 1000);
    } else if (mode === "unlimited") {
      game.answer = randomWord(len);
    } else if (mode === "challenge") {
      game.answer = challengeInfo.word.toUpperCase();
      game.limit = challengeInfo.time || 0;
      game.limitLeft = game.limit;
      game.status = "pending";
    } else if (mode === "time") {
      game.answer = randomWord(len);
      game.timeLeft = game.duration;
      game.wordStart = game.duration;
      game.timerId = setInterval(timeTick, 1000);
    } else if (mode === "topic") {
      game.topic = opts.topic || currentTopic;
      game.topicIndex = 0;
      game.topicSolved = 0;
      buildTopicWordSet(game.topic);
      applyTopicWord();
    }

    if (_extArmed) loadExtended(game.length);
    render();
  }

  function persistDaily() { lsSet(K("daily_" + game.length), { day: daysSince(), guesses: game.guesses, status: game.status }); }
  function timeTick() {
    game.timeLeft--;
    var el = document.getElementById("timerVal");
    if (el) {
      el.textContent = fmtTime(game.timeLeft);
      var info = el.closest ? el.closest(".tm-info") : null;
      if (info) info.classList.toggle("wu-tlow", game.timeLeft <= 15 && game.timeLeft > 0);
    }
    if (game.timeLeft <= 0) endTime();
  }
  function endTime() {
    clearInterval(game.timerId);
    game.status = "timeup";
    var b = getTimeBest(game.length, game.duration);
    if (game.score > b.score) { b.score = game.score; lsSet(K("timebest_" + game.length + "_" + game.duration), b); }
    awardPlayed(); render();
  }
  function nextTimeWord() {
    game.answer = randomWord(game.length);
    game.guesses = []; game.current = ""; game.revealed = [];
    game.hintsUsed = 0; game.autoHinted = false; game.wordStart = game.timeLeft;
    render();
  }
  function fmtTime(s) { if (s < 0) s = 0; var m = Math.floor(s / 60), x = s % 60; return m + ":" + (x < 10 ? "0" : "") + x; }
  function fmtHMS(ms) {
    if (ms < 0) ms = 0;
    var s = Math.floor(ms / 1000), h = Math.floor(s / 3600);
    s %= 3600;
    var m = Math.floor(s / 60);
    s %= 60;
    return (h < 10 ? "0" : "") + h + ":" + (m < 10 ? "0" : "") + m + ":" + (s < 10 ? "0" : "") + s;
  }
  function dailyTick() {
    if (daysSince() + 1 !== game.dayNum) { startGame("daily", game.length); return; }
    var c = document.getElementById("countdown");
    if (c) c.textContent = fmtHMS(nextDaily() - Date.now());
  }

  function acceptChallenge() {
    if (!game || game.mode !== "challenge" || game.status !== "pending") return;
    loadExtended(game.length);
    game.status = "playing";
    if (game.limit > 0) { game.limitLeft = game.limit; game.limitTimer = setInterval(limitTick, 1000); }
    render();
  }
  function limitTick() {
    game.limitLeft--;
    var el = document.getElementById("chTimer");
    if (el) {
      el.textContent = fmtTime(game.limitLeft);
      if (el.parentNode) el.parentNode.classList.toggle("low", game.limitLeft <= 10);
    }
    if (game.limitLeft <= 0) limitUp();
  }
  function limitUp() {
    if (game.limitTimer) clearInterval(game.limitTimer);
    game.status = "lost";
    if (challengeInfo && challengeInfo.enc) recordChallengeResult(challengeInfo.enc, "lost", challengeInfo.word);
    awardPlayed(); sLose(); render();
  }

  function hardViolation(g) {
    if (!settings.hard || game.guesses.length === 0) return null;
    var greens = {}, present = {}, pos, ch;
    game.guesses.forEach(function (pg) {
      var e = evaluate(pg, game.answer), i;
      for (i = 0; i < pg.length; i++) {
        if (e[i] === "correct") greens[i] = pg[i];
        else if (e[i] === "present") present[pg[i]] = true;
      }
    });
    for (pos in greens) if (g[+pos] !== greens[pos]) return t("spotMust", +pos + 1, greens[pos]);
    for (ch in present) if (g.indexOf(ch) === -1) return t("mustUse", ch);
    return null;
  }

  function hintModes() { return ["unlimited", "time", "topic"]; }
  function hintAllowed() {
    if (!game) return false;
    if (game.mode === "challenge") return !!(challengeInfo && challengeInfo.hints);
    if (hintModes().indexOf(game.mode) < 0) return false;
    if (settings.hints) return true;
    return game.guesses.length >= AUTO_HINT_AFTER;
  }
  function maybeAutoHint() {
    if (settings.hints) return;
    if (hintModes().indexOf(game.mode) < 0) return;
    if (game.status !== "playing") return;
    if (game.guesses.length < AUTO_HINT_AFTER) return;
    if (game.autoHinted) return;
    if (game.hintsUsed >= MAX_HINTS) return;
    game.autoHinted = true;
    var avail = [], i;
    for (i = 0; i < game.length; i++) if (game.revealed.indexOf(i) < 0) avail.push(i);
    if (avail.length) {
      var pos = avail[Math.floor(Math.random() * avail.length)];
      game.revealed.push(pos); game.hintsUsed++;
      toast(t("hintOn"));
    }
  }
  function useHint() {
    if (game.status !== "playing" || !hintAllowed()) return;
    if (game.hintsUsed >= MAX_HINTS) { toast(t("hintNone")); return; }
    var avail = [], i;
    for (i = 0; i < game.length; i++) if (game.revealed.indexOf(i) < 0) avail.push(i);
    if (!avail.length) { toast(t("hintAll")); return; }
    var pos = avail[Math.floor(Math.random() * avail.length)];
    game.revealed.push(pos); game.hintsUsed++;
    renderHint(); renderControls();
  }
  function swapWord() {
    if (["unlimited", "time"].indexOf(game.mode) < 0) return;
    game.answer = randomWord(game.length);
    game.guesses = []; game.current = ""; game.revealed = [];
    game.hintsUsed = 0; game.autoHinted = false;
    toast(t("newWord")); render();
  }

  function submit() {
    if (game.status !== "playing") return;
    var g = game.current;
    if (g.length !== game.length) { toast(t("notEnough")); shake(); sBad(); return; }

    // In topic mode the answers are names — VENOM, JAPAN, TESLA — which are not
    // in the dictionary. Guessing another name from the same topic is the most
    // natural thing a player does, so the whole topic counts as valid input
    // alongside the normal word list.
    if (g !== game.answer && !isValid(g) && !isTopicWord(g)) {
      var p = extProm[game.length];
      if (p && !extReady[game.length]) {
        p.then(function () { if (game.status === "playing" && game.current === g) submit(); });
        return;
      }
      toast(t("notInList")); shake(); sBad(); return;
    }

    var hv = hardViolation(g);
    if (hv) { toast(hv); shake(); sBad(); return; }

    game.guesses.push(g);
    game._reveal = game.guesses.length - 1;
    var won = g === game.answer;
    game.current = "";

    if (won) {
      sWin();
      if (game.limitTimer) clearInterval(game.limitTimer);

      if (game.mode === "time") {
        game.score++;
        var left = game.timeLeft, spent = (game.wordStart || game.duration) - left, before = game.timeLeft;
        game.timeLeft = Math.min(TIME_CAP, game.timeLeft + computeTimeBonus(left, spent));
        var added = game.timeLeft - before;
        render();
        if (added > 0) flashTimeBonus(added);
        awardWin(1);
        setTimeout(function () { if (game.mode === "time" && game.status === "playing") nextTimeWord(); }, 520);
        return;
      }

      if (game.mode === "topic") {
        game.topicSolved++;
        awardWin(1);
        game.topicIndex++;
        if (game.topicIndex >= game.topic.items.length) {
          game.status = "won";
          awardPlayed();
          render();
          return;
        }
        render();
        setTimeout(function () {
          if (game.mode === "topic" && game.status === "playing") { applyTopicWord(); render(); }
        }, 640);
        return;
      }

      game.status = "won";
      if (game.mode === "daily") { recordDaily(game.length, true, game.guesses.length); persistDaily(); }
      else if (game.mode === "unlimited") recordUnlimited(game.length, true, game.guesses.length);
      else if (game.mode === "challenge") {
        if (challengeInfo && challengeInfo.enc) recordChallengeResult(challengeInfo.enc, "won", challengeInfo.word);
      }
      awardWin(1); awardPlayed();
    } else if (game.guesses.length >= 6) {
      if (game.mode === "time") {
        toast(t("wordWas", game.answer));
        render();
        setTimeout(function () { if (game.mode === "time" && game.status === "playing") nextTimeWord(); }, 1100);
        return;
      }
      if (game.mode === "topic") {
        toast(t("wordWas", game.answer));
        game.topicIndex++;
        render();
        setTimeout(function () {
          if (game.mode !== "topic") return;
          if (game.topicIndex >= game.topic.items.length) { game.status = "lost"; awardPlayed(); render(); return; }
          applyTopicWord(); render();
        }, 1200);
        return;
      }
      game.status = "lost"; sLose();
      if (game.limitTimer) clearInterval(game.limitTimer);
      if (game.mode === "daily") { recordDaily(game.length, false, 0); persistDaily(); }
      else if (game.mode === "unlimited") recordUnlimited(game.length, false, 0);
      else if (game.mode === "challenge") {
        if (challengeInfo && challengeInfo.enc) recordChallengeResult(challengeInfo.enc, "lost", challengeInfo.word);
      }
      awardPlayed();
    } else if (game.mode === "daily") persistDaily();

    if (game.status === "playing") maybeAutoHint();
    render();
  }

  function shake() { game._shake = true; renderBoard(); }
  function handleKey(key) {
    if (!game || game.status !== "playing") return;
    if (key === "ENTER") { submit(); return; }
    if (key === "BACK") { game.current = game.current.slice(0, -1); renderBoard(); return; }
    if (/^[A-Z]$/.test(key) && game.current.length < game.length) {
      game.current += key; renderBoard(); sKey();
    }
  }

  /* ===================== topic mode ===================== */
  var topicIndexCache = null, currentTopic = null, tpFilter = { q: "", cat: "" };
  var topicWordSet = null;

  /** Every answer in the running topic, so they are all accepted as guesses. */
  function isTopicWord(g) {
    if (!game || game.mode !== "topic" || !topicWordSet) return false;
    return topicWordSet[g] === true;
  }
  function buildTopicWordSet(tp) {
    topicWordSet = {};
    (tp.items || []).forEach(function (it) { topicWordSet[String(it.answer).toUpperCase()] = true; });
  }

  function applyTopicWord() {
    var item = game.topic.items[game.topicIndex];
    if (!item) return;
    game.answer = String(item.answer).toUpperCase();
    game.length = game.answer.length;
    game.clue = item.clue || null;
    game.guesses = []; game.current = ""; game.revealed = [];
    game.hintsUsed = 0; game.autoHinted = false; game._reveal = -1;
    loadExtended(game.length);
  }

  function fetchTopics() {
    if (topicIndexCache) return Promise.resolve(topicIndexCache);
    return fetch("/api/topics?region=" + encodeURIComponent(CFG.region))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { topicIndexCache = j; return j; });
  }
  function fetchTopic(slug) {
    return fetch("/api/topics/" + encodeURIComponent(slug))
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { return { slug: j.topic.slug, name: j.topic.name, icon: j.topic.icon, items: j.items }; });
  }

  function openTopicPicker() {
    openModal("topicModal");
    var body = document.getElementById("topicBody");
    if (!body) return;
    body.innerHTML = '<div class="tp-empty">' + t("tpLoading") + "</div>";
    fetchTopics()
      .then(function () { renderTopicPicker(); })
      .catch(function () { body.innerHTML = '<div class="tp-empty">' + t("tpFailed") + "</div>"; });
  }
  function renderTopicPicker() {
    var body = document.getElementById("topicBody");
    if (!body || !topicIndexCache) return;
    var cats = topicIndexCache.categories || [];
    var list = (topicIndexCache.topics || []).filter(function (x) {
      if (tpFilter.cat && x.category !== tpFilter.cat) return false;
      if (!tpFilter.q) return true;
      return (x.name + " " + x.category).toLowerCase().indexOf(tpFilter.q.toLowerCase()) > -1;
    });

    var h = '<input class="tp-search" id="tpSearch" type="search" autocomplete="off" placeholder="' + esc(t("tpSearch")) + '" value="' + esc(tpFilter.q) + '">';
    h += '<div class="tp-cats"><button class="tp-cat' + (tpFilter.cat ? "" : " active") + '" data-tpcat="">' + t("tpAll") + "</button>";
    cats.forEach(function (c) {
      h += '<button class="tp-cat' + (tpFilter.cat === c ? " active" : "") + '" data-tpcat="' + esc(c) + '">' + esc(c) + "</button>";
    });
    h += "</div>";

    if (!list.length) h += '<div class="tp-empty">' + t("tpNone") + "</div>";
    else {
      h += '<div class="tp-grid">';
      list.forEach(function (x) {
        h += '<button class="tp-item" data-tpslug="' + esc(x.slug) + '">' +
          '<span class="e">' + esc(x.icon || "🎯") + "</span>" +
          '<span class="t"><span class="n">' + esc(x.name) + '</span><span class="c">' + x.count + " · " + esc(x.category) + "</span></span></button>";
      });
      h += "</div>";
    }
    body.innerHTML = h;

    var si = document.getElementById("tpSearch");
    if (si) {
      si.addEventListener("input", function () { tpFilter.q = si.value; renderTopicPicker(); });
      if (tpFilter.q) { try { si.focus(); si.setSelectionRange(si.value.length, si.value.length); } catch (e) {} }
    }
  }
  function chooseTopic(slug) {
    closeAll();
    fetchTopic(slug)
      .then(function (tp) {
        if (!tp.items.length) { toast(t("tpFailed")); return; }
        currentTopic = tp;
        lsSet(K("last_topic"), slug);
        challengeNotice = null;
        startGame("topic", tp.items[0].answer.length, { topic: tp });
      })
      .catch(function () { toast(t("tpFailed")); });
  }

  /* ===================== rendering ===================== */
  function renderBoard() {
    sizeBoard();
    var len = game.length, html = "", r, c;
    for (r = 0; r < 6; r++) {
      var letters = [], evals = [];
      if (r < game.guesses.length) { letters = game.guesses[r].split(""); evals = evaluate(game.guesses[r], game.answer); }
      else if (r === game.guesses.length) letters = game.current.split("");
      var reveal = r === game._reveal, win = game.status === "won" && r === game.guesses.length - 1;
      html += '<div class="row' + (game._shake && r === game.guesses.length ? " shake" : "") + '">';
      for (c = 0; c < len; c++) {
        var L = letters[c] || "", ev = evals[c], cls = "tile";
        if (ev) cls += " " + ev;
        else if (L) cls += " filled";
        if (ev && reveal) cls += " reveal";
        if (win) cls += " win";
        var dl = reveal || win ? ' style="animation-delay:' + c * 0.12 + 's"' : "";
        html += '<div class="' + cls + '"' + dl + ">" + L + "</div>";
      }
      html += "</div>";
    }
    board.innerHTML = html;
    game._shake = false; game._reveal = -1;
    sizeBoardSoon();
  }
  function renderKeyboard() {
    var ks = {}, rank = { absent: 1, present: 2, correct: 3 };
    game.guesses.forEach(function (gg) {
      var e = evaluate(gg, game.answer);
      gg.split("").forEach(function (ch, i) { if (!ks[ch] || rank[e[i]] > rank[ks[ch]]) ks[ch] = e[i]; });
    });
    var html = "";
    [["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","BACK"]]
      .forEach(function (row) {
        html += '<div class="kb-row">';
        row.forEach(function (key) {
          var wide = key === "ENTER" || key === "BACK";
          var label = key === "BACK" ? ICON.back : key === "ENTER" ? t("enterKey") : key;
          var st = ks[key] ? " " + ks[key] : "";
          html += '<button class="key' + (wide ? " wide" : "") + st + '" data-key="' + key + '">' + label + "</button>";
        });
        html += "</div>";
      });
    kbEl.innerHTML = html;
  }
  /* The hint row always occupies its height, so revealing a letter fades text
     in rather than pushing the board down. */
  function renderHint() {
    if (!hintEl) return;
    if (!game.revealed.length) { hintEl.classList.remove("on"); hintEl.innerHTML = ""; return; }
    var s = "", i;
    for (i = 0; i < game.length; i++) {
      s += game.revealed.indexOf(i) > -1 ? game.answer[i] : "·";
      s += i < game.length - 1 ? " " : "";
    }
    hintEl.innerHTML = '<span class="hint-inner"><span class="hintlabel">' + t("hintTag") +
      "</span>" + s + "</span>";
    hintEl.classList.add("on");
  }
  function cbtn(act, icon, label, ghost) {
    return '<button class="cbtn' + (ghost ? " ghost" : "") + '" data-act="' + act + '"><span class="ic">' + ICON[icon] + "</span><span>" + label + "</span></button>";
  }
  function iBtn(act, icon, title, extra) {
    return '<button class="ibtn' + (extra ? " " + extra : "") + '" data-act="' + act + '" title="' + title + '">' + ICON[icon] + "</button>";
  }
  function hintBtnIcon() {
    var left = MAX_HINTS - game.hintsUsed;
    return '<button class="ibtn" data-act="hint" title="' + t("hint") + '"' + (left <= 0 ? " disabled" : "") + ">" +
      ICON.bulb + '<span class="badge">' + left + "</span></button>";
  }
  function renderBanner() {
    if (game.mode === "challenge" && game.status === "playing") {
      var who = challengeInfo && challengeInfo.by ? esc(challengeInfo.by) : t("aFriend");
      bannerEl.innerHTML = '<div class="ch-mini"><span class="ico">' + ICON.target + '</span><span class="ch-name">' +
        t("chMine", who) + '</span><button class="ch-x" data-act="cancelchallenge" title="' + t("chCancel") +
        '" aria-label="' + t("chCancel") + '">' + ICON.close + "</button></div>";
      return;
    }
    if (challengeNotice && game.mode !== "challenge") {
      var nw = challengeNotice.by ? esc(challengeNotice.by) : t("aFriend");
      var verb = challengeNotice.r === "won" ? t("won") : t("lost");
      bannerEl.innerHTML = '<div class="ch-card"><button class="close" data-act="noticeclose" aria-label="Close">' + ICON.close + "</button>" +
        '<div class="crow"><span class="ico">' + ICON.target + '</span><div><div class="who">' + t("chDone", nw) +
        '</div><div class="sub">' + t("chDoneW", verb, esc((challengeNotice.word || "").toUpperCase())) + "</div></div></div></div>";
      return;
    }
    bannerEl.innerHTML = "";
  }
  function renderPending() {
    var who = challengeInfo && challengeInfo.by ? esc(challengeInfo.by) : t("aFriend");
    var bits = [];
    if (game.limit > 0) bits.push(t("chTimed", fmtTime(game.limit)));
    if (challengeInfo && challengeInfo.hints) bits.push(t("chHints"));
    var tnote = bits.length ? '<div class="sub">' + bits.join(" · ") + "</div>" : '<div class="sub">' + t("chGuess") + "</div>";
    bannerEl.innerHTML = '<div class="ch-card"><button class="close" data-act="closechallenge" aria-label="Close">' + ICON.close + "</button>" +
      '<div class="crow"><span class="ico">' + ICON.target + '</span><div><div class="who">' + t("chYou", who) + "</div>" + tnote + "</div>" +
      '<div class="ch-actions"><button class="ch-accept" data-act="acceptchallenge">' + ICON.check + t("accept") +
      '</button><button class="ch-reject" data-act="rejectchallenge">' + t("reject") + "</button></div></div></div>";
    controls.innerHTML = "";
    hintEl.style.display = "none"; hintEl.innerHTML = "";
    if (endwrap) endwrap.classList.remove("show");
    kbEl.innerHTML = "";
    game._reveal = -1;
    renderBoard();
  }
  function renderControls() {
    var ended = game.status === "won" || game.status === "lost", h = "";
    if (game.mode === "daily") {
      h = '<span class="muted">' + t("dailyNum", game.dayNum) + '</span><span class="muted">' + t("nextIn") +
        ' <span id="countdown" class="count">' + fmtHMS(nextDaily() - Date.now()) + "</span></span>";
    } else if (game.mode === "unlimited") {
      h = iBtn("newgame", "refresh", t("newGame"), ended ? "done" : "");
      if (hintAllowed()) h += hintBtnIcon();
      h += cbtn("openchallenge", "target", t("chFriend"));
    } else if (game.mode === "challenge") {
      if (challengeInfo && challengeInfo.hints) h += hintBtnIcon();
      if (game.limit > 0) {
        h += '<span class="ch-timer' + (game.limitLeft <= 10 ? " low" : "") + '"><span class="ic">' + ICON.clock +
          '</span><span id="chTimer">' + fmtTime(game.limitLeft || game.limit) + "</span></span>";
      }
    } else if (game.mode === "time") {
      var doneT = game.status === "timeup", right = "";
      if (hintAllowed()) right += hintBtnIcon();
      right += iBtn("newgame", "refresh", t("restart"), doneT ? "done" : "");
      h = '<div class="tmode"><div class="tm-left">' +
        '<div class="tm-info"><span class="ic">' + ICON.clock + '</span><b id="timerVal">' + fmtTime(game.timeLeft) +
        '</b><span class="dot">•</span>' + t("solvedLbl") + ' <b id="scoreVal">' + game.score + "</b></div>" +
        '<div class="seg tm-dur"><button data-seg="duration" data-val="60">1:00</button><button data-seg="duration" data-val="90">1:30</button><button data-seg="duration" data-val="120">2:00</button></div>' +
        '</div><div class="tm-right">' + right + "</div></div>";
    } else if (game.mode === "topic") {
      var tp = game.topic;
      var rightT = "";
      if (hintAllowed()) rightT += hintBtnIcon();
      rightT += iBtn("picktopic", "grid", t("tpChange"));
      h = '<div class="tp-bar"><div class="tp-now"><span class="tp-ico">' + esc(tp.icon || "🎯") + "</span>" +
        '<span class="tp-meta"><span class="tp-name">' + esc(tp.name) + "</span>" +
        '<span class="tp-prog">' + t("tpProgress", Math.min(game.topicIndex + 1, tp.items.length), tp.items.length) +
        " · " + game.topicSolved + " " + t("solvedLbl").toLowerCase() + "</span></span></div>" +
        '<div class="tm-right">' + rightT + "</div></div>";
    }
    controls.innerHTML = h;

    var clueEl = document.getElementById("tpClue");
    if (clueEl) {
      if (game.mode === "topic" && game.clue) {
        clueEl.innerHTML = '<span class="hint-inner"></span>';
        clueEl.firstChild.textContent = t("tpClue", game.clue);
        clueEl.classList.add("show");
      } else { clueEl.classList.remove("show"); clueEl.innerHTML = ""; }
    }
  }
  function renderEnd() {
    var e = game, title = "", disp = "";
    if (e.status === "won") {
      var ord = ordN(e.guesses.length - 1);
      if (e.mode === "challenge") {
        var who = challengeInfo && challengeInfo.by ? esc(challengeInfo.by) : t("someone");
        title = t("tWonCh"); disp = t("mWonCh", who, ord, e.answer);
      } else if (e.mode === "daily") { title = t("tWon"); disp = t("mWonDaily", ord); }
      else if (e.mode === "topic") { title = t("tpDone"); disp = t("tpDoneMsg", e.topic.items.length, esc(e.topic.name)); }
      else { title = t("tWon"); disp = t("mWon", ord, e.answer); }
    } else if (e.status === "lost") {
      if (e.mode === "challenge") {
        var who2 = challengeInfo && challengeInfo.by ? esc(challengeInfo.by) : t("someone");
        title = t("tLostCh"); disp = t("mLostCh", who2, e.answer);
      } else if (e.mode === "topic") {
        title = t("tpDone"); disp = t("tpDoneMsg", e.topicSolved, esc(e.topic.name));
      } else { title = t("tLost"); disp = t("mLost", e.answer); }
    } else if (e.status === "timeup") {
      var b = getTimeBest(e.length, e.duration);
      title = t("tTime"); disp = t("mTime", e.score, wordUnit(e.score), b.score);
    } else {
      if (endwrap) endwrap.classList.remove("show");
      if (endcard) endcard.innerHTML = "";
      return;
    }

    var sh = resultShare();
    var btns = '<div class="ebtns">';
    btns += '<button class="ebtn primary" data-act="endplay"><span class="ic">' + ICON.refresh + "</span>" + t("keepPlaying") + "</button>";
    btns += '<button class="ebtn" data-act="endchallenge"><span class="ic">' + ICON.target + "</span>" + t("chFriend") + "</button>";
    btns += "</div>";
    if (endcard) endcard.innerHTML = '<div class="et">' + title + '</div><div class="em">' + disp + "</div>" + shareRow(sh.msg, sh.url) + btns;
    if (endwrap) endwrap.classList.add("show");
  }
  function updateTabs() {
    document.querySelectorAll(".tab").forEach(function (tb) {
      tb.classList.toggle("active", tb.getAttribute("data-mode") === game.mode);
    });
  }
  function updateSeg() {
    document.querySelectorAll("[data-seg]").forEach(function (b) {
      var n = b.getAttribute("data-seg"), v = b.getAttribute("data-val"), cur;
      if (n === "theme") cur = settings.theme;
      else if (n === "length") cur = String(settings.length);
      else if (n === "duration") cur = String(settings.timeDur);
      b.classList.toggle("active", String(cur) === v);
    });
  }
  function render() {
    if (game && game.mode === "challenge" && (game.status === "won" || game.status === "lost")) clearPendingChallenge();
    updateTabs();
    if (endwrap && game && game.status === "playing") endwrap.classList.remove("show");
    if (game.mode === "challenge" && game.status === "pending") { renderPending(); sizeBoardSoon(); return; }
    renderBanner(); renderControls(); renderHint(); renderBoard(); renderKeyboard(); renderEnd(); updateSeg(); sizeBoardSoon();
  }

  /* ===================== sharing ===================== */
  function copyText(str) {
    try { if (navigator.clipboard && navigator.clipboard.writeText) { navigator.clipboard.writeText(str); return; } } catch (e) {}
    try {
      var ta = document.createElement("textarea");
      ta.value = str; ta.style.position = "fixed"; ta.style.opacity = "0";
      document.body.appendChild(ta); ta.focus(); ta.select();
      try { document.execCommand("copy"); } catch (e) {}
      document.body.removeChild(ta);
    } catch (e) {}
  }
  function shareRow(msg, url) {
    var full = msg + " " + url,
      tx = encodeURIComponent(msg), u = encodeURIComponent(url), wa = encodeURIComponent(full);
    var wapp = "https://wa.me/?text=" + wa,
      fb = "https://www.facebook.com/sharer/sharer.php?u=" + u + "&quote=" + tx,
      tg = "https://t.me/share/url?url=" + u + "&text=" + tx;
    var nat = "share" in navigator;
    var h = '<div class="share-row"><span class="lbl">' + t("shareLbl") + "</span>";
    h += '<a class="sbtn wa" href="' + wapp + '" target="_blank" rel="noopener nofollow">' + ICON.whatsapp + "<span>WhatsApp</span></a>";
    h += '<a class="sbtn fb icon" href="' + fb + '" target="_blank" rel="noopener nofollow" aria-label="Facebook">' + ICON.facebook + "</a>";
    h += '<a class="sbtn tg icon" href="' + tg + '" target="_blank" rel="noopener nofollow" aria-label="Telegram">' + ICON.telegram + "</a>";
    if (nat) h += '<button class="sbtn native icon" data-share="' + esc(full) + '" aria-label="More">' + ICON.share + "</button>";
    h += '<button class="sbtn copy icon" data-copy="' + esc(full) + '" aria-label="Copy">' + ICON.copy + "</button>";
    h += "</div>";
    return h;
  }
  function resultShare() {
    var won = game.status === "won",
      ord = won ? ordN(game.guesses.length - 1) : null,
      who = challengeInfo && challengeInfo.by ? challengeInfo.by : "", msg;
    if (game.mode === "challenge") {
      msg = won
        ? who ? t("shWonCh", who, ord, game.answer) : t("shWonChNo", ord, game.answer)
        : t("shLostCh", who ? who + " — " : "", game.answer);
    } else if (game.mode === "daily") {
      msg = won ? t("shDailyW", game.dayNum, ord) : t("shDailyL", game.dayNum);
    } else if (game.mode === "time") {
      msg = game.score > 0 ? t("shTime", game.score, wordUnit(game.score)) : t("shTime0");
    } else if (game.mode === "topic") {
      msg = t("shTopic", game.topicSolved, game.topic.items.length, game.topic.name);
    } else {
      msg = won ? t("shWon", ord, game.answer) : t("shLost", game.answer);
    }
    return { msg: msg, url: SITE + "/" };
  }

  /* ===================== challenge creation ===================== */
  function encodeChallenge(word, time, hints) {
    return b64(word.toLowerCase() + "|" + (time > 0 ? time : 0) + "|" + (hints ? 1 : 0));
  }
  function makeLink() {
    var w = document.getElementById("chWord").value.trim().toLowerCase(),
      name = document.getElementById("chName").value.trim(),
      err = document.getElementById("chErr");
    var hEl = document.getElementById("chHints"), hintsOn = hEl ? hEl.checked : false;
    if (w.length < 3 || w.length > 7 || !/^[a-z]+$/.test(w)) { err.textContent = t("errWord"); return; }
    if (!isValid(w)) {
      var p = loadExtended(w.length);
      if (p && !extReady[w.length]) { err.textContent = t("checking"); p.then(function () { makeLink(); }); return; }
      err.textContent = t("errDict", w.toUpperCase()); return;
    }
    err.textContent = "";
    var enc = encodeChallenge(w, chTimeSel, hintsOn), link = challengeUrl(enc, name);
    document.getElementById("chLink").value = link;
    document.getElementById("chResult").style.display = "block";
    var msg = (name ? t("chInvite", name) : t("chInviteMe")) + (chTimeSel > 0 ? t("chInviteTime", fmtTime(chTimeSel)) : "");
    document.getElementById("chShare").innerHTML = shareRow(msg, link);
    copyText(link);
    toast(t("chCopied"));
  }
  function readChallenge() {
    var p = new URLSearchParams(location.search), c = p.get("c") || p.get("challenge");
    if (!c) return null;
    try {
      var raw = unb64(decodeURIComponent(c)).toLowerCase(), parts = raw.split("|"), w = parts[0],
        tt = parts[1] ? parseInt(parts[1], 10) : 0, hn = parts[2] === "1";
      if (/^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 7) {
        return {
          word: w,
          by: p.get("by") ? decodeURIComponent(p.get("by")).slice(0, 20) : null,
          time: tt > 0 ? tt : 0, hints: hn, enc: c,
        };
      }
    } catch (e) {}
    return null;
  }
  function readChallengeRaw() {
    var p = new URLSearchParams(location.search), c = p.get("c") || p.get("challenge");
    if (!c) return null;
    try {
      var raw = unb64(decodeURIComponent(c)).toLowerCase(), w = raw.split("|")[0];
      if (/^[a-z]+$/.test(w) && w.length >= 3 && w.length <= 7) return { len: w.length, enc: c };
    } catch (e) {}
    return null;
  }

  /* ===================== modals ===================== */
  function openModal(id) {
    var el = document.getElementById(id);
    if (!el) return;
    el.classList.add("show");
    if (id === "statsModal") {
      fillStats();
      // Cloud save lives here too, where players look for their progress.
      if (window.WU && window.WU.renderCloudRow) window.WU.renderCloudRow("statsCloud");
    }
    if (id === "topicModal") { if (topicIndexCache) renderTopicPicker(); }
    if (id === "challengeModal") {
      loadExtended(settings.length);
      chTimeSel = 0;
      document.querySelectorAll("#chTimeSeg button").forEach(function (b) {
        b.classList.toggle("active", b.getAttribute("data-chtime") === "0");
      });
      var chH = document.getElementById("chHints");
      if (chH) chH.checked = false;
      document.getElementById("chErr").textContent = "";
      document.getElementById("chResult").style.display = "none";
      document.getElementById("chShare").innerHTML = "";
      document.getElementById("chWord").value = "";
      document.getElementById("chName").value = "";
      setTimeout(function () { document.getElementById("chWord").focus(); }, 50);
    }
  }
  function closeAll() {
    document.querySelectorAll(".overlay.show").forEach(function (o) { o.classList.remove("show"); });
    if (deviceKbd) focusTyper();
  }
  function statCell(num, lab) { return '<div class="cell"><div class="num">' + num + '</div><div class="lab">' + lab + "</div></div>"; }
  function fillStats() {
    var title = document.getElementById("statsTitle"), body = document.getElementById("statsBody");
    var pr = getProfile();
    // No rank until the first win — an empty Level 1 badge means nothing.
    var head = hasRank()
      ? rankChip() + '<div class="wu-since">' + t("memberSince", fmtSince(pr.since)) + "</div>"
      : '<div class="wu-norank">' + ICON.target + "<b>Win your first word to start ranking</b>" +
        "<span>Levels, tiers and badges unlock as you play.</span></div>";
    head += '<div class="setrow col" id="statsCloud"></div>';
    if (game.mode === "challenge") { title.textContent = t("stCh"); body.innerHTML = head + '<p class="muted">' + t("stChNote") + "</p>"; return; }
    if (game.mode === "topic") {
      title.textContent = esc(game.topic.name);
      body.innerHTML = head + '<div class="statgrid">' + statCell(game.topicSolved, t("solvedLbl")) +
        statCell(game.topic.items.length, t("stPlayed")) + "</div>";
      return;
    }
    if (game.mode === "time") {
      var b = getTimeBest(game.length, game.duration);
      title.textContent = t("stTime", game.length, fmtTime(game.duration));
      body.innerHTML = head + '<div class="statgrid">' + statCell(b.score, t("stBest")) + statCell(game.score, t("stRun")) +
        '</div><p class="muted">' + t("stTimeNote") + "</p>";
      return;
    }
    var key = game.mode + "_" + game.length, s = getStats(key),
      pct = s.played ? Math.round((s.wins / s.played) * 100) : 0,
      maxd = Math.max(1, Math.max.apply(null, s.dist));
    var last = game.status === "won" ? game.guesses.length : 0;
    var bars = s.dist
      .map(function (v, i) {
        var w = Math.round((v / maxd) * 100);
        return '<div class="distrow"><span>' + (i + 1) + '</span><div class="bar' + (i + 1 === last ? " hl" : "") +
          '" style="width:' + Math.max(8, w) + '%">' + v + "</div></div>";
      })
      .join("");
    title.textContent = t("stLetters", game.mode === "daily" ? t("stDaily") : t("stUnl"), game.length);
    body.innerHTML = head + '<div class="statgrid">' + statCell(s.played, t("stPlayed")) + statCell(pct + "%", t("stWin")) +
      statCell(s.cur, t("stStreak")) + statCell(s.max, t("stMax")) + "</div><h4>" + t("stDist") + "</h4>" + bars;
  }
  function updateRegions() {
    var rowEl = document.getElementById("regionRow");
    if (!rowEl) return;
    rowEl.innerHTML = REGIONS.map(function (r) {
      var inner = '<span class="flag">' + (FLAG[r.code] || "") + "</span>" + r.name;
      return r.code === CFG.region
        ? '<span class="regbtn active" aria-current="page">' + inner + "</span>"
        : '<a class="regbtn" href="' + r.url + '" rel="noopener">' + inner + "</a>";
    }).join("");
  }
  function cvar(s) { return s === "correct" ? "green" : s === "present" ? "yellow" : "absent"; }
  function brandRow(word, pat) {
    return '<div class="brow">' + word.split("").map(function (ch, i) {
      return '<div class="bt" style="background:var(--' + cvar(pat[i % pat.length]) + ')">' + ch + "</div>";
    }).join("") + "</div>";
  }
  function brandTiles() {
    return '<div class="brand">' +
      brandRow("WORDLE", ["correct", "absent", "present", "correct", "absent", "correct"]) +
      brandRow("UNLIMITED", ["present", "correct", "absent", "correct", "present", "absent", "correct", "absent", "present"]) +
      '<div class="tagline">PLAY FREE • UNLIMITED WORDS</div></div>';
  }

  /* ===================== events ===================== */
  document.addEventListener("click", function (e) {
    var tg = e.target, el;
    if (tg.closest && tg.closest("#wuThemeBtn")) { toggleTheme(); return; }
    if ((el = tg.closest("[data-share]"))) {
      var d = el.getAttribute("data-share");
      if (navigator.share) navigator.share({ text: d }).catch(function () {});
      return;
    }
    if ((el = tg.closest("[data-copy]"))) { copyText(el.getAttribute("data-copy")); toast(t("copied")); return; }
    if ((el = tg.closest("[data-key]"))) { handleKey(el.getAttribute("data-key")); el.blur(); if (deviceKbd) focusTyper(); return; }
    if ((el = tg.closest("[data-chtime]"))) {
      chTimeSel = parseInt(el.getAttribute("data-chtime"), 10);
      document.querySelectorAll("#chTimeSeg button").forEach(function (b) { b.classList.toggle("active", b === el); });
      return;
    }
    if ((el = tg.closest("[data-tpcat]"))) { tpFilter.cat = el.getAttribute("data-tpcat"); renderTopicPicker(); return; }
    if ((el = tg.closest("[data-tpslug]"))) { chooseTopic(el.getAttribute("data-tpslug")); return; }
    if (tg.closest("#typebar") && !tg.closest("[data-act]")) { if (deviceKbd) focusTyper(); return; }
    if ((el = tg.closest("[data-act]"))) {
      var a = el.getAttribute("data-act");
      if (a === "endplay") { if (endwrap) endwrap.classList.remove("show"); newGame(); el.blur(); return; }
      if (a === "endchallenge") { if (endwrap) endwrap.classList.remove("show"); closeAll(); openModal("challengeModal"); el.blur(); return; }
      if (a === "newgame") { doAnim(el, "spin-anim"); setTimeout(newGame, 180); el.blur(); return; }
      if (a === "hint") { doAnim(el, "pulse-anim"); setTimeout(useHint, 180); el.blur(); return; }
      if (a === "swap") { doAnim(el, "swap-anim"); setTimeout(swapWord, 180); el.blur(); return; }
      if (a === "picktopic") { openTopicPicker(); el.blur(); return; }
      if (a === "playnow") {
        closeAll();
        if (endwrap) endwrap.classList.remove("show");
        if (!game || game.status !== "playing") switchLength("unlimited", settings.length);
        scrollToBoard();
        el.blur();
        return;
      }
      if (a === "openchallenge") { closeAll(); openModal("challengeModal"); }
      else if (a === "acceptchallenge") acceptChallenge();
      else if (a === "rejectchallenge" || a === "closechallenge" || a === "cancelchallenge") leaveToHome();
      else if (a === "noticeclose") { challengeNotice = null; render(); }
      else if (a === "makelink") makeLink();
      else if (a === "copylink") { copyText(document.getElementById("chLink").value); toast(t("linkCopied")); }
      else if (a === "fullscreen") toggleFs();
      else if (a === "kbd") setDeviceKbd(!deviceKbd);
      else if (a === "kbdoff") setDeviceKbd(false);
      else if (window.WU.actions && window.WU.actions[a]) window.WU.actions[a](el);
      el.blur();
      return;
    }
    if ((el = tg.closest("[data-mode]"))) {
      var mode = el.getAttribute("data-mode");
      closeAll(); challengeNotice = null;
      if (mode === "topic") {
        if (currentTopic) startGame("topic", currentTopic.items[0].answer.length, { topic: currentTopic });
        else openTopicPicker();
      } else if (mode === "multiplayer") {
        if (window.WU.openMultiplayer) window.WU.openMultiplayer();
      } else {
        switchLength(mode, settings.length);
      }
      if (el.blur) el.blur();
      return;
    }
    if ((el = tg.closest("[data-open]"))) { openModal(el.getAttribute("data-open")); return; }
    if ((el = tg.closest("[data-close]"))) {
      var m = document.getElementById(el.getAttribute("data-close"));
      if (m) m.classList.remove("show");
      if (deviceKbd) focusTyper();
      return;
    }
    if ((el = tg.closest("[data-seg]"))) { onSeg(el.getAttribute("data-seg"), el.getAttribute("data-val")); el.blur(); return; }
    if (tg.classList.contains("overlay")) tg.classList.remove("show");
  });

  document.addEventListener("keydown", function (e) {
    if (document.querySelector(".overlay.show")) { if (e.key === "Escape") closeAll(); return; }
    if (typer && document.activeElement === typer) return;
    var ae = document.activeElement;
    if (ae && ae.tagName === "INPUT") return;
    if (ae && ae !== document.body && typeof ae.blur === "function" &&
      (ae.tagName === "BUTTON" || ae.classList.contains("tab") || ae.classList.contains("key") ||
        ae.classList.contains("ibtn") || ae.classList.contains("cbtn") || ae.classList.contains("icon"))) {
      if (e.key === "Enter" || e.key === "Backspace" || /^[a-zA-Z]$/.test(e.key)) { e.preventDefault(); ae.blur(); }
    }
    if (e.key === "Enter") handleKey("ENTER");
    else if (e.key === "Backspace") handleKey("BACK");
    else { var k = e.key.toUpperCase(); if (/^[A-Z]$/.test(k)) handleKey(k); }
  });

  if (typer) { typer.addEventListener("input", onTyperInput); typer.addEventListener("keydown", onTyperKey); resetTyper(); }
  var chWordEl = document.getElementById("chWord");
  if (chWordEl) {
    chWordEl.addEventListener("input", function () {
      var L = chWordEl.value.trim().length;
      if (L >= 3 && L <= 7) loadExtended(L);
    });
    chWordEl.addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); makeLink(); } });
  }

  var _lastW = window.innerWidth, _lastH = window.innerHeight;
  window.addEventListener("resize", function () {
    if (deviceKbd || immersive) { applyVV(); return; }
    if (Math.abs(window.innerWidth - _lastW) > 40 || Math.abs(window.innerHeight - _lastH) > 40) {
      _lastW = window.innerWidth; _lastH = window.innerHeight; relock();
    }
  });
  window.addEventListener("orientationchange", function () { _lastW = window.innerWidth; setTimeout(relock, 300); });
  if (vv) {
    vv.addEventListener("resize", function () { if (deviceKbd || immersive) applyVV(); });
    vv.addEventListener("scroll", function () { if (deviceKbd) applyVV(); });
  }
  document.addEventListener("fullscreenchange", onFsChange);
  document.addEventListener("webkitfullscreenchange", onFsChange);

  ["keydown", "pointerdown", "touchstart", "scroll"].forEach(function (ev) {
    window.addEventListener(ev, armExtended, { once: true, passive: true });
  });

  /* ===================== mode switching ===================== */
  function newGame() {
    challengeNotice = null;
    if (game.mode === "topic") {
      if (game.topic) { startGame("topic", game.topic.items[0].answer.length, { topic: game.topic }); return; }
      openTopicPicker(); return;
    }
    switchLength(game.mode === "challenge" || game.mode === "daily" ? "unlimited" : game.mode, settings.length);
  }
  function switchLength(mode, len) {
    loadCore(len).then(function () { startGame(mode, len); });
  }
  function onSeg(n, v) {
    if (n === "theme") { settings.theme = v; saveSettings(); applyTheme(); updateSeg(); }
    else if (n === "length") {
      settings.length = parseInt(v, 10);
      saveSettings();
      challengeNotice = null;
      switchLength(game.mode === "challenge" || game.mode === "topic" ? "unlimited" : game.mode, settings.length);
    } else if (n === "duration") {
      settings.timeDur = parseInt(v, 10);
      saveSettings();
      if (game.mode === "time") startGame("time", settings.length);
      else updateSeg();
    }
  }

  function bindSettings() {
    var h = document.getElementById("setHard");
    if (h) { h.checked = settings.hard; h.onchange = function () { settings.hard = h.checked; saveSettings(); }; }
    var hi = document.getElementById("setHints");
    if (hi) {
      hi.checked = settings.hints;
      hi.onchange = function () { settings.hints = hi.checked; saveSettings(); if (game && game.status !== "pending") renderControls(); };
    }
    var c = document.getElementById("setContrast");
    if (c) {
      c.checked = settings.contrast;
      c.onchange = function () { settings.contrast = c.checked; saveSettings(); applyTheme(); renderBoard(); renderKeyboard(); };
    }
    var s = document.getElementById("setSound");
    if (s) { s.checked = settings.sound; s.onchange = function () { settings.sound = s.checked; saveSettings(); if (settings.sound) sKey(); }; }
  }

  /* ===================== public surface ===================== */
  window.WU = window.WU || {};
  Object.assign(window.WU, {
    cfg: CFG, icons: ICON, t: t, esc: esc, toast: toast,
    lsGet: lsGet, lsSet: lsSet, K: K,
    openModal: openModal, closeAll: closeAll,
    settings: settings, saveSettings: saveSettings,
    getProfile: getProfile, saveProfile: saveProfile, levelInfo: levelInfo, badgeSVG: badgeSVG,
    shareRow: shareRow, copyText: copyText, fmtTime: fmtTime,
    evaluate: evaluate,
    actions: {},
    startTopic: chooseTopic,
    openTopicPicker: openTopicPicker,
    startGame: function (mode) { switchLength(mode, settings.length); },
    /** Hands the board over to another controller (multiplayer). */
    suspend: function () { clearTimers(); if (endwrap) endwrap.classList.remove("show"); },
    resume: function () { switchLength("unlimited", settings.length); },
    els: { root: root, app: appEl, board: board, kb: kbEl, controls: controls, banner: bannerEl, hint: hintEl, endwrap: endwrap, endcard: endcard },
    sizeBoard: sizeBoardSoon,
  });

  // Must be defineProperty, not part of the object literal above: Object.assign
  // invokes getters on the source and copies the resulting value, which would
  // pin WU.game to whatever it was at load time (null).
  Object.defineProperty(window.WU, "game", { get: function () { return game; }, configurable: true });

  /* ===================== boot ===================== */
  var ml = document.getElementById("mlIcon");
  if (ml) ml.innerHTML = ICON.target;
  document.querySelectorAll(".x").forEach(function (x) { x.innerHTML = ICON.close; });
  var bs = document.getElementById("brandSlot");
  if (bs) bs.innerHTML = brandTiles();
  var kb = document.getElementById("kbdBtn");
  if (kb && !IS_TOUCH) kb.style.display = "none";

  applyTheme(); updateFsIcon(); bindSettings(); updateRegions(); notifyParent(); applyVV(); updateStatsIcon();

  var _rawCh = readChallengeRaw();
  var _bootLen = _rawCh ? _rawCh.len : settings.length;
  var _roomParam = new URLSearchParams(location.search).get("room");
  // Topic landing pages (/topics/<slug>/) declare which pack to open with.
  var _bootTopic = typeof window.WU_TOPIC === "string" ? window.WU_TOPIC : null;

  loadCore(_bootLen).then(function () {
    var ch = readChallenge();
    if (ch) {
      var done = getChallengeResult(ch.enc);
      if (done) {
        challengeNotice = { r: done, word: ch.word, by: ch.by };
        clearPendingChallenge();
        loadCore(settings.length).then(function () { startGame("unlimited", settings.length); });
      } else {
        savePendingChallenge(ch);
        challengeInfo = ch;
        startGame("challenge", ch.word.length);
      }
    } else if (_bootTopic) {
      // Show a playable board immediately, then swap to the topic once its
      // answers arrive — the page should never sit empty while we fetch.
      startGame("unlimited", settings.length);
      chooseTopic(_bootTopic);
    } else {
      if (_bootLen !== settings.length) loadCore(settings.length);
      var pend = loadPendingChallenge();
      if (pend) { challengeInfo = pend; startGame("challenge", pend.word.length); }
      else startGame("unlimited", settings.length);
    }

    if (!lsGet(K("seen_howto"), false) && !_roomParam && !_bootTopic) {
      openModal("howtoModal");
      lsSet(K("seen_howto"), true);
    }
    sizeBoardSoon();
    setTimeout(sizeBoard, 60);
    window.addEventListener("load", sizeBoard);

    // A ?room= link should drop straight into multiplayer once it has loaded.
    if (_roomParam) {
      document.addEventListener("wu:multiplayer-ready", function () {
        if (window.WU.joinRoom) window.WU.joinRoom(_roomParam);
      }, { once: true });
    }
  });
})();
