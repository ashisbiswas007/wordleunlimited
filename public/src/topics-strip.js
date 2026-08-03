(function () {
  "use strict";
  var strip = document.getElementById("topicStrip");
  if (!strip) return;
  var region = (window.WU_CONFIG && window.WU_CONFIG.region) || "en";

  var CAT_ICON = {
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
    classic: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>'
  };
  function icon(cat) {
    var d = CAT_ICON[cat] || CAT_ICON.classic;
    return '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>";
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  fetch("/api/topics?region=" + encodeURIComponent(region))
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (j) {
      var list = (j.featured && j.featured.length ? j.featured : j.popular) || [];
      if (!list.length) list = j.topics || [];
      if (!list.length) { if (strip.parentNode) strip.parentNode.removeChild(strip); return; }
      strip.innerHTML = list.slice(0, 12).map(function (t) {
        return '<a href="/topics/' + esc(t.slug) + '/"><span class="e">' + icon(t.category) +
          "</span><span>" + esc(t.name) + "</span></a>";
      }).join("");
    })
    .catch(function () { if (strip.parentNode) strip.parentNode.removeChild(strip); });
})();
