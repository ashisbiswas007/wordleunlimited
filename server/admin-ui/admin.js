/* Admin panel client. Talks only to /admin/api/*, which is gated by a signed
   session cookie — nothing here is trusted by the server. */
(function () {
  "use strict";

  var $ = function (id) { return document.getElementById(id); };
  var state = { settings: null, stats: null };

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function api(path, opts) {
    return fetch("/admin/api" + path, Object.assign({ credentials: "same-origin" }, opts || {}))
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok) throw Object.assign(new Error(j.message || j.error || r.status), { status: r.status, body: j });
          return j;
        });
      });
  }

  function post(path, body) {
    return api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body || {}),
    });
  }

  function notice(html, kind) {
    $("notice").innerHTML = html ? '<div class="msg ' + (kind || "ok") + '">' + html + "</div>" : "";
    if (html) setTimeout(function () { $("notice").innerHTML = ""; }, 6000);
  }

  /* ---------- auth ---------- */

  function showLogin(msg) {
    $("login").classList.remove("hidden");
    $("app").classList.add("hidden");
    if (msg) $("loginMsg").innerHTML = '<div class="msg err">' + esc(msg) + "</div>";
  }

  function showApp() {
    $("login").classList.add("hidden");
    $("app").classList.remove("hidden");
    loadAll();
  }

  $("loginForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("loginMsg").innerHTML = "";
    post("/login", { username: $("u").value, password: $("p").value })
      .then(function (res) {
        $("p").value = "";
        showApp();
        if (res.usingGeneratedPassword) {
          notice("You are still using the password generated at first boot. Change it under <b>Security</b>.", "warn");
        }
      })
      .catch(function (err) {
        showLogin(err.status === 401 ? "Wrong username or password." : err.message);
      });
  });

  $("logoutBtn").addEventListener("click", function () {
    post("/logout").finally(function () { location.reload(); });
  });
  $("refreshBtn").addEventListener("click", loadAll);

  /* ---------- tabs ---------- */

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      var tab = b.getAttribute("data-tab");
      document.querySelectorAll("[data-panel]").forEach(function (p) {
        p.classList.toggle("hidden", p.getAttribute("data-panel") !== tab);
      });
      if (tab === "topics") loadTopics();
      if (tab === "audit") loadAudit();
    });
  });

  /* ---------- toggles ---------- */

  function toggleRow(key, label, desc, checked) {
    return '<div class="toggle"><div><div class="t">' + esc(label) + "</div>" +
      '<div class="d">' + esc(desc) + "</div></div>" +
      '<label class="sw"><input type="checkbox" data-toggle="' + key + '"' +
      (checked ? " checked" : "") + "><span></span></label></div>";
  }

  var MODE_META = {
    daily: ["Daily", "One shared puzzle per day"],
    unlimited: ["Unlimited", "Endless play — the default mode"],
    time: ["Time", "Race against the clock"],
    topic: ["Topics", "Themed packs of names"],
    multiplayer: ["Versus", "Live rooms against other players"],
    challenge: ["Challenge a friend", "Shareable custom-word links"],
  };
  var FEATURE_META = {
    cloudSave: ["Cloud save", "Sign in with Google to sync progress to Drive"],
    sound: ["Sound", "Key and result sounds"],
    hints: ["Hints", "The bulb button that reveals letters"],
    hardMode: ["Hard mode", "Revealed letters must be reused"],
    kidsMode: ["Kid mode", "3-letter words from a filtered list"],
  };

  function renderToggles() {
    var s = state.settings;
    $("modeToggles").innerHTML = Object.keys(MODE_META)
      .map(function (k) { return toggleRow("modes." + k, MODE_META[k][0], MODE_META[k][1], s.modes[k]); })
      .join("");
    $("featureToggles").innerHTML = Object.keys(FEATURE_META)
      .map(function (k) { return toggleRow("features." + k, FEATURE_META[k][0], FEATURE_META[k][1], s.features[k]); })
      .join("");
    $("mpToggles").innerHTML =
      toggleRow("multiplayer.enabled", "Multiplayer enabled", "Master switch for all rooms", s.multiplayer.enabled) +
      toggleRow("multiplayer.allowCustomRooms", "Private rooms", "Let players create rooms and share a link", s.multiplayer.allowCustomRooms);

    document.querySelectorAll("[data-toggle]").forEach(function (el) {
      el.addEventListener("change", function () {
        var parts = el.getAttribute("data-toggle").split(".");
        var group = parts[0], key = parts[1];
        var value = Object.assign({}, state.settings[group]);
        value[key] = el.checked;
        el.disabled = true;
        post("/settings", { key: group, value: value })
          .then(function (r) { state.settings = r.settings; notice("Saved."); })
          .catch(function (err) { el.checked = !el.checked; notice(esc(err.message), "err"); })
          .finally(function () { el.disabled = false; });
      });
    });

    $("setMaint").checked = s.maintenance;
    $("maintMsg").value = s.maintenanceMessage || "";
    $("mpRooms").value = s.multiplayer.maxOpenRooms;
    $("mpPlayers").value = s.multiplayer.maxPlayersPerRoom;
    $("mpReveal").value = s.multiplayer.revealNextAtPercent;
    $("mpRound").value = s.multiplayer.roundSeconds;
    $("mpVote").value = s.multiplayer.voteSeconds;
    $("mpWords").value = s.multiplayer.wordsToWin;
    $("annOn").checked = s.announcement.enabled;
    $("annText").value = s.announcement.text || "";
    $("annHref").value = s.announcement.href || "";

    $("maintPill").textContent = s.maintenance ? "MAINTENANCE" : "live";
    $("maintPill").className = "pill " + (s.maintenance ? "bad" : "ok");
  }

  /* ---------- scripts & ads ---------- */

  var AD_SLOTS = [
    ["beforeGame", "Above the game", "Between the page header and the board"],
    ["afterGame", "Below the game", "Under the keyboard, before the article"],
    ["afterResult", "After a result", "Inside the win/lose card"],
    ["afterVersusStats", "After Versus scores", "On the multiplayer scoreboard"],
    ["inContent", "In the article", "Part way down the written content"],
  ];

  function renderCode() {
    var s = state.settings;
    $("headCode").value = s.inject.headScripts || "";
    $("footCode").value = s.inject.footScripts || "";
    $("adsOn").checked = Boolean(s.ads.enabled);

    $("adSlots").innerHTML = AD_SLOTS.map(function (p) {
      var k = p[0], slot = s.ads[k] || { enabled: false, html: "" };
      return '<div class="toggle"><div><div class="t">' + esc(p[1]) + "</div>" +
        '<div class="d">' + esc(p[2]) + "</div></div>" +
        '<label class="sw"><input type="checkbox" data-adon="' + k + '"' +
        (slot.enabled ? " checked" : "") + "><span></span></label></div>" +
        '<div class="field"><textarea data-adhtml="' + k + '" spellcheck="false" ' +
        'style="min-height:80px" placeholder="Ad code for this slot">' + esc(slot.html) + "</textarea></div>";
    }).join("");
  }

  $("saveCode").addEventListener("click", function () {
    post("/settings", { key: "inject", value: {
      headScripts: $("headCode").value, footScripts: $("footCode").value } })
      .then(function (r) { state.settings = r.settings; notice("Header and footer code saved. Reload the site to see it."); })
      .catch(function (err) { notice(esc(err.message), "err"); });
  });

  $("saveAds").addEventListener("click", function () {
    var value = { enabled: $("adsOn").checked };
    AD_SLOTS.forEach(function (p) {
      var k = p[0];
      value[k] = {
        enabled: document.querySelector('[data-adon="' + k + '"]').checked,
        html: document.querySelector('[data-adhtml="' + k + '"]').value,
      };
    });
    post("/settings", { key: "ads", value: value })
      .then(function (r) { state.settings = r.settings; notice("Ad slots saved."); })
      .catch(function (err) { notice(esc(err.message), "err"); });
  });

  $("setMaint").addEventListener("change", function () {
    var on = $("setMaint").checked;
    if (on && !confirm("Take the whole site offline for visitors?\n\n/admin will stay reachable so you can turn it back on.")) {
      $("setMaint").checked = false;
      return;
    }
    post("/maintenance", { enabled: on, message: $("maintMsg").value })
      .then(function () { return loadSettings(); })
      .then(function () { notice(on ? "Site is now in maintenance mode." : "Site is live again."); })
      .catch(function (err) { $("setMaint").checked = !on; notice(esc(err.message), "err"); });
  });

  $("saveMaint").addEventListener("click", function () {
    post("/settings", { key: "maintenanceMessage", value: $("maintMsg").value })
      .then(function () { notice("Message saved."); })
      .catch(function (err) { notice(esc(err.message), "err"); });
  });

  $("saveMp").addEventListener("click", function () {
    var v = Object.assign({}, state.settings.multiplayer, {
      maxOpenRooms: +$("mpRooms").value,
      maxPlayersPerRoom: +$("mpPlayers").value,
      revealNextAtPercent: +$("mpReveal").value,
      roundSeconds: +$("mpRound").value,
      voteSeconds: +$("mpVote").value,
      wordsToWin: +$("mpWords").value,
    });
    post("/settings", { key: "multiplayer", value: v })
      .then(function (r) { state.settings = r.settings; notice("Multiplayer settings saved. New rooms use them immediately."); })
      .catch(function (err) { notice(esc(err.message), "err"); });
  });

  $("saveAnn").addEventListener("click", function () {
    post("/settings", { key: "announcement", value: {
      enabled: $("annOn").checked, text: $("annText").value, href: $("annHref").value } })
      .then(function (r) { state.settings = r.settings; notice("Announcement saved."); })
      .catch(function (err) { notice(esc(err.message), "err"); });
  });

  /* ---------- overview ---------- */

  function renderStats() {
    var st = state.stats;
    $("dbPill").textContent = "db " + st.db;
    $("dbPill").className = "pill " + (st.db === "up" ? "ok" : st.db === "disabled" ? "" : "bad");

    $("statGrid").innerHTML = [
      ["Players online", st.multiplayer.players],
      ["Active rooms", st.multiplayer.rooms],
      ["Topics", st.topics.total],
      ["Matches played", st.matches],
      ["Memory", st.memoryMb + " MB"],
      ["Uptime", fmtUptime(st.uptimeSeconds)],
    ].map(function (p) {
      return '<div class="stat"><div class="n">' + esc(p[1]) + '</div><div class="l">' + esc(p[0]) + "</div></div>";
    }).join("");

    var rows = st.multiplayer.detail.map(function (r) {
      return "<tr><td>" + esc(r.label || r.code) + "</td><td>" + esc(r.kind) + "</td>" +
        "<td>" + esc(r.phase) + "</td><td>" + esc(r.topicName || "—") + "</td>" +
        '<td class="num">' + r.players + "/" + r.maxPlayers + "</td>" +
        '<td class="num">' + r.fillPercent + "%</td></tr>";
    }).join("");
    $("roomTable").querySelector("tbody").innerHTML =
      rows || '<tr><td colspan="6" style="color:var(--muted)">No rooms running.</td></tr>';

    $("wordTable").querySelector("tbody").innerHTML = Object.keys(st.words).map(function (region) {
      var r = st.words[region];
      return "<tr><td><b>" + esc(region) + "</b></td>" +
        [3, 4, 5, 6, 7].map(function (l) {
          return '<td class="num">' + r[l].answers.toLocaleString() +
            ' <span style="color:var(--muted)">/ ' + r[l].accepted.toLocaleString() + "</span></td>";
        }).join("") + "</tr>";
    }).join("");
  }

  function fmtUptime(s) {
    if (s < 60) return s + "s";
    if (s < 3600) return Math.floor(s / 60) + "m";
    if (s < 86400) return Math.floor(s / 3600) + "h";
    return Math.floor(s / 86400) + "d";
  }

  /* ---------- topics ---------- */

  function loadTopics() {
    api("/topics").then(function (j) {
      var rows = (j.topics || []).map(function (t) {
        return "<tr><td>" + esc(t.name) + "</td><td><code>" + esc(t.slug) + "</code></td>" +
          "<td>" + esc(t.category) + "</td><td>" + esc(t.region) + "</td>" +
          '<td class="num">' + t.item_count + "</td>" +
          '<td class="num">' + t.play_count + "</td>" +
          '<td><label class="sw"><input type="checkbox" data-tslug="' + esc(t.slug) + '" data-tfield="enabled"' +
          (t.enabled ? " checked" : "") + "><span></span></label></td>" +
          '<td><label class="sw"><input type="checkbox" data-tslug="' + esc(t.slug) + '" data-tfield="featured"' +
          (t.featured ? " checked" : "") + "><span></span></label></td>" +
          '<td><button class="ghost danger" data-tdel="' + esc(t.slug) + '" style="padding:6px 10px;font-size:12px">Delete</button></td></tr>';
      }).join("");
      $("topicTable").querySelector("tbody").innerHTML =
        rows || '<tr><td colspan="9" style="color:var(--muted)">No topics yet. Import some below.</td></tr>';

      document.querySelectorAll("[data-tslug]").forEach(function (el) {
        el.addEventListener("change", function () {
          var body = {};
          body[el.getAttribute("data-tfield")] = el.checked;
          api("/topics/" + encodeURIComponent(el.getAttribute("data-tslug")), {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
            .then(function () { notice("Topic updated."); })
            .catch(function (err) { el.checked = !el.checked; notice(esc(err.message), "err"); });
        });
      });

      document.querySelectorAll("[data-tdel]").forEach(function (el) {
        el.addEventListener("click", function () {
          var slug = el.getAttribute("data-tdel");
          if (!confirm('Delete the topic "' + slug + '" and all of its answers?')) return;
          api("/topics/" + encodeURIComponent(slug), { method: "DELETE" })
            .then(function () { notice("Topic deleted."); loadTopics(); })
            .catch(function (err) { notice(esc(err.message), "err"); });
        });
      });
    }).catch(function (err) { notice(esc(err.message), "err"); });
  }

  $("importBtn").addEventListener("click", function () {
    var raw = $("importBox").value.trim();
    if (!raw) return;
    var parsed;
    try { parsed = JSON.parse(raw); }
    catch (e) { $("importOut").textContent = "That is not valid JSON: " + e.message; return; }
    if (!Array.isArray(parsed)) { $("importOut").textContent = "Expected an array of topic packs."; return; }

    $("importBtn").disabled = true;
    $("importOut").textContent = "Importing…";
    post("/topics/import", parsed)
      .then(function (r) {
        $("importOut").textContent = "Imported " + r.imported + " pack(s)" +
          (r.failures.length ? ", " + r.failures.length + " failed" : "") + ".";
        if (r.failures.length) console.warn("import failures", r.failures);
        loadTopics();
      })
      .catch(function (err) { $("importOut").textContent = err.message; })
      .finally(function () { $("importBtn").disabled = false; });
  });

  /* ---------- audit ---------- */

  function loadAudit() {
    api("/audit").then(function (j) {
      var rows = (j.entries || []).map(function (e) {
        var d = "";
        try { d = JSON.stringify(e.detail); } catch (x) { d = ""; }
        if (d.length > 90) d = d.slice(0, 90) + "…";
        return "<tr><td>" + esc(new Date(e.created_at).toLocaleString()) + "</td>" +
          "<td>" + esc(e.actor) + "</td><td><code>" + esc(e.action) + "</code></td>" +
          "<td>" + esc(d) + "</td><td>" + esc(e.ip || "") + "</td></tr>";
      }).join("");
      $("auditTable").querySelector("tbody").innerHTML =
        rows || '<tr><td colspan="5" style="color:var(--muted)">Nothing logged yet.</td></tr>';
    }).catch(function (err) { notice(esc(err.message), "err"); });
  }

  /* ---------- password ---------- */

  $("pwForm").addEventListener("submit", function (e) {
    e.preventDefault();
    $("pwMsg").innerHTML = "";
    if ($("pwNew").value !== $("pwNew2").value) {
      $("pwMsg").innerHTML = '<div class="msg err">The two new passwords do not match.</div>';
      return;
    }
    post("/password", { currentPassword: $("pwCur").value, newPassword: $("pwNew").value })
      .then(function () {
        $("pwMsg").innerHTML = '<div class="msg ok">Password changed. Signing you out…</div>';
        setTimeout(function () { location.reload(); }, 1600);
      })
      .catch(function (err) {
        $("pwMsg").innerHTML = '<div class="msg err">' + esc(err.message) + "</div>";
      });
  });

  /* ---------- boot ---------- */

  function loadSettings() {
    return api("/settings").then(function (j) {
      state.settings = j.settings;
      renderToggles();
      renderCode();
    });
  }
  function loadStats() {
    return api("/stats").then(function (j) { state.stats = j; renderStats(); });
  }
  function loadAll() {
    return Promise.all([loadSettings(), loadStats()]).catch(function (err) {
      if (err.status === 401) showLogin();
      else notice(esc(err.message), "err");
    });
  }

  api("/me")
    .then(function () { showApp(); })
    .catch(function () {
      showLogin();
      api("/auth-status").then(function (s) {
        $("u").value = s.username || "admin";
        if (!s.configured) {
          $("loginMsg").innerHTML = '<div class="msg err">No admin password is configured. ' +
            "Set <code>ADMIN_PASSWORD</code> in the environment and redeploy.</div>";
        } else if (s.usingGeneratedPassword) {
          $("loginMsg").innerHTML = '<div class="msg warn">Use the password printed in the ' +
            "container logs at first boot, then change it under Security.</div>";
        }
      }).catch(function () {});
    });
})();
