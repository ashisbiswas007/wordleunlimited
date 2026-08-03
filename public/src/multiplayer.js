(function () {
  "use strict";

  var WU = window.WU;
  if (!WU || !document.getElementById("mpModal")) return;

  var MAX_GUESSES = 6;
  var REJOIN_KEY = "mp_session";
  var BLOCK_KEY = "mp_blocked";

  var S = function (d) {
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  };

  var AV = [
    '<circle cx="12" cy="12" r="9"/><path d="M8 10h.01M16 10h.01M9 15c1.5 1.2 4.5 1.2 6 0"/>',
    '<path d="M4 20V8l8-5 8 5v12"/><path d="M9 20v-6h6v6"/>',
    '<path d="m12 3 2.6 6.3 6.8.5-5.2 4.4 1.6 6.6L12 17.3 6.2 20.8l1.6-6.6L2.6 9.8l6.8-.5z"/>',
    '<circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/>',
    '<path d="M12 21s-7-4.6-7-9.6A4.4 4.4 0 0 1 12 8a4.4 4.4 0 0 1 7 3.4c0 5-7 9.6-7 9.6z"/>',
    '<path d="M3 12h4l3-8 4 16 3-8h4"/>',
    '<rect x="3" y="3" width="7" height="7" rx="1.6"/><rect x="14" y="3" width="7" height="7" rx="1.6"/><rect x="3" y="14" width="7" height="7" rx="1.6"/><rect x="14" y="14" width="7" height="7" rx="1.6"/>',
    '<path d="M12 2 4 6v6c0 5 3.4 8.6 8 10 4.6-1.4 8-5 8-10V6z"/>',
    '<circle cx="12" cy="12" r="9"/><path d="m12 6 1.8 4.2 4.2.4-3.2 2.8 1 4.6L12 15.6 8.2 18l1-4.6L6 10.6l4.2-.4z"/>',
    '<path d="M5 20V9l7-6 7 6v11z"/><circle cx="12" cy="13" r="2.4"/>',
    '<path d="M6 4h12v6a6 6 0 0 1-12 0z"/><path d="M9 20h6M12 16v4"/><path d="M18 5h2a2 2 0 0 1 0 4h-2M6 5H4a2 2 0 0 0 0 4h2"/>',
    '<circle cx="12" cy="7" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
  ];
  function avatar(i, size) {
    var d = AV[(i | 0) % AV.length];
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
      '" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  }

  var CAT = {
    "movies & tv": '<path d="M3 5h18v14H3z"/><path d="M7 5v14M17 5v14M3 9h4M3 15h4M17 9h4M17 15h4"/>',
    brands: '<path d="M20.6 13.4 12 22l-9-9V3h10z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    nature: '<path d="M12 22V9"/><path d="M12 9a6 6 0 0 0-6-6c0 4 2 6 6 6z"/><path d="M12 9a6 6 0 0 1 6-6c0 4-2 6-6 6z"/>',
    geography: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18z"/>',
    sport: '<circle cx="12" cy="12" r="9"/><path d="m12 3 3 5-3 4-3-4z"/><path d="m4.5 9 5 1 1 5-4 2z"/><path d="m19.5 9-5 1-1 5 4 2z"/>',
    food: '<path d="M5 3v9a3 3 0 0 0 6 0V3"/><path d="M8 12v9"/><path d="M17 3c-1.5 3-2 5-2 8h4c0-3-.5-5-2-8z"/><path d="M17 11v10"/>',
    music: '<circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/><path d="M9 18V5l12-2v13"/>',
    gaming: '<rect x="2" y="7" width="20" height="11" rx="4"/><path d="M7 11v3M5.5 12.5h3M16 12h.01M18.5 14h.01"/>',
    science: '<path d="M9 3v6L4 19a2 2 0 0 0 2 3h12a2 2 0 0 0 2-3l-5-10V3"/><path d="M8 3h8"/>',
    history: '<path d="M3 21h18"/><path d="M5 21V9l7-5 7 5v12"/><path d="M9 21v-6h6v6"/>',
    everyday: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
    classic: '<path d="M16 3h5v5M21 3l-7 7M8 21H3v-5M3 21l7-7M16 21h5v-5M21 21l-7-7M8 3H3v5M3 3l7 7"/>',
  };
  function catIcon(c, size) {
    return '<svg viewBox="0 0 24 24" width="' + (size || 18) + '" height="' + (size || 18) +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' +
      (CAT[c] || CAT.classic) + "</svg>";
  }

  var ws = null, conn = "idle";
  var me = null, room = null, board = null, standings = [], players = [], feed = [];
  var voteState = null, phaseEndsAt = 0, skew = 0;
  var tick = null, reconnect = null, lastRooms = [], suggested = "", active = false;
  var view = "lobby", finished = false, topicsCache = null;
  // Set when the server deals us out of a round — either we did not ready up
  // or we arrived after it started. Spectators watch but cannot guess.
  var spectating = false;

  var els = {
    modal: document.getElementById("mpModal"),
    body: document.getElementById("mpBody"),
    banner: document.getElementById("banner"),
    controls: document.getElementById("controls"),
    grid: document.getElementById("board"),
    kb: document.getElementById("keyboard"),
    hint: document.getElementById("hintline"),
    endwrap: document.getElementById("endwrap"),
    live: document.getElementById("mpLive"),
  };

  function esc(s) { return WU.esc(s); }
  function t(k, a, b) { return WU.t(k, a, b); }
  function now() { return Date.now() + skew; }
  function left() { return phaseEndsAt ? Math.max(0, Math.round((phaseEndsAt - now()) / 1000)) : 0; }
  function clock(s) { var m = Math.floor(s / 60), x = s % 60; return m + ":" + (x < 10 ? "0" : "") + x; }

  function nick() { return WU.lsGet(WU.K("mp_nick"), ""); }
  function setNick(n) { WU.lsSet(WU.K("mp_nick"), n); }
  function av() { var a = WU.lsGet(WU.K("mp_avatar"), null); return Number.isInteger(a) ? a : (Math.random() * AV.length) | 0; }
  function setAv(i) { WU.lsSet(WU.K("mp_avatar"), i); }

  // Saved as soon as we are in a room. The match id only exists once a round
  // starts, so a refresh while still in the lobby has to rejoin on code alone.
  function saveSession() {
    if (!room || !room.code) return;
    WU.lsSet(WU.K(REJOIN_KEY), { code: room.code, matchId: room.matchId || null, at: Date.now() });
  }
  function clearSession() { WU.lsSet(WU.K(REJOIN_KEY), null); }
  function readSession() {
    var s = WU.lsGet(WU.K(REJOIN_KEY), null);
    // A lobby session has no match id yet, so the code alone is enough.
    if (!s || !s.code) return null;
    if (Date.now() - (s.at || 0) > 6 * 3600 * 1000) { clearSession(); return null; }
    return s;
  }
  function blockList() {
    var b = WU.lsGet(WU.K(BLOCK_KEY), {});
    var today = new Date().toISOString().slice(0, 10);
    if (b.day !== today) { b = { day: today, ids: [] }; WU.lsSet(WU.K(BLOCK_KEY), b); }
    return b;
  }
  function blockMatch(id) {
    var b = blockList();
    if (b.ids.indexOf(id) < 0) b.ids.push(id);
    WU.lsSet(WU.K(BLOCK_KEY), b);
  }
  function isBlocked(id) { return blockList().ids.indexOf(id) > -1; }

  function wsUrl() {
    return (location.protocol === "https:" ? "wss:" : "ws:") + "//" + location.host + "/ws";
  }

  function connect(onReady) {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (onReady) onReady(); return; }
    conn = "connecting";
    paint();
    try { ws = new WebSocket(wsUrl()); } catch (e) { conn = "error"; paint(); return; }

    ws.onopen = function () { conn = "open"; if (onReady) onReady(); };
    ws.onmessage = function (ev) {
      var m;
      try { m = JSON.parse(ev.data); } catch (e) { return; }
      handle(m);
    };
    ws.onclose = function () {
      conn = "closed";
      if (active && room) {
        clearTimeout(reconnect);
        reconnect = setTimeout(function () {
          connect(function () { send({ t: "join", room: room.code, matchId: room.matchId, nick: nick(), avatar: av() }); });
        }, 1500);
      }
      paint();
    };
    ws.onerror = function () { conn = "error"; };
  }

  function send(o) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(o)); return true; } catch (e) { return false; }
  }

  function syncClock(r) {
    if (r && r.serverNow) skew = r.serverNow - Date.now();
    if (r && r.endsAt) phaseEndsAt = r.endsAt;
  }

  function handle(m) {
    switch (m.t) {
      case "hello":
        suggested = m.suggestedNick || "";
        lastRooms = m.rooms || [];
        updateLive();
        paint();
        break;

      case "joined":
        me = m.you; room = m.room; players = m.playerList || [];
        standings = (m.board && m.board.players) || []; feed = m.feed || [];
        finished = false; active = true;
        syncClock(m.room);
        voteState = m.voteOptions ? { options: m.voteOptions, tally: m.tally || {}, picked: null } : null;
        if (voteState) preselectRandom();
        setNick(me.nick);
        saveSession();
        takeOver();
        // Straight to the board if a round is running; the room panel only
        // opens when there is actually something to do there.
        // Joining a running round still asks you to confirm you are ready, so
        // nobody is dropped mid-word without noticing.
        if (room.phase === "lobby" && room.kind === "custom") {
          view = "room";
          openPanel();
        } else if (room.kind === "custom") {
          // A round is already running; the server follows up with either a
          // word or a "spectating" message, which supplies its own explanation.
          view = "room";
          openPanel();
        } else {
          view = "board";
          WU.closeAll();
        }
        paintAll();
        break;

      case "room":
        room = m.room; players = m.players || m.playerList || players;
        syncClock(m.room);
        paintAll();
        break;

      case "lobby":
        if (m.room) { room = m.room; syncClock(m.room); }
        if (m.playerList) players = m.playerList;
        phaseEndsAt = m.startsAt || 0;
        view = room && room.kind === "custom" ? "room" : view;
        paintAll();
        break;

      case "lobby_hold":
        phaseEndsAt = 0; paintAll(); break;

      case "round_start":
        if (room) { room.phase = "playing"; room.topicName = m.topicName; room.matchId = m.matchId; room.round = m.round; }
        phaseEndsAt = m.endsAt; voteState = null; board = null; finished = false;
        // A "word" or "spectating" message follows immediately and settles this.
        spectating = false;
        saveSession();
        if (els.endwrap) els.endwrap.classList.remove("show");
        view = "board";
        WU.closeAll();
        paintAll();
        break;

      case "word":
        spectating = false;
        board = { index: m.index, length: m.length, clue: m.clue, rows: [], current: "",
                  max: m.maxGuesses || MAX_GUESSES, total: m.total, keys: {} };
        renderClue();
        renderBoard(); renderKeys(); renderControls();
        break;

      case "spectating":
        // Dealt out of this round — watch it, then ready up for the next one.
        spectating = true; board = null; finished = false;
        if (m.endsAt) phaseEndsAt = m.endsAt;
        renderClue();
        paintAll();
        WU.toast(m.reason === "round_in_progress"
          ? "Round already running — you are in for the next one"
          : "You did not ready up, so you are watching this round");
        break;

      case "result": applyResult(m); break;

      case "reject": {
        var msg = { not_in_list: t("notInList"), wrong_length: t("notEnough"),
                    out_of_guesses: "No guesses left on this word.", not_playing: "The round is not running.",
                    spectating: "You are watching this round — ready up for the next one." };
        WU.toast(msg[m.code] || t("notInList"));
        if (board) { board.shake = true; renderBoard(); }
        break;
      }

      case "board":
        standings = m.players || [];
        if (m.endsAt) phaseEndsAt = m.endsAt;
        renderStandings(); renderControls();
        if (view === "room" || view === "results") paint();
        break;

      case "feed":
        feed.push(m.entry);
        if (feed.length > 40) feed.shift();
        if (view === "room") paint();
        break;

      case "you_finished":
        finished = true;
        if (m.endsAt) phaseEndsAt = m.endsAt;
        renderControls(); renderBoard();
        WU.toast("All words cleared — waiting for the round to end");
        break;

      case "word_done":
        finished = true; board = null; renderBoard(); renderControls(); break;

      case "round_end":
        if (room) room.phase = "results";
        spectating = false;
        standings = m.standings || [];
        phaseEndsAt = m.endsAt || 0;
        voteState = (m.voteOptions && m.voteOptions.length)
          ? { options: m.voteOptions, tally: m.tally || {}, picked: null } : null;
        if (voteState) preselectRandom();
        pushRecord(m);
        view = "results";
        openPanel();
        paintAll();
        break;

      case "vote_open":
        voteState = { options: m.options || [], tally: {}, picked: null };
        preselectRandom();
        phaseEndsAt = m.endsAt; view = "results"; openPanel(); paintAll();
        break;

      case "vote_update":
        if (voteState) { voteState.tally = m.tally || {}; if (view === "results") paint(); }
        break;

      case "vote_result":
        if (m.choice) WU.toast("Next round: " + m.choice.name);
        break;

      case "kicked":
        blockMatch(m.matchId || (room && room.matchId));
        clearSession();
        WU.toast("You were removed from this room");
        leave(false);
        break;

      case "match_gone":
        clearSession();
        break;

      case "error": onError(m.code); break;
    }
  }

  function preselectRandom() {
    if (!voteState) return;
    var r = voteState.options.filter(function (o) { return o.slug === "__random__"; })[0];
    if (r && !voteState.picked) { voteState.picked = r.slug; send({ t: "vote", topic: r.slug }); }
  }

  function pushRecord(m) {
    if (!me) return;
    var mine = (m.standings || []).filter(function (p) { return p.id === me.id; })[0];
    if (!mine || !mine.solved) return;
    var pr = WU.getProfile();
    pr.played++;
    pr.wins += mine.solved;
    WU.saveProfile(pr);
  }

  function onError(code) {
    var map = {
      room_full: "That room just filled up.",
      all_rooms_full: "Every room is full right now.",
      room_not_found: "That room no longer exists.",
      need_two_players: "You need at least two players.",
      not_all_ready: "Everyone has to be ready first.",
      not_host: "Only the host can do that.",
      too_many_connections: "Too many tabs open from this device.",
      disabled: "Multiplayer is switched off right now.",
    };
    WU.toast(map[code] || "Something went wrong.");
    if (code === "room_not_found" || code === "room_full" || code === "all_rooms_full") {
      clearSession(); active = false; room = null; view = "lobby";
      refreshRooms(); openPanel(); paint();
    }
  }

  function applyResult(m) {
    if (!board) return;
    board.rows.push({ guess: m.guess, pattern: m.pattern });
    board.current = "";
    var rank = { 0: 1, 1: 2, 2: 3 };
    for (var i = 0; i < m.guess.length; i++) {
      var ch = m.guess[i], st = m.pattern[i];
      if (!(ch in board.keys) || rank[st] > rank[board.keys[ch]]) board.keys[ch] = st;
    }
    board.reveal = board.rows.length - 1;
    board.won = m.correct;
    renderBoard(); renderKeys();
    if (m.correct) WU.toast("+" + (m.points || 0));
    else if (m.failed && m.answer) WU.toast(t("wordWas", m.answer));
  }

  function takeOver() {
    WU.suspend();
    if (els.hint) { els.hint.classList.remove("on"); els.hint.innerHTML = ""; }
    renderClue();
    document.querySelectorAll(".tab").forEach(function (b) {
      b.classList.toggle("active", b.getAttribute("data-mode") === "multiplayer");
    });
  }

  function leave(notify) {
    if (notify !== false) send({ t: "leave" });
    clearSession();
    active = false; room = null; board = null; standings = []; players = [];
    voteState = null; finished = false; spectating = false; view = "lobby";
    clearInterval(tick); tick = null;
    if (els.banner) els.banner.innerHTML = "";
    renderClue();
    try { if (ws) ws.close(); } catch (e) {}
    ws = null;
    WU.resume();
  }

  function key(k) {
    if (!active || !board || finished) return;
    if (k === "ENTER") {
      if (board.current.length !== board.length) { WU.toast(t("notEnough")); board.shake = true; renderBoard(); return; }
      send({ t: "guess", g: board.current });
      return;
    }
    if (k === "BACK") { board.current = board.current.slice(0, -1); renderBoard(); return; }
    if (/^[A-Z]$/.test(k) && board.current.length < board.length) { board.current += k; renderBoard(); }
  }

  document.addEventListener("click", function (e) {
    if (!active) return;
    var el = e.target.closest("[data-key]");
    if (!el) return;
    e.stopPropagation();
    key(el.getAttribute("data-key"));
    el.blur();
  }, true);

  document.addEventListener("keydown", function (e) {
    if (!active || !board) return;
    if (document.querySelector(".overlay.show")) return;
    var a = document.activeElement;
    if (a && (a.tagName === "INPUT" || a.tagName === "TEXTAREA" || a.tagName === "SELECT")) return;
    if (e.key === "Enter") { e.stopPropagation(); key("ENTER"); }
    else if (e.key === "Backspace") { e.stopPropagation(); key("BACK"); }
    else { var k = e.key.toUpperCase(); if (/^[A-Z]$/.test(k)) { e.stopPropagation(); key(k); } }
  }, true);

  function renderClue() {
    var el = document.getElementById("tpClue");
    if (!el) return;
    if (board && board.clue) {
      el.innerHTML = '<span class="hint-inner"></span>';
      // Same "Clue: …" wording as Topic mode; Versus was showing it bare.
      el.firstChild.textContent = t("tpClue", board.clue);
      el.classList.add("show");
    } else {
      el.classList.remove("show");
      el.innerHTML = "";
    }
  }

  function renderBoard() {
    if (!els.grid) return;
    if (!board) {
      if (spectating) {
        els.grid.innerHTML = '<div class="mp-wait">' +
          S('<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>') +
          "<b>Watching this round</b><span>Ready up in the room panel to play the next one</span></div>";
        return;
      }
      els.grid.innerHTML = finished
        ? '<div class="mp-wait">' + S('<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>') +
          "<b>All words cleared</b><span>Waiting for the round to finish</span></div>"
        : "";
      return;
    }
    var cls = ["absent", "present", "correct"], html = "";
    for (var r = 0; r < MAX_GUESSES; r++) {
      var letters = [], pat = null;
      if (r < board.rows.length) { letters = board.rows[r].guess.split(""); pat = board.rows[r].pattern; }
      else if (r === board.rows.length) letters = board.current.split("");
      var rev = r === board.reveal, win = board.won && r === board.rows.length - 1;
      html += '<div class="row' + (board.shake && r === board.rows.length ? " shake" : "") + '">';
      for (var c = 0; c < board.length; c++) {
        var L = letters[c] || "", k = "tile";
        if (pat) k += " " + cls[pat[c]];
        else if (L) k += " filled";
        if (pat && rev) k += " reveal";
        if (win) k += " win";
        html += '<div class="' + k + '"' + (rev || win ? ' style="animation-delay:' + c * 0.12 + 's"' : "") + ">" + L + "</div>";
      }
      html += "</div>";
    }
    els.grid.innerHTML = html;
    els.grid.style.setProperty("--len", board.length);
    board.shake = false; board.reveal = -1;
  }

  function renderKeys() {
    if (!els.kb) return;
    // No board means nothing to type into — a spectator gets no keyboard at all.
    if ((finished || spectating) && !board) { els.kb.innerHTML = ""; return; }
    var cls = ["absent", "present", "correct"], keys = (board && board.keys) || {}, html = "";
    [["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","BACK"]]
      .forEach(function (row) {
        html += '<div class="kb-row">';
        row.forEach(function (k) {
          var wide = k === "ENTER" || k === "BACK";
          var label = k === "BACK" ? WU.icons.back : k === "ENTER" ? t("enterKey") : k;
          html += '<button class="key' + (wide ? " wide" : "") + (k in keys ? " " + cls[keys[k]] : "") +
            '" data-key="' + k + '">' + label + "</button>";
        });
        html += "</div>";
      });
    els.kb.innerHTML = html;
  }

  function renderControls() {
    if (!els.controls || !room) return;
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];
    var lbl = "";
    if (room.phase === "playing" && spectating) {
      lbl = WU.icons.clock + '<b id="mpClock">' + clock(left()) + "</b>" +
        '<span class="dot">&bull;</span>Watching';
    } else if (room.phase === "playing") {
      lbl = WU.icons.clock + '<b id="mpClock">' + clock(left()) + "</b>" +
        '<span class="dot">&bull;</span>' + t("solvedLbl") + " <b>" + (mine ? mine.solved : 0) + "</b>" +
        (mine ? '<span class="dot">&bull;</span>#<b>' + mine.rank + "</b>" : "");
    } else if (room.phase === "results") {
      lbl = WU.icons.clock + "Next round in <b id=\"mpClock\">" + clock(left()) + "</b>";
    } else {
      lbl = phaseEndsAt
        ? WU.icons.clock + "Starting in <b id=\"mpClock\">" + clock(left()) + "</b>"
        : players.length < 2 ? "Waiting for players" : "Waiting for everyone to ready up";
    }
    els.controls.innerHTML =
      '<div class="tmode"><div class="tm-left"><div class="tm-info">' + lbl + "</div>" +
      '<div class="mp-note">' + esc(room.label || ("Room " + room.code)) +
      (room.topicName ? " &middot; " + esc(room.topicName) : "") + "</div></div>" +
      '<div class="tm-right">' +
      '<button class="ibtn" data-act="mppanel" title="Room">' + WU.icons.stats + "</button>" +
      '<button class="ibtn" data-act="mpleave" title="Leave">' + WU.icons.close + "</button></div></div>";

    clearInterval(tick);
    if (phaseEndsAt) {
      tick = setInterval(function () {
        var el = document.getElementById("mpClock");
        if (el) el.textContent = clock(left());
        var v = document.getElementById("mpVoteClock");
        if (v) v.textContent = clock(left());
        if (!el && !v) { clearInterval(tick); tick = null; }
      }, 1000);
    }
  }

  function renderStandings() {
    if (!els.banner || !active) return;
    var top = standings.slice(0, 3);
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];
    if (mine && mine.rank > 3) top.push(mine);
    if (!top.length) { els.banner.innerHTML = ""; return; }
    els.banner.innerHTML = '<div class="mp-board">' + top.map(function (p) {
      return '<div class="mp-p' + (me && p.id === me.id ? " me" : "") + (p.done ? " done" : "") + '">' +
        '<span class="rk">' + p.rank + '</span><span class="av">' + avatar(p.avatar, 15) + "</span>" +
        '<span class="nk">' + esc(p.nick) + "</span>" +
        '<span class="sc">' + p.solved + "</span></div>";
    }).join("") + "</div>";
  }

  function paintAll() { renderStandings(); renderControls(); renderBoard(); renderKeys(); paint(); }
  function openPanel() { WU.openModal("mpModal"); paint(); }

  function paint() {
    if (!els.body) return;
    // create is reachable before joining anything, so it comes first
    if (view === "create") return createView();
    if (!active) return lobbyView();
    if (view === "results") return resultsView();
    return roomView();
  }

  function lobbyView() {
    var n = nick() || suggested, a = av();
    var h = '<div class="mp-wrap"><div class="mp-hero"><h3>Play live</h3>' +
      "<p>Same words, same clock, live scoreboard. No account needed.</p></div>";

    h += '<div class="mp-me"><button class="mp-avatar" data-act="mpavatar" title="Change icon">' +
      avatar(a, 22) + '</button><input class="mp-nick" id="mpNick" maxlength="16" placeholder="Your name" value="' + esc(n) + '"></div>';

    if (conn === "connecting") h += '<div class="mp-note">Connecting&hellip;</div>';
    else if (conn === "error" || conn === "closed")
      h += '<div class="mp-note">Connection lost. <button class="cbtn ghost" data-act="mprefresh">Retry</button></div>';

    var online = lastRooms.reduce(function (s, r) { return s + r.players; }, 0);
    h += '<div class="mp-secttl"><span>Open rooms</span><span class="mp-live"><i></i>' + online + " online</span></div>";

    if (lastRooms.length) {
      h += '<div class="mp-rooms">';
      lastRooms.forEach(function (r) {
        var full = r.players >= r.maxPlayers;
        h += '<button class="mp-room" data-mproom="' + esc(r.code) + '"' + (full ? " disabled" : "") + ">" +
          '<span class="mp-room-ico">' + catIcon(r.topicName ? "classic" : "gaming", 20) + "</span>" +
          '<span class="mp-room-main"><span class="rn">' + esc(r.label || r.code) + "</span>" +
          '<span class="rs">' + esc(r.topicName || "Random words") + "</span>" +
          '<span class="mp-fill"><i style="width:' + r.fillPercent + '%"></i></span></span>' +
          '<span class="mp-room-side"><span class="mp-phase ' + esc(r.phase) + '">' +
          (r.phase === "playing" ? "Live" : r.phase === "results" ? "Voting" : "Open") + "</span>" +
          '<span class="mp-count">' + r.players + "/" + r.maxPlayers + "</span></span></button>";
      });
      h += "</div>";
    } else {
      h += '<div class="mp-note">No rooms yet &mdash; join and one starts.</div>';
    }

    h += '<div class="mp-actions"><button class="cbtn" data-act="mpquick">Quick play</button>' +
      '<button class="cbtn ghost" data-act="mpcreate">Create room</button>' +
      '<button class="cbtn ghost" data-act="mpjoincode">Join by code</button></div></div>';
    els.body.innerHTML = h;
  }

  function createView() {
    var h = '<div class="mp-wrap"><div class="mp-hero"><h3>Create a room</h3>' +
      "<p>Set it up, then share the link.</p></div>";

    h += '<div class="mp-form">';
    h += '<label class="mp-lab">Game type</label><div class="seg mp-seg" id="cmMode">' +
      '<button data-cm="mode" data-val="classic" class="active">Word game</button>' +
      '<button data-cm="mode" data-val="topic">Topic run</button></div>';

    h += '<div id="cmTopicWrap" class="mp-hidden"><label class="mp-lab">Topic</label>' +
      '<select class="mp-select" id="cmTopic"><option value="">Loading&hellip;</option></select></div>';

    h += '<div id="cmLenWrap"><label class="mp-lab">Word length</label><div class="seg mp-seg" id="cmLen">' +
      [3, 4, 5, 6, 7].map(function (l) {
        return '<button data-cm="length" data-val="' + l + '"' + (l === 5 ? ' class="active"' : "") + ">" + l + "</button>";
      }).join("") + "</div></div>";

    h += '<label class="mp-lab">Players</label><div class="seg mp-seg" id="cmPl">' +
      [2, 4, 6, 10, 20].map(function (p) {
        return '<button data-cm="maxPlayers" data-val="' + p + '"' + (p === 6 ? ' class="active"' : "") + ">" + p + "</button>";
      }).join("") + "</div>";

    h += '<label class="mp-lab">Round length</label><div class="seg mp-seg" id="cmDur">' +
      [[300, "5m"], [600, "10m"], [900, "15m"], [1200, "20m"], [1800, "30m"]].map(function (d) {
        return '<button data-cm="durationSeconds" data-val="' + d[0] + '"' + (d[0] === 600 ? ' class="active"' : "") + ">" + d[1] + "</button>";
      }).join("") + "</div>";
    h += "</div>";

    h += '<div class="mp-actions"><button class="cbtn" data-act="mpdocreate">Create room</button>' +
      '<button class="cbtn ghost" data-act="mpback">Back</button></div></div>';
    els.body.innerHTML = h;

    fetchTopics().then(function (list) {
      var sel = document.getElementById("cmTopic");
      if (!sel) return;
      sel.innerHTML = '<option value="">Random each round</option>' + list.map(function (x) {
        return '<option value="' + esc(x.slug) + '">' + esc(x.name) + " (" + x.count + ")</option>";
      }).join("");
    });
  }

  function roomView() {
    if (!room) return lobbyView();
    var url = location.origin + "/?room=" + room.code;
    var isHost = me && room.hostId === me.id;
    var meP = players.filter(function (p) { return me && p.id === me.id; })[0];
    // The host plays the round too, so they ready up like everyone else rather
    // than being counted ready automatically.
    var readyCount = players.filter(function (p) { return p.ready; }).length;
    var canStart = players.length >= 2 && readyCount === players.length;

    var h = '<div class="mp-wrap"><div class="mp-hero"><h3>' + esc(room.label || ("Room " + room.code)) + "</h3>" +
      '<p>' + esc(room.topicName || "Random words") + " &middot; " +
      Math.round(room.durationSeconds / 60) + " min &middot; " +
      players.length + "/" + room.maxPlayers + " players</p></div>";

    if (room.kind === "custom" && room.phase === "lobby") {
      h += '<div class="mp-share"><div class="mp-lab">Invite your friends</div>' +
        '<div class="mp-code"><span>' + esc(room.code) + "</span>" +
        '<button class="cbtn ghost" data-copy="' + esc(room.code) + '">Copy code</button>' +
        '<button class="cbtn" data-copy="' + esc(url) + '">Copy link</button></div></div>';
    }

    h += '<div class="mp-status">' + (room.phase !== "lobby"
      ? (spectating ? "Watching this round — ready up to play the next one" : "Round in progress")
      : players.length < 2
        ? "Waiting for one more player"
        : canStart
          ? "Everyone is ready — starting shortly"
          : readyCount + " of " + players.length + " ready") + "</div>";

    h += '<div class="mp-players">' + players.map(function (p) {
      // In a running round the meaningful state is who is actually playing;
      // in the lobby it is who has readied up.
      var ready = room.phase === "lobby" ? p.ready : p.playing;
      var label = room.phase === "lobby"
        ? (p.ready ? "Ready" : "Not ready")
        : (p.playing ? "Playing" : "Watching");
      return '<div class="mp-pl' + (ready ? " ready" : "") + '">' +
        '<span class="av">' + avatar(p.avatar, 16) + "</span>" +
        '<span class="nk">' + esc(p.nick) + (p.isHost ? ' <em class="host">host</em>' : "") +
        (me && p.id === me.id ? ' <em class="you">you</em>' : "") + "</span>" +
        '<span class="st">' + label + "</span>" +
        (isHost && !p.isHost ? '<button class="mp-kick" data-mpkick="' + esc(p.id) +
          '" title="Remove ' + esc(p.nick) + '" aria-label="Remove ' + esc(p.nick) + '">' +
          WU.icons.close + "</button>" : "") + "</div>";
    }).join("") + "</div>";

    if (room.phase === "lobby") {
      h += '<div class="mp-actions">';
      // Everyone readies up, host included — readying is what deals you into
      // the round, so the host skipping it would deal them out of their own match.
      h += '<button class="cbtn' + (meP && meP.ready ? " ghost" : "") + '" data-act="mpready">' +
        (meP && meP.ready ? "Cancel ready" : "Ready up") + "</button>";
      if (isHost) {
        h += '<button class="cbtn" data-act="mpstart"' + (canStart ? "" : " disabled") + ">" +
          (players.length < 2 ? "Need 2 players" : canStart ? "Start now" : "Waiting for ready") + "</button>";
      }
      h += "</div>";
      // Always a way out of this panel, even while nothing can be started.
      h += '<div class="mp-actions mp-actions-sub">' +
        '<button class="cbtn ghost" data-act="mpclose">Close</button>' +
        '<button class="cbtn ghost" data-act="mpleave">Leave room</button></div>';
    } else {
      h += '<div class="mp-actions"><button class="cbtn" data-act="mpclose">Back to game</button>' +
        '<button class="cbtn ghost" data-act="mpleave">Leave room</button></div>';
    }

    if (feed.length) {
      h += '<div class="mp-feed">' + feed.slice(-8).reverse().map(function (f) {
        if (f.type === "solved") return "<div>" + esc(f.nick) + " solved word " + f.wordNumber + "</div>";
        if (f.type === "join") return "<div>" + esc(f.nick) + " joined</div>";
        if (f.type === "leave") return "<div>" + esc(f.nick) + " left</div>";
        return "";
      }).join("") + "</div>";
    }
    h += "</div>";
    els.body.innerHTML = h;
  }

  function resultsView() {
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];
    var h = '<div class="mp-wrap"><div class="mp-scorehead"><h3>Scoreboard</h3>' +
      '<span class="mp-timer">' + WU.icons.clock + '<b id="mpVoteClock">' + clock(left()) + "</b></span></div>";

    h += '<div class="mp-score">' + (standings.length ? standings.map(function (p) {
      return '<div class="mp-sr' + (me && p.id === me.id ? " me" : "") + (p.rank === 1 ? " top" : "") + '">' +
        '<span class="rk">' + p.rank + "</span>" +
        '<span class="av">' + avatar(p.avatar, 16) + "</span>" +
        '<span class="nk">' + esc(p.nick) + "</span>" +
        '<span class="sv">' + p.solved + "</span>" +
        '<span class="pt">' + p.points + "</span></div>";
    }).join("") : '<div class="mp-note">Nobody scored this round.</div>') + "</div>";

    h += '<div class="mp-scorekey"><span>#</span><span>Player</span><span>Solved</span><span>Points</span></div>';

    if (voteState && voteState.options.length) {
      var total = 0;
      for (var k in voteState.tally) total += voteState.tally[k];
      h += '<div class="mp-secttl"><span>Vote the next topic</span><span class="mp-note">' +
        total + " vote" + (total === 1 ? "" : "s") + "</span></div>";
      h += '<div class="mp-vote">' + voteState.options.map(function (o) {
        var n = voteState.tally[o.slug] || 0;
        var pct = total ? Math.round((n / total) * 100) : 0;
        return '<button class="mp-vopt' + (voteState.picked === o.slug ? " picked" : "") +
          '" data-mpvote="' + esc(o.slug) + '">' +
          '<span class="vbar" style="width:' + pct + '%"></span>' +
          '<span class="vico">' + catIcon(o.category, 18) + "</span>" +
          '<span class="vn">' + esc(o.name) + "</span>" +
          '<span class="vc">' + n + "</span></button>";
      }).join("") + "</div>";
    }
    h += '<div class="mp-actions"><button class="cbtn ghost" data-act="mpleave">Leave room</button></div></div>';
    els.body.innerHTML = h;
  }

  function fetchTopics() {
    if (topicsCache) return Promise.resolve(topicsCache);
    return fetch("/api/topics").then(function (r) { return r.ok ? r.json() : { topics: [] }; })
      .then(function (j) { topicsCache = j.topics || []; return topicsCache; })
      .catch(function () { return []; });
  }

  function readNick() {
    var el = document.getElementById("mpNick");
    var n = el ? el.value.trim() : "";
    if (n) setNick(n);
    return n || nick() || suggested;
  }

  function joinRoom(code, matchId) {
    var n = readNick(), a = av();
    connect(function () { send({ t: "join", room: code, matchId: matchId || null, nick: n, avatar: a }); });
  }

  function refreshRooms() {
    return fetch("/api/rooms").then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { lastRooms = j.rooms || []; updateLive(); if (!active) paint(); } })
      .catch(function () {});
  }

  function updateLive() {
    if (!els.live) return;
    var n = lastRooms.reduce(function (s, r) { return s + (r.players || 0); }, 0);
    if (active && room) n = Math.max(n, room.players || 0);
    if (n > 0) { els.live.innerHTML = "<i></i>" + n; els.live.classList.add("on"); }
    else { els.live.classList.remove("on"); els.live.textContent = ""; }
  }

  var poll = null;
  function startPoll() {
    stopPoll();
    poll = setInterval(function () { if (!document.hidden && !active) refreshRooms(); }, 20000);
  }
  function stopPoll() { if (poll) clearInterval(poll); poll = null; }
  document.addEventListener("visibilitychange", function () {
    if (document.hidden) stopPoll(); else { refreshRooms(); startPoll(); }
  });

  var draft = { mode: "classic", length: 5, maxPlayers: 6, durationSeconds: 600 };

  WU.actions.mpquick = function () { joinRoom("quick"); };
  WU.actions.mpcreate = function () { view = "create"; paint(); };
  WU.actions.mpback = function () { view = "lobby"; paint(); };
  WU.actions.mpclose = function () { WU.closeAll(); };
  WU.actions.mpleave = function () { if (els.endwrap) els.endwrap.classList.remove("show"); WU.closeAll(); leave(true); };
  WU.actions.mppanel = function () {
    if (els.endwrap) els.endwrap.classList.remove("show");
    view = room && room.phase === "results" ? "results" : "room";
    openPanel();
  };
  WU.actions.mprefresh = function () { connect(); refreshRooms(); };
  WU.actions.mpready = function () {
    var meP = players.filter(function (p) { return me && p.id === me.id; })[0];
    send({ t: "ready", ready: !(meP && meP.ready) });
  };
  WU.actions.mpstart = function () { send({ t: "start" }); };
  WU.actions.mpavatar = function (el) {
    var next = (av() + 1) % AV.length;
    setAv(next);
    el.innerHTML = avatar(next, 22);
  };
  WU.actions.mpjoincode = function () {
    var c = prompt("Room code:");
    if (c) joinRoom(String(c).trim().toUpperCase());
  };
  WU.actions.mpdocreate = function () {
    var body = {
      format: "race",
      maxPlayers: draft.maxPlayers,
      durationSeconds: draft.durationSeconds,
      region: WU.cfg.region,
      private: true,
    };
    if (draft.mode === "topic") {
      var sel = document.getElementById("cmTopic");
      if (sel && sel.value) body.topic = sel.value;
    } else {
      body.length = draft.length;
    }
    fetch("/api/rooms", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { joinRoom(j.code); })
      .catch(function () { WU.toast("Could not create a room."); });
  };

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-mproom]");
    if (el && !el.disabled) { joinRoom(el.getAttribute("data-mproom")); return; }

    var v = e.target.closest("[data-mpvote]");
    if (v && voteState) {
      voteState.picked = v.getAttribute("data-mpvote");
      send({ t: "vote", topic: voteState.picked });
      paint();
      return;
    }

    var kck = e.target.closest("[data-mpkick]");
    if (kck) { send({ t: "kick", playerId: kck.getAttribute("data-mpkick") }); return; }

    var cm = e.target.closest("[data-cm]");
    if (cm) {
      var f = cm.getAttribute("data-cm"), val = cm.getAttribute("data-val");
      draft[f] = f === "mode" ? val : parseInt(val, 10);
      cm.parentNode.querySelectorAll("button").forEach(function (b) { b.classList.toggle("active", b === cm); });
      if (f === "mode") {
        var tw = document.getElementById("cmTopicWrap"), lw = document.getElementById("cmLenWrap");
        if (tw) tw.classList.toggle("mp-hidden", val !== "topic");
        if (lw) lw.classList.toggle("mp-hidden", val === "topic");
      }
    }
  });

  WU.openMultiplayer = function () {
    if (!active) { view = "lobby"; connect(); refreshRooms(); }
    else view = room && room.phase === "results" ? "results" : "room";
    openPanel();
  };
  WU.joinRoom = joinRoom;

  refreshRooms();
  startPoll();

  // An invite link joins straight away and opens the board. Reading the param
  // here rather than waiting to be told avoids a load-order race with the
  // engine, which was why shared links did nothing.
  var param = new URLSearchParams(location.search).get("room");
  if (param) {
    var code = String(param).trim().toUpperCase();
    if (/^[A-Z0-9]{3,12}$/.test(code)) {
      if (!nick()) setNick(suggested || "Player" + (((Math.random() * 900) | 0) + 100));
      joinRoom(code);
      try {
        history.replaceState(null, "", location.pathname + location.hash);
      } catch (e) {}
    }
  } else {
    var sess = readSession();
    if (sess && !isBlocked(sess.matchId)) joinRoom(sess.code, sess.matchId);
  }

  document.dispatchEvent(new CustomEvent("wu:multiplayer-ready"));
})();
