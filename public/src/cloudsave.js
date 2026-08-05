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

  var GOOGLE_MARK =
    '<svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true">' +
    '<path fill="#4285F4" d="M23 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.2a5.3 5.3 0 0 1-2.3 3.5v2.9h3.7c2.2-2 3.4-5 3.4-8.6z"/>' +
    '<path fill="#34A853" d="M12 24c3.1 0 5.7-1 7.6-2.8l-3.7-2.9c-1 .7-2.3 1.1-3.9 1.1-3 0-5.5-2-6.4-4.7H1.8v3A12 12 0 0 0 12 24z"/>' +
    '<path fill="#FBBC05" d="M5.6 14.7a7.2 7.2 0 0 1 0-4.6v-3H1.8a12 12 0 0 0 0 10.6l3.8-3z"/>' +
    '<path fill="#EA4335" d="M12 4.8c1.7 0 3.2.6 4.4 1.7l3.3-3.3A11.6 11.6 0 0 0 12 0 12 12 0 0 0 1.8 6.1l3.8 3C6.5 6.7 9 4.8 12 4.8z"/></svg>';

  function signedOutUI() {
    status(
      "Sign in to keep your stats, level and settings on every device. We only get a " +
        "private folder in your Drive — never your files.",
      '<button class="cbtn gsi" data-act="cloudin">' + GOOGLE_MARK + "<span>Sign in with Google</span></button>"
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
    // Expired: refresh silently and let the callback resume the sync.
    if (Date.now() > tokenExpiry) { requestToken(false); return Promise.resolve(); }
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
        // Drive rejected the token: refresh silently, never escalate to a
        // consent screen the player did not ask for.
        if (/40[13]/.test(String(err.message))) { tokenExpiry = 0; requestToken(false); }
        else if (showToast) WU.toast("Could not reach Drive — try again");
      })
      .finally(function () { busy = false; });
  }

  function scheduleSave() {
    if (!token) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(function () { sync(false); }, SAVE_DEBOUNCE_MS);
  }

  // Background sync so progress is never more than a few minutes stale, even
  // if the player never changes a setting. Pauses on a hidden tab.
  var AUTO_SYNC_MS = 5 * 60 * 1000;
  var autoTimer = null;
  function startAutoSync() {
    stopAutoSync();
    autoTimer = setInterval(function () {
      if (document.hidden || !token || busy) return;
      if (Date.now() - lastSyncAt < AUTO_SYNC_MS) return;
      sync(false);
    }, 60 * 1000);
  }
  function stopAutoSync() { if (autoTimer) clearInterval(autoTimer); autoTimer = null; }
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && token && Date.now() - lastSyncAt > AUTO_SYNC_MS) sync(false);
  });

  /* ---------- auth ---------- */

  /**
   * One token request at a time, and never a popup the player did not ask for.
   *
   * Access tokens last an hour. The background sync ticks every minute, so
   * without a guard an expired token meant a fresh sign-in prompt every single
   * minute — and because a failed refresh cleared the token first, each one
   * escalated to a full consent screen. A returning player has already
   * consented, so a refresh is always silent; only a deliberate click on
   * "Sign in with Google" is allowed to prompt.
   */
  var authPending = false;
  var authInteractive = false;
  var authBlockedUntil = 0;
  var SILENT_RETRY_MS = 10 * 60 * 1000;

  function requestToken(interactive) {
    if (!tokenClient || authPending) return;
    if (!interactive && Date.now() < authBlockedUntil) return;
    var consented = WU.lsGet(WU.K("cloud_on"), false);
    authPending = true;
    authInteractive = Boolean(interactive);
    try {
      tokenClient.requestAccessToken({ prompt: interactive && !consented ? "consent" : "" });
    } catch (e) {
      authPending = false;
    }
  }

  function initGis() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: function (resp) {
        var wasInteractive = authInteractive;
        authPending = false;
        authInteractive = false;

        if (resp.error || !resp.access_token) {
          // A silent refresh can fail for reasons the player cannot act on —
          // an expired Google session, blocked third-party cookies. Back off
          // rather than letting the next sync tick reopen the popup.
          token = null;
          tokenExpiry = 0;
          if (!wasInteractive) authBlockedUntil = Date.now() + SILENT_RETRY_MS;
          signedOutUI();
          return;
        }

        token = resp.access_token;
        // Google returns expires_in seconds; refresh a minute early.
        tokenExpiry = Date.now() + (Number(resp.expires_in || 3600) - 60) * 1000;
        authBlockedUntil = 0;
        WU.lsSet(WU.K("cloud_on"), true);
        signedInUI();
        // Only announce a save the player actually initiated; a background
        // token refresh should be invisible.
        sync(wasInteractive);
        startAutoSync();
      },
    });

    // Returning user who has already granted access: reconnect silently.
    if (WU.lsGet(WU.K("cloud_on"), false)) {
      lastSyncAt = WU.lsGet(WU.K("cloud_last"), 0);
      requestToken(false);
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
  // The only path allowed to show a prompt.
  WU.actions.cloudin = function () { requestToken(true); };
  WU.actions.cloudsync = function () { sync(true); };
  WU.actions.cloudout = function () {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token); } catch (e) {}
    }
    token = null; fileId = null; lastSyncAt = 0; tokenExpiry = 0;
    // Signing out is deliberate, so clear the back-off: the next click should
    // prompt immediately rather than being swallowed by it.
    authPending = false; authInteractive = false; authBlockedUntil = 0;
    stopAutoSync();
    WU.lsSet(WU.K("cloud_on"), false);
    signedOutUI();
    WU.toast("Signed out of Drive");
  };

  // The engine calls this whenever settings or the profile change.
  WU.onSave = scheduleSave;
  window.addEventListener("beforeunload", function () {
    if (token && saveTimer) { clearTimeout(saveTimer); sync(false); }
  });

  /* Rows can be mounted long after the config check has run — the Versus panel
     builds its own on first open — so a late arrival has to be told whether
     cloud save is off, or it would sit there as an empty box. */
  var unavailable = false;

  WU.renderCloudRow = function (id) {
    if (rows.indexOf(id) < 0) rows.push(id);
    if (unavailable) {
      var el = document.getElementById(id);
      if (el) el.style.display = "none";
      return;
    }
    if (lastStatus) status(lastStatus.text, lastStatus.sub);
  };

  fetch("/api/status")
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (j) {
      if (!j || !j.cloudSave || !j.googleClientId) {
        unavailable = true;
        eachRow(function (r) { r.style.display = "none"; });
        return;
      }
      clientId = j.googleClientId;
      signedOutUI();
      loadGis();
    })
    .catch(function () {
      unavailable = true;
      eachRow(function (r) { r.style.display = "none"; });
    });
})();
