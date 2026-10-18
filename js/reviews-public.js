/* Shows published guest reviews at the bottom of the website (index.html).
   Needs the Firebase app + firestore SDK that index.html already loads. Reads ONLY the
   `publicReviews` collection, which holds nothing but rating, first name + initial, text and date.
   Add   <section id="guest-reviews" class="pt-reviews" hidden></section>   above your footer. */
(function () {
  'use strict';
  var MAX = 9;
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function stars(n) { var h = '<span class="pt-stars ro" aria-label="' + n + ' out of 5">'; for (var i = 1; i <= 5; i++) h += '<button type="button" tabindex="-1" class="' + (i <= n ? 'on' : '') + '">★</button>'; return h + '</span>'; }

  function ensureCss() {
    if (document.querySelector('link[href*="portal.css"]')) return;
    var l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'css/portal.css'; document.head.appendChild(l);
  }

  function run() {
    var box = document.getElementById('guest-reviews');
    if (!box || typeof firebase === 'undefined' || !firebase.apps.length) return;
    firebase.firestore().collection('publicReviews').orderBy('publishedAt', 'desc').limit(MAX).onSnapshot(function (qs) {
      var items = []; qs.forEach(function (d) { var x = d.data(); if (x.text && x.rating) items.push(x); });
      if (!items.length) { box.hidden = true; box.innerHTML = ''; return; }                                    // nothing published yet → section stays hidden
      var avg = items.reduce(function (a, r) { return a + r.rating; }, 0) / items.length;
      ensureCss();
      box.innerHTML = '<h2>What our guests say</h2><p class="sum">' + stars(Math.round(avg)) + ' <b>' + avg.toFixed(1) + '</b> from ' + items.length + ' recent review' + (items.length > 1 ? 's' : '') + '</p>' +
        '<div class="cards">' + items.map(function (r) {
          var dt = r.publishedAt && r.publishedAt.toDate ? r.publishedAt.toDate().toLocaleDateString('en-GB', { month: 'short', year: 'numeric' }) : '';
          return '<blockquote>' + stars(r.rating) + '<p>“' + esc(r.text) + '”</p><cite>' + esc(r.name || 'Guest') + '</cite>' + (dt ? '<small>' + esc(dt) + '</small>' : '') + '</blockquote>';
        }).join('') + '</div>';
      box.hidden = false;
    }, function () { /* reviews are optional; never break the page */ });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run); else run();
})();
