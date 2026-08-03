(function () {
  "use strict";
  var KEY = "wu_settings";
  var btn = document.getElementById("themeBtn");
  var menu = document.getElementById("menuBtn");
  var panel = document.getElementById("navPanel");
  var scrim = document.getElementById("navScrim");
  var nav = document.querySelector(".topnav nav");

  function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
  function write(s) { try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) {} }
  function system() {
    return window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  function resolved() {
    var t = read().theme || "system";
    return t === "system" ? system() : t;
  }
  function apply() {
    document.documentElement.setAttribute("data-theme", resolved());
    if (btn) btn.setAttribute("aria-pressed", resolved() === "dark" ? "true" : "false");
  }

  apply();

  if (btn) {
    btn.addEventListener("click", function () {
      var s = read();
      s.theme = resolved() === "dark" ? "light" : "dark";
      write(s);
      apply();
      if (window.WU && window.WU.settings) {
        window.WU.settings.theme = s.theme;
        if (window.WU.applyTheme) window.WU.applyTheme();
      }
    });
  }

  if (menu && panel && scrim && nav) {
    panel.innerHTML =
      '<div class="navpanel-top"><span class="navpanel-title">Menu</span>' +
      '<button class="navbtn" id="navClose" aria-label="Close">' +
      '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg></button></div>' +
      '<nav class="navpanel-links">' + nav.innerHTML.replace(/<button[\s\S]*?<\/button>/g, "") +
      '<a href="/topics/">Topics</a><a href="/privacy-policy/">Privacy Policy</a>' +
      '<a href="/disclaimer/">Disclaimer</a></nav>';

    var open = function (on) {
      panel.hidden = !on;
      scrim.hidden = !on;
      menu.setAttribute("aria-expanded", on ? "true" : "false");
      document.body.style.overflow = on ? "hidden" : "";
      if (on) requestAnimationFrame(function () { panel.classList.add("open"); scrim.classList.add("open"); });
      else { panel.classList.remove("open"); scrim.classList.remove("open"); }
    };
    menu.addEventListener("click", function () { open(panel.hidden); });
    scrim.addEventListener("click", function () { open(false); });
    panel.addEventListener("click", function (e) {
      if (e.target.closest("#navClose") || e.target.closest("a")) open(false);
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape" && !panel.hidden) open(false); });
  }
})();
