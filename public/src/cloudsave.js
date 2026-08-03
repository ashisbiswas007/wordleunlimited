/* Wordle Unlimited — cloud save to the player's own Google Drive.
   Uses the drive.appdata scope, which gives access ONLY to a hidden folder
   this app owns. We cannot see, and never request, the user's real files. */
(function () {
  "use strict";

  var WU = window.WU;
  if (!WU) return;

  var FILE_NAME = "wordle-save.json";
  var GIS_SRC = "https://accounts.google.com/gsi/client";
  var SCOPE = "https://www.googleapis.com/auth/drive.appdata";
  var SAVE_DEBOUNCE_MS = 4000;

  var clientId = null, tokenClient = null, token = null, tokenExpiry = 0;
  var fileId = null, busy = false, saveTimer = null, lastSyncAt = 0;
  var rows = ["cloudRow"];
  function eachRow(fn){ rows.forEach(function(id){ var el=document.getElementById(id); if(el) fn(el); }); }

  function status(text, sub) {
    lastStatus = { text: text, sub: sub || "" };
    eachRow(function (row) {
      row.innerHTML =
      '<div class="label"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" ' +
      'stroke-linecap="round" stroke-linejoin="round" class="lblico"><path d="M18 10h-1.3A7 7 0 1 0 6 16h12a4 4 0 0 0 0-8z"/></svg>Cloud save</div>' +
      '<div class="desc" style="margin:4px 0 8px">' + text + "</div>" + (sub || "");
      row.style.display = "";
    });
  }
  var lastStatus = null;

  function signedOutUI() {
    status(
      "Sign in with Google to keep your stats, level and settings across devices. " +
        "We only get a private folder in your Drive — never your files.",
      '<button class="cbtn" data-act="cloudin">Sign in with Google</button>'
    );
  }

  function signedInUI() {
    var when = lastSyncAt ? new Date(lastSyncAt).toLocaleTimeString() : "not yet";
    status(
      "Your progress is syncing to Google Drive. Last saved: " + when + ".",
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="cbtn ghost" data-act="cloudsync">Sync now</button>' +
        '<button class="cbtn ghost" data-act="cloudout">Sign out</button></div>'
    );
  }

  /* ---------- the save payload ---------- */
  function collect() {
    var out = { v: 1, at: Date.now(), settings: WU.lsGet("wu_settings", {}), keys: {} };
    // Everything this site owns is namespaced, so a prefix sweep is exact.
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf("wu_") !== 0) continue;
      if (k === "wu_settings") continue;
      if (k.indexOf("pending_ch") > -1) continue; // transient, do not sync
      try { out.keys[k] = JSON.parse(localStorage.getItem(k)); } catch (e) {}
    }
    return out;
  }

  /**
   * Merge remote into local. Stats are additive counters, so taking the higher
   * value per field avoids a device with stale data wiping a good streak.
   */
  function merge(remote) {
    if (!remote || typeof remote !== "object") return;

    if (remote.settings && typeof remote.settings === "object") {
      var local = WU.lsGet("wu_settings", {});
      WU.lsSet("wu_settings", Object.assign({}, remote.settings, local));
    }

    Object.keys(remote.keys || {}).forEach(function (k) {
      var incoming = remote.keys[k];
      var current = WU.lsGet(k, null);
      if (current == null) { WU.lsSet(k, incoming); return; }

      if (k.indexOf("profile") > -1 && incoming && current) {
        WU.lsSet(k, {
          wins: Math.max(current.wins || 0, incoming.wins || 0),
          played: Math.max(current.played || 0, incoming.played || 0),
          since: Math.min(current.since || Date.now(), incoming.since || Date.now()),
          seen: Math.max(current.seen || 1, incoming.seen || 1),
        });
        return;
      }

      if (k.indexOf("stats_") > -1 && incoming && current) {
        var dist = (current.dist || []).map(function (v, i) {
          return Math.max(v || 0, (incoming.dist || [])[i] || 0);
        });
        WU.lsSet(k, {
          played: Math.max(current.played || 0, incoming.played || 0),
          wins: Math.max(current.wins || 0, incoming.wins || 0),
          cur: Math.max(current.cur || 0, incoming.cur || 0),
          max: Math.max(current.max || 0, incoming.max || 0),
          lastWin: Math.max(current.lastWin || 0, incoming.lastWin || 0) || null,
          dist: dist,
        });
        return;
      }

      if (k.indexOf("timebest_") > -1 && incoming && current) {
        WU.lsSet(k, { score: Math.max(current.score || 0, incoming.score || 0) });
        return;
      }

      // Anything else: newest wins.
      if ((remote.at || 0) > (lastSyncAt || 0)) WU.lsSet(k, incoming);
    });
  }

  /* ---------- Drive REST ---------- */
  function authHeaders() { return { Authorization: "Bearer " + token }; }

  function findFile() {
    if (fileId) return Promise.resolve(fileId);
    return fetch(
      "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&fields=files(id,name)&q=" +
        encodeURIComponent("name='" + FILE_NAME + "'"),
      { headers: authHeaders() }
    )
      .then(function (r) { if (!r.ok) throw new Error("list " + r.status); return r.json(); })
      .then(function (j) {
        fileId = j.files && j.files.length ? j.files[0].id : null;
        return fileId;
      });
  }

  function download() {
    return findFile().then(function (id) {
      if (!id) return null;
      return fetch("https://www.googleapis.com/drive/v3/files/" + id + "?alt=media", {
        headers: authHeaders(),
      })
        .then(function (r) { if (!r.ok) throw new Error("get " + r.status); return r.json(); })
        .catch(function () { return null; });
    });
  }

  function upload(payload) {
    var body = JSON.stringify(payload);
    if (fileId) {
      return fetch(
        "https://www.googleapis.com/upload/drive/v3/files/" + fileId + "?uploadType=media",
        { method: "PATCH", headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()), body: body }
      ).then(function (r) { if (!r.ok) throw new Error("patch " + r.status); return r.json(); });
    }

    // Multipart create so metadata and content go in one request.
    var boundary = "wuboundary" + Date.now();
    var meta = { name: FILE_NAME, parents: ["appDataFolder"] };
    var multipart =
      "--" + boundary + "\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n" +
      JSON.stringify(meta) + "\r\n--" + boundary +
      "\r\nContent-Type: application/json\r\n\r\n" + body + "\r\n--" + boundary + "--";

    return fetch("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "multipart/related; boundary=" + boundary }, authHeaders()),
      body: multipart,
    })
      .then(function (r) { if (!r.ok) throw new Error("create " + r.status); return r.json(); })
      .then(function (j) { fileId = j.id; return j; });
  }

  /* ---------- sync ---------- */
  function sync(showToast) {
    if (!token || busy) return Promise.resolve();
    if (Date.now() > tokenExpiry) { requestToken(); return Promise.resolve(); }
    busy = true;

    return download()
      .then(function (remote) {
        if (remote) merge(remote);
        return upload(collect());
      })
      .then(function () {
        lastSyncAt = Date.now();
        WU.lsSet(WU.K("cloud_last"), lastSyncAt);
        signedInUI();
        if (showToast) WU.toast("Progress saved to Drive");
      })
      .catch(function (err) {
        if (/40[13]/.test(String(err.message))) { token = null; requestToken(); }
        else if (showToast) WU.toast("Could not reach Drive — try again");
      })
      .finally(function () { busy = false; });
  }

  function scheduleSave() {
    if (!token) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { sync(false); }, SAVE_DEBOUNCE_MS);
  }

  /* ---------- auth ---------- */
  function requestToken() {
    if (!tokenClient) return;
    tokenClient.requestAccessToken({ prompt: token ? "" : "consent" });
  }

  function initGis() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: function (resp) {
        if (resp.error || !resp.access_token) { signedOutUI(); return; }
        token = resp.access_token;
        // Google returns expires_in seconds; refresh a minute early.
        tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        WU.lsSet(WU.K("cloud_on"), true);
        signedInUI();
        sync(true);
      },
    });

    // Returning user who has already granted access: reconnect silently.
    if (WU.lsGet(WU.K("cloud_on"), false)) {
      lastSyncAt = WU.lsGet(WU.K("cloud_last"), 0);
      tokenClient.requestAccessToken({ prompt: "" });
    }
  }

  function loadGis() {
    if (document.querySelector('script[src="' + GIS_SRC + '"]')) { initGis(); return; }
    var s = document.createElement("script");
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = initGis;
    s.onerror = function () { eachRow(function (r) { r.style.display = "none"; }); };
    document.head.appendChild(s);
  }

  /* ---------- wiring ---------- */
  WU.actions.cloudin = function () { requestToken(); };
  WU.actions.cloudsync = function () { sync(true); };
  WU.actions.cloudout = function () {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token); } catch (e) {}
    }
    token = null; fileId = null; lastSyncAt = 0;
    WU.lsSet(WU.K("cloud_on"), false);
    signedOutUI();
    WU.toast("Signed out of Drive");
  };

  // The engine calls this whenever settings or the profile change.
  WU.onSave = scheduleSave;
  window.addEventListener("beforeunload", function () {
    if (token && saveTimer) { clearTimeout(saveTimer); sync(false); }
  });

  WU.renderCloudRow = function (id) {
    if (rows.indexOf(id) < 0) rows.push(id);
    if (lastStatus) status(lastStatus.text, lastStatus.sub);
  };

  fetch("/api/status")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.cloudSave || !j.googleClientId) {
        eachRow(function (r) { r.style.display = "none"; });
        return;
      }
      clientId = j.googleClientId;
      signedOutUI();
      loadGis();
    })
    .catch(function () { eachRow(function (r) { r.style.display = "none"; }); });
})();
