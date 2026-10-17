/* "My stay": check-in / check-out summary, the guest's stays, and a calendar that shows ONLY their own data. */
(function () {
  'use strict';
  var P = window.Portal, esc = P.esc, CFG = P.CFG;

  var view = { month: null, selStay: null, selDay: null };

  function phaseBadge(ph) {
    var m = { current: ['ok', 'Staying now'], upcoming: ['info', 'Upcoming'], past: ['', 'Completed'], cancelled: ['bad', 'Cancelled'], unknown: ['warn', 'Dates pending'] }[ph] || ['', ph];
    return '<span class="pt-badge ' + m[0] + '">' + m[1] + '</span>';
  }

  /* The stay to feature: the one the guest picked, else current → next upcoming → latest past. */
  function featured(stays) {
    var live = stays;
    var pick = view.selStay && live.filter(function (s) { return s.id === view.selStay; })[0];
    if (pick) return pick;
    var cur = live.filter(function (s) { return P.stayPhase(s) === 'current'; })[0];
    if (cur) return cur;
    var up = live.filter(function (s) { return P.stayPhase(s) === 'upcoming'; }).sort(function (a, b) { return a.checkIn - b.checkIn; })[0];
    if (up) return up;
    return live.filter(function (s) { return !s.cancelled; })[0] || live[0] || null;
  }

  function countdownText(s) {
    var today = P.day0(new Date()), ph = P.stayPhase(s), n;
    if (ph === 'upcoming') { n = P.daysBetween(today, s.checkIn); return n === 1 ? 'Check-in is tomorrow.' : 'Check-in is in ' + n + ' days.'; }
    if (ph === 'current') {
      n = P.daysBetween(today, s.checkOut);
      return n === 0 ? 'You check out today by ' + P.timeLabel(CFG.lodge.checkOutTime) + '.'
           : n === 1 ? 'You check out tomorrow.' : 'You check out in ' + n + ' days.';
    }
    if (ph === 'past') { n = P.daysBetween(s.checkOut, today); return n <= 1 ? 'You checked out ' + (n === 0 ? 'today' : 'yesterday') + '.' : 'You checked out ' + n + ' days ago.'; }
    if (ph === 'cancelled') return 'This booking was cancelled.';
    return 'We’ll confirm your dates shortly.';
  }

  function hero(s) {
    if (!s) return '';
    var ph = P.stayPhase(s), nights = s.checkIn && s.checkOut ? P.daysBetween(s.checkIn, s.checkOut) : 0;
    var bar = '';
    if (ph === 'current' && nights > 0) {
      var done = Math.max(0, Math.min(nights, P.daysBetween(s.checkIn, new Date())));
      bar = '<div class="pt-bar" role="progressbar" aria-valuemin="0" aria-valuemax="' + nights + '" aria-valuenow="' + done + '"><i style="width:' + Math.round(done / nights * 100) + '%"></i></div>';
    }
    return '<section class="pt-stay" aria-label="Stay summary">' +
      '<div class="tag">' + (ph === 'current' ? 'Current stay' : ph === 'upcoming' ? 'Next stay' : 'Latest stay') + ' · ' + esc(s.ref) + '</div>' +
      '<h2>' + esc(s.room) + '</h2>' +
      '<dl class="pt-stay-grid">' +
      '<div><dt>Check-in</dt><dd>' + esc(P.fmtDate(s.checkIn)) + '<br><span style="font-weight:400">from ' + esc(P.timeLabel(CFG.lodge.checkInTime)) + '</span></dd></div>' +
      '<div><dt>Check-out</dt><dd>' + esc(P.fmtDate(s.checkOut)) + '<br><span style="font-weight:400">by ' + esc(P.timeLabel(CFG.lodge.checkOutTime)) + '</span></dd></div>' +
      '<div><dt>Nights</dt><dd>' + (nights || '—') + '</dd></div>' +
      '<div><dt>Total</dt><dd>' + (s.total != null && s.total !== '' ? esc(P.money(s.total)) : '—') + '</dd></div>' +
      '</dl><div class="count">' + esc(countdownText(s)) + bar + '</div></section>';
  }

  function stayList(stays) {
    if (stays.length < 2) return '';
    return '<div class="pt-card"><h2>All my stays</h2><ul class="pt-list">' + stays.map(function (s) {
      return '<li class="pt-item"><div class="pt-item-top"><div><b>' + esc(s.room) + '</b> <span class="pt-muted pt-small">· ' + esc(s.ref) + '</span><br>' +
        '<span class="pt-small">' + esc(P.fmtShort(s.checkIn)) + ' → ' + esc(P.fmtShort(s.checkOut)) + '</span></div>' +
        '<div style="display:flex;gap:.5rem;align-items:center">' + phaseBadge(P.stayPhase(s)) +
        '<button class="pt-btn pt-btn-ghost pt-btn-sm" data-pick="' + esc(s.id) + '" type="button">View</button></div></div></li>';
    }).join('') + '</ul></div>';
  }

  /* ---------- calendar ---------- */
  function buildEvents(ctx) {
    var ev = {};                                    // 'YYYY-MM-DD' → { stays:[{s,kind}], laundry:[], faults:[], feedback:[] }
    function slot(d) { var k = P.ymd(d); return ev[k] || (ev[k] = { stays: [], laundry: [], faults: [], feedback: [] }); }
    ctx.stays.forEach(function (s) {
      if (s.cancelled || !s.checkIn || !s.checkOut) return;
      var guard = 0;
      for (var d = s.checkIn; d <= s.checkOut && guard < 400; d = P.addDays(d, 1), guard++) {
        slot(d).stays.push({ s: s, kind: +d === +s.checkIn ? 'in' : +d === +s.checkOut ? 'out' : 'mid' });
      }
    });
    ctx.laundry.forEach(function (x) { if (x._ts) slot(x._ts).laundry.push(x); });
    ctx.faults.forEach(function (x) { if (x._ts) slot(x._ts).faults.push(x); });
    ctx.feedback.forEach(function (x) { if (x._ts) slot(x._ts).feedback.push(x); });
    return ev;
  }

  function calendar(ctx, root) {
    var ev = buildEvents(ctx), today = P.day0(new Date());
    var m = view.month, first = new Date(m.getFullYear(), m.getMonth(), 1);
    var startOffset = (first.getDay() + 6) % 7;                 // week starts Monday
    var gridStart = P.addDays(first, -startOffset);
    var cells = '', i, d, k, e, cls, tags, dots;
    ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].forEach(function (n) { cells += '<div class="dow">' + n + '</div>'; });
    for (i = 0; i < 42; i++) {
      d = P.addDays(gridStart, i); k = P.ymd(d); e = ev[k];
      cls = 'pt-day' + (d.getMonth() !== m.getMonth() ? ' out' : '') + (+d === +today ? ' today' : '') + (view.selDay === k ? ' sel' : '');
      tags = ''; dots = '';
      if (e) {
        if (e.stays.length) cls += ' stay' + (d < today ? ' past' : '');
        e.stays.forEach(function (x) { if (x.kind === 'in') tags += '<b>IN</b>'; if (x.kind === 'out') tags += '<b class="o">OUT</b>'; });
        if (e.laundry.length) dots += '<i title="Laundry"></i>';
        if (e.faults.length) dots += '<i class="f" title="Fault report"></i>';
        if (e.feedback.length) dots += '<i class="r" title="Feedback"></i>';
      }
      cells += '<button type="button" class="' + cls + '" data-day="' + k + '" aria-label="' + esc(P.fmtDate(d)) + '"><span>' + d.getDate() + '</span><span class="tags">' + tags + '</span><span class="dots">' + dots + '</span></button>';
    }
    var title = first.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
    root.innerHTML =
      '<div class="pt-cal-head"><button class="pt-btn pt-btn-ghost pt-btn-sm" data-nav="-1" type="button" aria-label="Previous month">‹</button>' +
      '<h3>' + esc(title) + '</h3>' +
      '<div style="display:flex;gap:.4rem"><button class="pt-btn pt-btn-ghost pt-btn-sm" data-nav="0" type="button">Today</button>' +
      '<button class="pt-btn pt-btn-ghost pt-btn-sm" data-nav="1" type="button" aria-label="Next month">›</button></div></div>' +
      '<div class="pt-cal" role="grid">' + cells + '</div>' +
      '<div class="pt-legend"><span>Your stay</span><span class="l-l">Laundry request</span><span class="l-f">Fault report</span><span class="l-r">Feedback</span></div>' +
      '<div id="pt-dayinfo"></div>';

    function info(key) {
      var x = ev[key], box = root.querySelector('#pt-dayinfo');
      if (!key) { box.innerHTML = ''; return; }
      var date = P.toDate(key), lines = [];
      if (x) {
        x.stays.forEach(function (y) { lines.push((y.kind === 'in' ? 'Check-in' : y.kind === 'out' ? 'Check-out' : 'Staying') + ' · ' + esc(y.s.room) + ' (' + esc(y.s.ref) + ')' + (y.kind === 'in' ? ' from ' + esc(P.timeLabel(CFG.lodge.checkInTime)) : y.kind === 'out' ? ' by ' + esc(P.timeLabel(CFG.lodge.checkOutTime)) : '')); });
        x.laundry.forEach(function (y) { lines.push('Laundry request · ' + esc((y.service || 'Laundry')) + ' · ' + P.statusBadge(y.status)); });
        x.faults.forEach(function (y) { lines.push('Fault reported · ' + esc(y.category || 'Fault') + ' · ' + P.statusBadge(y.status)); });
        x.feedback.forEach(function () { lines.push('You left feedback'); });
      }
      box.innerHTML = '<div class="pt-dayinfo"><b>' + esc(P.fmtDate(date)) + '</b>' + (lines.length ? '<ul><li>' + lines.join('</li><li>') + '</li></ul>' : '<div class="pt-muted">Nothing on this day.</div>') + '</div>';
    }
    info(view.selDay);

    root.addEventListener('click', function handler(evt) {
      var nav = evt.target.closest('[data-nav]'), day = evt.target.closest('[data-day]');
      if (nav) {
        var n = +nav.getAttribute('data-nav');
        view.month = n === 0 ? new Date(today.getFullYear(), today.getMonth(), 1) : new Date(view.month.getFullYear(), view.month.getMonth() + n, 1);
        root.removeEventListener('click', handler); calendar(ctx, root);
      } else if (day) {
        view.selDay = day.getAttribute('data-day');
        root.removeEventListener('click', handler); calendar(ctx, root);
      }
    });
  }

  /* ---------- section ---------- */
  P.sections.stay = {
    intro: 'Your check-in, check-out and a calendar of your own bookings and requests.',
    render: function (ctx, root) {
      var stays = ctx.stays;
      if (!stays.length) {
        root.innerHTML = '<div class="pt-card pt-empty"><h2>No bookings found yet</h2>' +
          '<p>We match bookings to the e-mail you signed in with (<b>' + esc(ctx.user.email) + '</b>). If you booked with a different e-mail, contact the front desk and we’ll link it.</p>' +
          '<a class="pt-btn" href="' + esc(CFG.paths.book) + '">Book a room</a> ' +
          '<a class="pt-btn pt-btn-ghost" href="https://wa.me/' + esc(CFG.lodge.whatsapp) + '" target="_blank" rel="noopener">WhatsApp the front desk</a></div>' +
          '<div class="pt-card"><h2>Calendar</h2><div id="pt-calbox"></div></div>';
      } else {
        var f = featured(stays);
        root.innerHTML = hero(f) + stayList(stays) + '<div class="pt-card"><h2>Calendar</h2><div id="pt-calbox"></div></div>';
        root.querySelectorAll('[data-pick]').forEach(function (b) {
          b.addEventListener('click', function () {
            view.selStay = b.getAttribute('data-pick'); view.month = null; P.rerender();
          });
        });
        if (!view.month && f && f.checkIn) view.month = new Date(f.checkIn.getFullYear(), f.checkIn.getMonth(), 1);
      }
      if (!view.month) { var t = new Date(); view.month = new Date(t.getFullYear(), t.getMonth(), 1); }
      calendar(ctx, root.querySelector('#pt-calbox'));
    }
  };
})();
