/* Fills the "popular topics" grid in the article body.
   Purely additive: if the API is unavailable the section simply stays empty
   rather than showing a broken state. */
(function () {
  "use strict";

  var strip = document.getElementById("topicStrip");
  if (!strip) return;

  var region = (window.WU_CONFIG && window.WU_CONFIG.region) || "en";

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function render(list) {
    if (!list.length) {
      strip.parentNode.removeChild(strip);
      return;
    }
    strip.innerHTML = list
      .slice(0, 12)
      .map(function (t) {
        return (
          '<a href="/topics/' + esc(t.slug) + '/" data-topic="' + esc(t.slug) + '">' +
          '<span class="e">' + esc(t.icon || "🎯") + "</span>" +
          "<span>" + esc(t.name) + "</span></a>"
        );
      })
      .join("");
  }

  // Clicking a topic here should start it in the board above, not navigate away.
  strip.addEventListener("click", function (e) {
    var a = e.target.closest("[data-topic]");
    if (!a) return;
    if (!window.WU || !window.WU.startTopic) return;
    e.preventDefault();
    window.WU.startTopic(a.getAttribute("data-topic"));
    var root = document.getElementById("wu-root");
    if (root) root.scrollIntoView({ behavior: "smooth", block: "start" });
  });

  fetch("/api/topics?region=" + encodeURIComponent(region))
    .then(function (r) { if (!r.ok) throw 0; return r.json(); })
    .then(function (j) {
      var list = (j.featured && j.featured.length ? j.featured : j.popular) || [];
      if (!list.length) list = j.topics || [];
      render(list);
    })
    .catch(function () {
      if (strip.parentNode) strip.parentNode.removeChild(strip);
    });
})();
