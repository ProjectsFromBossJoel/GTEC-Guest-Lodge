/* Shows published guest reviews at the bottom of the website (index.html), live.
   Needs the Firebase app + firestore SDK that index.html already loads.
   Reads ONLY `publicReviews` (rating, first name + initial, text, date) and `publicSettings/reviews` ({ scroll: true|false }).
   Add   <section id="guest-reviews" class="pt-reviews" hidden></section>   above your footer. */
(function () {
  'use strict';
  var MAX_STATIC = 9;      // fixed grid
  var MAX_SCROLL = 30;     // reviews loaded (and shown when scrolling is on)
  var SECONDS_PER_CARD = 6;

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stars(n) { var h = '<span class="pt-stars ro" aria-label="' + n + ' out of 5">'; for (var i = 1; i <= 5; i++) h += '<button type="button" tabindex="-1" class="' + (i <= n ? 'on' : '') + '">★</button>'; return h + '</span>'; }

  function ensureCss() {
    if (!document.querySelector('link[href*="portal.css"]')) {
      var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/portal.css'; document.head.appendChild(l);
    }
    if (document.getElementById('rv-style')) return;
    var s = document.createElement('style'); s.id = 'rv-style';
    s.textContent =
      '#guest-reviews .rv-marquee{overflow:hidden;-webkit-mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent);mask-image:linear-gradient(90deg,transparent,#000 5%,#000 95%,transparent)}' +
      '#guest-reviews .rv-track{display:flex;width:max-content;animation:rv-slide linear infinite}' +
      '#guest-reviews .rv-marquee:hover .rv-track,#guest-reviews .rv-marquee:focus-within .rv-track{animation-play-state:paused}' +
      '#guest-reviews .rv-track blockquote{flex:0 0 min(320px,84vw);width:min(320px,84vw);margin:0 20px 0 0;white-space:normal}' +
      '@keyframes rv-slide{from{transform:translateX(0)}to{transform:translateX(-50%)}}' +
      '@media (prefers-reduced-motion:reduce){#guest-reviews .rv-track{animation:none}#guest-reviews .rv-marquee{overflow-x:auto}#guest-reviews .rv-track blockquote[aria-hidden]{display:none}}';
    document.head.appendChild(s);
  }

  var state = { docs: [], scroll: false };

  function card(r, hidden) {
    var dt = r.publishedAt && r.publishedAt.toDate ? r.publishedAt.toDate().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
    return '<blockquote' + (hidden ? ' aria-hidden="true"' : '') + '>' + stars(r.rating) + '<p>“' + esc(r.text) + '”</p><cite>' + esc(r.name || 'Guest') + '</cite>' + (dt ? '<small>' + esc(dt) + '</small>' : '') + '</blockquote>';
  }

  function render(box) {
    var all = state.docs;
    if (!all.length) { box.hidden = true; box.innerHTML = ''; return; }   // nothing published → section hidden
    ensureCss();
    var avg = all.reduce(function (a, r) { return a + r.rating; }, 0) / all.length;
    var head = '<h2>What our guests say</h2><p class="sum">' + stars(Math.round(avg)) + ' <b>' + avg.toFixed(1) + '</b> from ' + all.length + ' review' + (all.length > 1 ? 's' : '') + '</p>';
    var body;

    if (state.scroll) {
      var base = all.slice();
      while (base.length < 6) base = base.concat(all);                 // enough cards to fill the width
      var secs = Math.max(20, base.length * SECONDS_PER_CARD);
      body = '<div class="rv-marquee"><div class="rv-track" style="animation-duration:' + secs + 's">' +
        base.map(function (r) { return card(r, false); }).join('') +
        base.map(function (r) { return card(r, true); }).join('') +
        '</div></div>';
    } else {
      body = '<div class="cards">' + all.slice(0, MAX_STATIC).map(function (r) { return card(r, false); }).join('') + '</div>';
    }
    box.innerHTML = head + body;
    box.hidden = false;
  }

  function run() {
    var box = document.getElementById('guest-reviews');
    if (!box || typeof firebase === 'undefined' || !firebase.apps.length) return;
    var db = firebase.firestore();

    // admin switch: publicSettings/reviews { scroll: true|false }  (missing = static)
    db.collection('publicSettings').doc('reviews').onSnapshot(function (d) {
      state.scroll = !!(d.exists && d.data().scroll);
      render(box);
    }, function () { /* optional setting; stay static */ });

    // published reviews, live
    db.collection('publicReviews').orderBy('publishedAt', 'desc').limit(MAX_SCROLL).onSnapshot(function (qs) {
      var items = []; qs.forEach(function (d) { var x = d.data(); if (x.text && x.rating) items.push(x); });
      state.docs = items;
      render(box);
    }, function () { /* reviews are optional; never break the page */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();