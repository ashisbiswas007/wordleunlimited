/* Wordle Unlimited — live multiplayer client.
   The server holds the answers and scores every guess, so this file keeps its
   own board state rather than reusing the single-player engine's. */
(function () {
  "use strict";

  var WU = window.WU;
  if (!WU || !document.getElementById("mpModal")) return;

  var AVATARS = ["🦊","🐼","🐯","🦉","🐺","🦅","🐨","🐸","🦁","🐬","🦄","🐢","🦖","🐙","🦋","🐝","🦈","🐧","🦩","🐳"];
  var MAX_GUESSES = 6;

  var ws = null, conn = "idle";
  var me = null, room = null, board = null, standings = [], feed = [];
  var voteState = null, roundEndsAt = 0, tickTimer = null, reconnectTimer = null;
  var lastRooms = [], suggestedNick = "";
  var active = false;

  var els = {
    modal: document.getElementById("mpModal"),
    body: document.getElementById("mpBody"),
    banner: document.getElementById("banner"),
    controls: document.getElementById("controls"),
    grid: document.getElementById("board"),
    kb: document.getElementById("keyboard"),
    hint: document.getElementById("hintline"),
    endwrap: document.getElementById("endwrap"),
  };

  function t(k, a, b) { return WU.t(k, a, b); }
  function esc(s) { return WU.esc(s); }

  /* ---------- identity ---------- */
  function savedNick() { return WU.lsGet(WU.K("mp_nick"), ""); }
  function savedAvatar() {
    var a = WU.lsGet(WU.K("mp_avatar"), null);
    return Number.isInteger(a) ? a : Math.floor(Math.random() * AVATARS.length);
  }
  function setNick(n) { WU.lsSet(WU.K("mp_nick"), n); }
  function setAvatar(i) { WU.lsSet(WU.K("mp_avatar"), i); }

  /* ---------- socket ---------- */
  function wsUrl() {
    var proto = location.protocol === "https:" ? "wss:" : "ws:";
    return proto + "//" + location.host + "/ws";
  }

  function connect(onReady) {
    if (ws && (ws.readyState === 0 || ws.readyState === 1)) { if (onReady) onReady(); return; }
    conn = "connecting";
    renderLobby();

    try { ws = new WebSocket(wsUrl()); }
    catch (e) { conn = "error"; renderLobby(); return; }

    ws.onopen = function () { conn = "open"; if (onReady) onReady(); };
    ws.onmessage = function (ev) {
      var msg;
      try { msg = JSON.parse(ev.data); } catch (e) { return; }
      handle(msg);
    };
    ws.onclose = function () {
      conn = "closed";
      if (active) {
        // Mid-match drop: retry once shortly, the room is still there.
        clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(function () {
          if (active && room) connect(function () { send({ t: "join", room: room.code, nick: me ? me.nick : savedNick(), avatar: savedAvatar() }); });
        }, 1500);
      }
      renderLobby();
    };
    ws.onerror = function () { conn = "error"; };
  }

  function send(obj) {
    if (!ws || ws.readyState !== 1) return false;
    try { ws.send(JSON.stringify(obj)); return true; } catch (e) { return false; }
  }

  /* ---------- message handling ---------- */
  function handle(msg) {
    switch (msg.t) {
      case "hello":
        suggestedNick = msg.suggestedNick || "";
        lastRooms = msg.rooms || [];
        renderLobby();
        break;

      case "joined":
        me = msg.you;
        room = msg.room;
        standings = (msg.board && msg.board.players) || [];
        feed = msg.feed || [];
        voteState = msg.voteOptions ? { options: msg.voteOptions, tally: msg.tally || {}, picked: null } : null;
        active = true;
        setNick(me.nick);
        takeOverBoard();
        WU.closeAll();
        renderAll();
        break;

      case "left":
        leave(false);
        break;

      case "lobby":
        roundEndsAt = msg.startsAt || 0;
        renderControls();
        break;

      case "lobby_hold":
        roundEndsAt = 0;
        renderControls();
        break;

      case "round_start":
        room.phase = "playing";
        room.topicName = msg.topicName;
        roundEndsAt = msg.endsAt;
        voteState = null;
        board = null;
        if (els.endwrap) els.endwrap.classList.remove("show");
        renderAll();
        break;

      case "word":
        board = {
          index: msg.index, length: msg.length, clue: msg.clue,
          rows: [], current: "", maxGuesses: msg.maxGuesses || MAX_GUESSES,
          total: msg.total, keys: {},
        };
        renderBoard(); renderKeyboard(); renderControls();
        break;

      case "result":
        applyResult(msg);
        break;

      case "reject":
        rejectGuess(msg.code);
        break;

      case "board":
        standings = msg.players || [];
        if (msg.endsAt) roundEndsAt = msg.endsAt;
        renderStandings();
        break;

      case "feed":
        feed.push(msg.entry);
        if (feed.length > 40) feed.shift();
        break;

      case "you_finished":
        WU.toast("You finished — " + msg.solved + " solved!");
        break;

      case "word_done":
        board = null;
        renderBoard();
        break;

      case "vote_open":
        room.phase = "voting";
        voteState = { options: msg.options || [], tally: {}, picked: null };
        roundEndsAt = msg.endsAt;
        renderAll();
        openPanel();
        break;

      case "vote_update":
        if (voteState) { voteState.tally = msg.tally || {}; renderPanel(); }
        break;

      case "vote_result":
        if (voteState && msg.choice) WU.toast("Next up: " + msg.choice.name);
        break;

      case "round_end":
        room.phase = "results";
        standings = msg.standings || [];
        showResults(msg);
        break;

      case "server_shutdown":
        WU.toast("Server restarting — rejoining shortly");
        break;

      case "error":
        onError(msg.code);
        break;
    }
  }

  function onError(code) {
    var map = {
      room_full: "That room just filled up.",
      all_rooms_full: "Every room is full right now — try again in a moment.",
      room_not_found: "That room no longer exists.",
      need_two_players: "You need at least two players to start.",
      too_many_connections: "Too many tabs open from this device.",
      disabled: "Multiplayer is switched off right now.",
      maintenance: "The site is in maintenance mode.",
    };
    WU.toast(map[code] || "Something went wrong.");
    if (code === "room_not_found" || code === "room_full" || code === "all_rooms_full") {
      active = false; room = null;
      refreshRooms(); openPanel();
    }
  }

  function rejectGuess(code) {
    var map = {
      not_in_list: t("notInList"),
      wrong_length: t("notEnough"),
      out_of_guesses: "No guesses left on this word.",
      not_playing: "The round is not running.",
    };
    WU.toast(map[code] || t("notInList"));
    shake();
  }

  function applyResult(msg) {
    if (!board) return;
    board.rows.push({ guess: msg.guess, pattern: msg.pattern });
    board.current = "";

    // Keyboard colouring, strongest state wins.
    var rank = { 0: 1, 1: 2, 2: 3 };
    for (var i = 0; i < msg.guess.length; i++) {
      var ch = msg.guess[i], st = msg.pattern[i];
      if (!(ch in board.keys) || rank[st] > rank[board.keys[ch]]) board.keys[ch] = st;
    }

    board.justRevealed = board.rows.length - 1;
    board.won = msg.correct;
    renderBoard(); renderKeyboard();

    if (msg.correct) {
      WU.toast("+" + (msg.points || 0));
    } else if (msg.failed && msg.answer) {
      WU.toast(t("wordWas", msg.answer));
    }
  }

  /* ---------- board takeover ---------- */
  function takeOverBoard() {
    WU.suspend();
    if (els.hint) { els.hint.style.display = "none"; els.hint.innerHTML = ""; }
    var clue = document.getElementById("tpClue");
    if (clue) clue.classList.remove("show");
    document.querySelectorAll(".tab").forEach(function (tb) {
      tb.classList.toggle("active", tb.getAttribute("data-mode") === "multiplayer");
    });
  }

  function leave(notifyServer) {
    if (notifyServer !== false) send({ t: "leave" });
    active = false; room = null; board = null; standings = []; voteState = null;
    clearInterval(tickTimer); tickTimer = null;
    if (els.banner) els.banner.innerHTML = "";
    try { if (ws) ws.close(); } catch (e) {}
    ws = null;
    WU.resume();
  }

  /* ---------- input ---------- */
  function key(k) {
    if (!active || !board) return;
    if (k === "ENTER") {
      if (board.current.length !== board.length) { WU.toast(t("notEnough")); shake(); return; }
      send({ t: "guess", g: board.current });
      return;
    }
    if (k === "BACK") { board.current = board.current.slice(0, -1); renderBoard(); return; }
    if (/^[A-Z]$/.test(k) && board.current.length < board.length) {
      board.current += k;
      renderBoard();
    }
  }

  function shake() {
    if (!board) return;
    board.shake = true;
    renderBoard();
  }

  // Intercept input while a match is running, before the core engine sees it.
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
    var ae = document.activeElement;
    if (ae && (ae.tagName === "INPUT" || ae.tagName === "TEXTAREA")) return;
    if (e.key === "Enter") { e.stopPropagation(); key("ENTER"); }
    else if (e.key === "Backspace") { e.stopPropagation(); key("BACK"); }
    else {
      var k = e.key.toUpperCase();
      if (/^[A-Z]$/.test(k)) { e.stopPropagation(); key(k); }
    }
  }, true);

  /* ---------- rendering: board ---------- */
  function renderBoard() {
    if (!els.grid) return;
    if (!board) { els.grid.innerHTML = ""; return; }

    var len = board.length, html = "", r, c;
    var cls = ["absent", "present", "correct"];

    for (r = 0; r < MAX_GUESSES; r++) {
      var letters = [], pat = null;
      if (r < board.rows.length) { letters = board.rows[r].guess.split(""); pat = board.rows[r].pattern; }
      else if (r === board.rows.length) letters = board.current.split("");

      var reveal = r === board.justRevealed;
      var win = board.won && r === board.rows.length - 1;

      html += '<div class="row' + (board.shake && r === board.rows.length ? " shake" : "") +
        '" style="grid-template-columns:repeat(' + len + ',var(--tile,52px))">';
      for (c = 0; c < len; c++) {
        var L = letters[c] || "", k = "tile";
        if (pat) k += " " + cls[pat[c]];
        else if (L) k += " filled";
        if (pat && reveal) k += " reveal";
        if (win) k += " win";
        var d = reveal || win ? ' style="animation-delay:' + c * 0.12 + 's"' : "";
        html += '<div class="' + k + '"' + d + ">" + L + "</div>";
      }
      html += "</div>";
    }
    els.grid.innerHTML = html;
    board.shake = false;
    board.justRevealed = -1;

    // Reuse the engine's tile sizing so a changing word length still fits.
    els.grid.style.setProperty("--tile", tileSize(len) + "px");
    els.grid.style.setProperty("--gap", "6px");
  }

  function tileSize(len) {
    var bw = els.grid.clientWidth || 380, bh = els.grid.clientHeight || 0, gap = 6;
    var sw = Math.floor((bw - (len - 1) * gap) / len);
    var sh = bh > 0 ? Math.floor((bh - 5 * gap) / 6) : sw;
    return Math.max(34, Math.min(66, Math.min(sw, sh)));
  }

  function renderKeyboard() {
    if (!els.kb) return;
    var cls = ["absent", "present", "correct"];
    var keys = (board && board.keys) || {};
    var html = "";
    [["Q","W","E","R","T","Y","U","I","O","P"],["A","S","D","F","G","H","J","K","L"],["ENTER","Z","X","C","V","B","N","M","BACK"]]
      .forEach(function (row) {
        html += '<div class="kb-row">';
        row.forEach(function (k) {
          var wide = k === "ENTER" || k === "BACK";
          var label = k === "BACK" ? WU.icons.back : k === "ENTER" ? t("enterKey") : k;
          var st = k in keys ? " " + cls[keys[k]] : "";
          html += '<button class="key' + (wide ? " wide" : "") + st + '" data-key="' + k + '">' + label + "</button>";
        });
        html += "</div>";
      });
    els.kb.innerHTML = html;
  }

  /* ---------- rendering: chrome ---------- */
  function secsLeft() { return roundEndsAt ? Math.max(0, Math.round((roundEndsAt - Date.now()) / 1000)) : 0; }

  function renderControls() {
    if (!els.controls || !room) return;
    var phase = room.phase;
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];

    var left = "";
    if (phase === "playing") {
      left = '<span class="ic">' + WU.icons.clock + '</span><b id="mpClock">' + WU.fmtTime(secsLeft()) + "</b>" +
        '<span class="dot">•</span>' + t("solvedLbl") + " <b>" + (mine ? mine.solved : 0) + "</b>" +
        (mine ? '<span class="dot">•</span>#<b>' + mine.rank + "</b>" : "");
    } else if (phase === "voting") {
      left = '<span class="ic">' + WU.icons.clock + '</span><b id="mpClock">' + WU.fmtTime(secsLeft()) + "</b>" +
        '<span class="dot">•</span>Voting';
    } else if (phase === "lobby") {
      left = roundEndsAt
        ? '<span class="ic">' + WU.icons.clock + '</span>Starting in <b id="mpClock">' + WU.fmtTime(secsLeft()) + "</b>"
        : "Waiting for players…";
    } else {
      left = "Round over";
    }

    els.controls.innerHTML =
      '<div class="tmode"><div class="tm-left"><div class="tm-info">' + left + "</div>" +
      '<div class="mp-note">' + esc(room.label || room.code) +
      (room.topicName ? " · " + esc(room.topicName) : "") + "</div></div>" +
      '<div class="tm-right">' +
      '<button class="ibtn" data-act="mppanel" title="Room">' + WU.icons.stats + "</button>" +
      '<button class="ibtn" data-act="mpleave" title="Leave room">' + WU.icons.close + "</button>" +
      "</div></div>";

    clearInterval(tickTimer);
    if (roundEndsAt) {
      tickTimer = setInterval(function () {
        var el = document.getElementById("mpClock");
        if (!el) { clearInterval(tickTimer); return; }
        el.textContent = WU.fmtTime(secsLeft());
      }, 1000);
    }
  }

  function renderStandings() {
    if (!els.banner || !active) return;
    var top = standings.slice(0, 3);
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];
    if (mine && mine.rank > 3) top.push(mine);

    if (!top.length) { els.banner.innerHTML = ""; return; }
    els.banner.innerHTML =
      '<div class="mp-board">' +
      top.map(function (p) {
        return '<div class="mp-p' + (me && p.id === me.id ? " me" : "") + '">' +
          '<span class="rk">' + p.rank + '</span>' +
          '<span class="av">' + AVATARS[p.avatar % AVATARS.length] + "</span>" +
          '<span class="nk">' + esc(p.nick) + "</span>" +
          '<span class="sc">' + p.solved + "</span></div>";
      }).join("") + "</div>";
    renderControls();
  }

  function renderAll() { renderStandings(); renderControls(); renderBoard(); renderKeyboard(); renderPanel(); }

  /* ---------- rendering: the room panel / lobby ---------- */
  function openPanel() { WU.openModal("mpModal"); renderPanel(); }

  function renderPanel() {
    if (!els.body) return;
    if (!active) { renderLobby(); return; }
    if (room.phase === "voting" && voteState) { renderVote(); return; }
    renderRoomPanel();
  }

  function renderLobby() {
    if (!els.body || active) return;
    var nick = savedNick() || suggestedNick;
    var av = savedAvatar();

    var h = '<div class="mp-wrap">';
    h += '<div class="mp-hero"><h3>Play live against other people</h3>' +
      '<p>Same words, same clock, live leaderboard. No account needed.</p></div>';

    h += '<div class="mp-me"><button class="mp-avatar" data-act="mpavatar" title="Change avatar">' +
      AVATARS[av % AVATARS.length] + "</button>" +
      '<input class="mp-nick" id="mpNick" maxlength="16" placeholder="Your nickname" value="' + esc(nick) + '">' +
      "</div>";

    if (conn === "connecting") h += '<div class="mp-note">Connecting…</div>';
    else if (conn === "error" || conn === "closed") h += '<div class="mp-note">Connection lost. <button class="cbtn ghost" data-act="mprefresh">Retry</button></div>';

    if (lastRooms.length) {
      h += '<div class="mp-hero"><span class="mp-live"><i></i>' +
        lastRooms.reduce(function (n, r) { return n + r.players; }, 0) + " playing now</span></div>";
      h += '<div class="mp-rooms">';
      lastRooms.forEach(function (r) {
        var full = r.players >= r.maxPlayers;
        h += '<button class="mp-room" data-mproom="' + esc(r.code) + '"' + (full ? " disabled" : "") + ">" +
          '<span style="flex:1;min-width:0"><span class="rn">' + esc(r.label || r.code) + "</span>" +
          '<span class="mp-fill"><i style="width:' + r.fillPercent + '%"></i></span>' +
          '<span class="rs">' + r.players + " / " + r.maxPlayers + " players" +
          (r.topicName ? " · " + esc(r.topicName) : "") + "</span></span>" +
          '<span class="mp-phase ' + esc(r.phase) + '">' + esc(r.phase) + "</span></button>";
      });
      h += "</div>";
    } else {
      h += '<div class="mp-note">No open rooms yet — join and one will start.</div>';
    }

    h += '<div class="mp-actions">' +
      '<button class="cbtn" data-act="mpquick">Quick play</button>' +
      '<button class="cbtn ghost" data-act="mpcreate">Create private room</button>' +
      '<button class="cbtn ghost" data-act="mpjoincode">Join by code</button>' +
      "</div>";
    h += "</div>";
    els.body.innerHTML = h;
  }

  function renderRoomPanel() {
    var h = '<div class="mp-wrap">';
    h += '<div class="mp-hero"><h3>' + esc(room.label || ("Room " + room.code)) + "</h3>" +
      '<p>' + room.players + " players · " + esc(room.format === "race" ? "First to " + room.wordsToWin : "Most words wins") +
      (room.topicName ? " · " + esc(room.topicName) : "") + "</p></div>";

    if (room.kind === "custom") {
      var url = location.origin + "/?room=" + room.code;
      h += '<div class="linkbox"><input readonly value="' + esc(url) + '">' +
        '<button class="cbtn ghost" data-copy="' + esc(url) + '">Copy</button></div>';
      if (room.phase === "lobby") {
        h += '<div class="mp-actions" style="margin-top:10px"><button class="cbtn" data-act="mpstart">Start now</button></div>';
      }
    }

    h += '<div class="mp-board">';
    standings.forEach(function (p) {
      h += '<div class="mp-p' + (me && p.id === me.id ? " me" : "") + '">' +
        '<span class="rk">' + p.rank + "</span>" +
        '<span class="av">' + AVATARS[p.avatar % AVATARS.length] + "</span>" +
        '<span class="nk">' + esc(p.nick) + "</span>" +
        '<span class="sc">' + p.solved + "</span></div>";
    });
    h += "</div>";

    if (feed.length) {
      h += '<div class="mp-feed">' + feed.slice(-8).reverse().map(function (f) {
        if (f.type === "solved") return "<div>" + esc(f.nick) + " solved word " + f.wordNumber + "</div>";
        if (f.type === "join") return "<div>" + esc(f.nick) + " joined</div>";
        if (f.type === "leave") return "<div>" + esc(f.nick) + " left</div>";
        return "";
      }).join("") + "</div>";
    }

    h += '<div class="mp-actions"><button class="cbtn ghost" data-act="mpleave">Leave room</button></div>';
    h += "</div>";
    els.body.innerHTML = h;
  }

  function renderVote() {
    var total = Object.keys(voteState.tally).reduce(function (n, k) { return n + voteState.tally[k]; }, 0) || 1;
    var h = '<div class="mp-wrap">';
    h += '<div class="mp-hero"><h3>Vote for the next round</h3>' +
      '<p class="mp-timer">' + WU.fmtTime(secsLeft()) + '</p></div>';
    h += '<div class="mp-vote">';
    voteState.options.forEach(function (o) {
      var n = voteState.tally[o.slug] || 0;
      var pct = Math.round((n / total) * 100);
      h += '<button class="mp-vopt' + (voteState.picked === o.slug ? " picked" : "") + '" data-mpvote="' + esc(o.slug) + '">' +
        '<span class="vbar" style="width:' + pct + '%"></span>' +
        '<span class="vn">' + esc(o.name) + "</span>" +
        '<span class="vc">' + n + " vote" + (n === 1 ? "" : "s") + "</span></button>";
    });
    h += "</div>";
    h += '<div class="mp-note">Most votes wins. A tie is decided at random.</div>';
    h += "</div>";
    els.body.innerHTML = h;
  }

  function showResults(msg) {
    var winner = standings[0];
    var mine = standings.filter(function (p) { return me && p.id === me.id; })[0];
    var title = winner && me && winner.id === me.id ? "You won the round!" : "Round over";
    var body = winner
      ? "<b>" + esc(winner.nick) + "</b> took it with " + winner.solved + " " +
        (winner.solved === 1 ? "word" : "words") + "." +
        (mine ? " You finished #" + mine.rank + " with " + mine.solved + "." : "")
      : "Nobody solved anything this round.";

    if (els.endwrap && document.getElementById("endcard")) {
      var sh = "I finished #" + (mine ? mine.rank : "?") + " in a live Wordle Unlimited room!";
      document.getElementById("endcard").innerHTML =
        '<div class="et">' + title + '</div><div class="em">' + body + "</div>" +
        WU.shareRow(sh, location.origin + "/") +
        '<div class="ebtns"><button class="ebtn primary" data-act="mppanel">Room &amp; next vote</button>' +
        '<button class="ebtn" data-act="mpleave">Leave</button></div>';
      els.endwrap.classList.add("show");
    }
    renderControls();
  }

  /* ---------- actions ---------- */
  function readNick() {
    var el = document.getElementById("mpNick");
    var n = el ? el.value.trim() : "";
    if (n) setNick(n);
    return n || savedNick() || suggestedNick;
  }

  function joinRoom(code) {
    var nick = readNick();
    var avatar = savedAvatar();
    connect(function () { send({ t: "join", room: code, nick: nick, avatar: avatar }); });
  }

  function refreshRooms() {
    fetch("/api/rooms")
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j) { lastRooms = j.rooms || []; renderLobby(); } })
      .catch(function () {});
  }

  function createRoom() {
    var body = {
      format: "race",
      maxPlayers: 8,
      wordsToWin: 10,
      length: WU.settings.length,
      region: WU.cfg.region,
      private: true,
    };
    fetch("/api/rooms", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (j) { joinRoom(j.code); })
      .catch(function () { WU.toast("Could not create a room right now."); });
  }

  WU.actions.mpquick = function () { joinRoom("quick"); };
  WU.actions.mpcreate = createRoom;
  WU.actions.mpleave = function () { if (els.endwrap) els.endwrap.classList.remove("show"); WU.closeAll(); leave(true); };
  WU.actions.mppanel = function () { if (els.endwrap) els.endwrap.classList.remove("show"); openPanel(); };
  WU.actions.mprefresh = function () { connect(); refreshRooms(); };
  WU.actions.mpstart = function () { send({ t: "start" }); };
  WU.actions.mpavatar = function (el) {
    var next = (savedAvatar() + 1) % AVATARS.length;
    setAvatar(next);
    el.textContent = AVATARS[next];
  };
  WU.actions.mpjoincode = function () {
    var code = prompt("Enter the room code:");
    if (code) joinRoom(String(code).trim().toUpperCase());
  };

  document.addEventListener("click", function (e) {
    var el = e.target.closest("[data-mproom]");
    if (el && !el.disabled) { joinRoom(el.getAttribute("data-mproom")); return; }
    var v = e.target.closest("[data-mpvote]");
    if (v && voteState) {
      voteState.picked = v.getAttribute("data-mpvote");
      send({ t: "vote", topic: voteState.picked });
      renderVote();
    }
  });

  /* ---------- entry points ---------- */
  WU.openMultiplayer = function () {
    if (active) { openPanel(); return; }
    openPanel();
    connect();
    refreshRooms();
  };
  WU.joinRoom = joinRoom;

  document.dispatchEvent(new CustomEvent("wu:multiplayer-ready"));
})();
