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

  /* The access token is kept in this browser so that reloading a page, or
     following a link to another topic, does not need a fresh sign-in window.
     Google's browser flow issues no refresh token, so without this every
     navigation would reopen the popup. The token lasts about an hour and can
     only reach this app's own hidden Drive folder — it grants nothing else. */
  var TOKEN_KEY = "cloud_tok";

  function storeToken(value, expiresInSeconds) {
    token = value;
    // Expire two minutes early so a sync never starts on a token about to die.
    tokenExpiry = Date.now() + (Number(expiresInSeconds || 3600) - 120) * 1000;
    WU.lsSet(WU.K(TOKEN_KEY), { t: token, e: tokenExpiry });
    WU.lsSet(WU.K("cloud_on"), true);
  }

  /** Restores a still-valid token from a previous page. */
  function restoreToken() {
    var s = WU.lsGet(WU.K(TOKEN_KEY), null);
    if (!s || typeof s.t !== "string" || typeof s.e !== "number") return false;
    if (Date.now() >= s.e) { WU.lsSet(WU.K(TOKEN_KEY), null); return false; }
    token = s.t;
    tokenExpiry = s.e;
    return true;
  }

  /** `forget` also drops the "this player uses cloud save" flag. */
  function dropToken(forget) {
    token = null;
    tokenExpiry = 0;
    fileId = null;
    WU.lsSet(WU.K(TOKEN_KEY), null);
    if (forget) WU.lsSet(WU.K("cloud_on"), false);
  }
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

  /** "How long ago", because an absolute clock time tells you nothing at a glance. */
  function agoText(ts) {
    if (!ts) return "not yet";
    var s = Math.max(0, Math.round((Date.now() - ts) / 1000));
    if (s < 10) return "just now";
    if (s < 60) return s + " seconds ago";
    var m = Math.round(s / 60);
    if (m < 60) return m + (m === 1 ? " minute ago" : " minutes ago");
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? " hour ago" : " hours ago");
    try { return new Date(ts).toLocaleDateString(); } catch (e) { return "a while ago"; }
  }

  function signedInUI() {
    status(
      "Your progress is saved to Google Drive. Last synced: <b>" + agoText(lastSyncAt) + "</b>.",
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="cbtn ghost" data-act="cloudsync">Sync now</button>' +
        '<button class="cbtn ghost" data-act="cloudout">Sign out</button></div>'
    );
  }

  /**
   * Connected before, but the hour-long access token has run out.
   *
   * Google's browser token flow has no silent refresh — asking for a new token
   * always opens a window, and a window that opens without the player clicking
   * anything is exactly the thing that made this feel broken. So we ask, and
   * wait for a click.
   */
  function reconnectUI() {
    status(
      "Signed in, but the Drive session has expired — that happens about once an hour. " +
        "Your progress is safe in this browser. Last synced: <b>" + agoText(lastSyncAt) + "</b>.",
      '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
        '<button class="cbtn gsi" data-act="cloudin">' + GOOGLE_MARK + "<span>Reconnect Drive</span></button>" +
        '<button class="cbtn ghost" data-act="cloudout">Sign out</button></div>'
    );
  }

  /** Whichever of the three states currently applies. */
  function paintCloud() {
    if (token && Date.now() < tokenExpiry) signedInUI();
    else if (WU.lsGet(WU.K("cloud_on"), false)) reconnectUI();
    else signedOutUI();
  }

  /* ---------- the save payload ---------- */

  /**
   * Keys that belong to this browser and must never leave it.
   *
   * The access token above all: it lives under the same wu_ prefix as
   * everything else, so a plain sweep would upload the credential to Drive and
   * then push it onto every other device, where it would overwrite a good
   * token with one that is already expiring. The multiplayer identity is
   * per-browser by design too — syncing it would give two devices the same
   * seat in a room.
   */
  var NEVER_SYNC = ["cloud_tok", "cloud_on", "cloud_last", "mp_session", "mp_cid", "pending_ch"];

  function isLocalOnly(key) {
    for (var i = 0; i < NEVER_SYNC.length; i++) {
      if (key.indexOf(NEVER_SYNC[i]) > -1) return true;
    }
    return false;
  }

  function collect() {
    var out = { v: 1, at: Date.now(), settings: WU.lsGet("wu_settings", {}), keys: {} };
    // Everything this site owns is namespaced, so a prefix sweep is exact.
    for (var i = 0; i < localStorage.length; i++) {
      var k = localStorage.key(i);
      if (!k || k.indexOf("wu_") !== 0) continue;
      if (k === "wu_settings") continue;
      if (isLocalOnly(k)) continue;
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
      // Defends against save files written before the exclusion list existed.
      if (isLocalOnly(k)) return;
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
    if (busy) return Promise.resolve();

    // No usable token. Say so instead of doing nothing, which is what made
    // "Sync now" look broken, and offer the button that fixes it.
    if (!token || Date.now() >= tokenExpiry) {
      dropToken(false);
      paintCloud();
      if (showToast) WU.toast("Drive session expired — press Reconnect");
      return Promise.resolve();
    }
    busy = true;

    return download()
      .then(function (remote) {
        if (remote) merge(remote);
        return upload(collect());
      })
      .then(function () {
        lastSyncAt = Date.now();
        WU.lsSet(WU.K("cloud_last"), lastSyncAt);
        paintCloud();
        if (showToast) WU.toast("Progress saved to Drive");
      })
      .catch(function (err) {
        // Drive rejected the token: drop it and wait for a click. Never open a
        // window the player did not ask for.
        if (/40[13]/.test(String(err.message))) {
          dropToken(false);
          paintCloud();
          if (showToast) WU.toast("Drive session expired — press Reconnect");
        } else if (showToast) {
          WU.toast("Could not reach Drive — try again");
        }
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
   * A sign-in window opens only when the player clicks.
   *
   * Google's browser token flow has no silent mode: requestAccessToken always
   * opens a window, `prompt: ""` included. Calling it on page load — which is
   * what used to happen for a returning player — meant a popup on every single
   * page, and following a topic link is a page. So nothing here is automatic;
   * an expired session shows a Reconnect button and waits.
   */
  var authPending = false;

  function requestToken() {
    if (!tokenClient || authPending) return;
    authPending = true;
    // Already granted once, so skip the consent screen and just re-issue.
    var consented = WU.lsGet(WU.K("cloud_on"), false);
    try {
      tokenClient.requestAccessToken({ prompt: consented ? "" : "consent" });
    } catch (e) {
      authPending = false;
      paintCloud();
    }
  }

  function initGis() {
    if (!window.google || !google.accounts || !google.accounts.oauth2) return;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: function (resp) {
        authPending = false;
        if (resp.error || !resp.access_token) {
          // Dismissed or refused. Keep the cloud_on flag so the row offers
          // Reconnect rather than pretending they were never signed in.
          dropToken(false);
          paintCloud();
          WU.toast("Google sign-in was not completed");
          return;
        }
        storeToken(resp.access_token, resp.expires_in);
        paintCloud();
        sync(true);
        startAutoSync();
      },
    });

    // Pick up a session from an earlier page. No window, no interruption.
    if (restoreToken()) {
      lastSyncAt = WU.lsGet(WU.K("cloud_last"), 0);
      paintCloud();
      startAutoSync();
      sync(false);
    } else {
      lastSyncAt = WU.lsGet(WU.K("cloud_last"), 0);
      paintCloud();
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
  // The one and only path that may open a Google window.
  WU.actions.cloudin = function () { requestToken(); };
  WU.actions.cloudsync = function () { sync(true); };
  WU.actions.cloudout = function () {
    if (token && window.google && google.accounts && google.accounts.oauth2) {
      try { google.accounts.oauth2.revoke(token); } catch (e) {}
    }
    dropToken(true);
    lastSyncAt = 0;
    authPending = false;
    stopAutoSync();
    WU.lsSet(WU.K("cloud_last"), 0);
    paintCloud();
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
      lastSyncAt = WU.lsGet(WU.K("cloud_last"), 0);
      paintCloud();
      loadGis();
    })
    .catch(function () {
      unavailable = true;
      eachRow(function (r) { r.style.display = "none"; });
    });
})();
