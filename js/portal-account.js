/* Account shell: auth guard, e-mail verification gate, data loading, navigation and routing.
   Section pages live in portal-stay.js, portal-requests.js and portal-info.js and register
   themselves as Portal.sections[id] = { title, intro, render(ctx, root) }. */
(function () {
  'use strict';
  var P = window.Portal, $ = P.$, esc = P.esc;

  var NAV = [
    { id: 'stay', label: 'My stay', icon: '🏠' },
    { id: 'rules', label: 'Rules', icon: '📋' },
    { id: 'feedback', label: 'Feedback & ratings', icon: '⭐' },
    { id: 'fault', label: 'Report a fault', icon: '🛠️' },
    { id: 'laundry', label: 'Request laundry', icon: '🧺' },
    { id: 'rooms', label: 'Available rooms', icon: '🛏️' },
    { id: 'services', label: 'Services', icon: '🛎️' },
    { id: 'profile', label: 'Profile', icon: '👤' }
  ];

  var ctx = { user: null, profile: {}, stays: [], faults: [], laundry: [], feedback: [], loadFailed: false };
  P.ctx = ctx;

  function safe(p) { return p.catch(function (e) { ctx.loadFailed = true; if (window.console) console.warn('[portal] load failed:', e.code || e.message); return []; }); }

  var loaders = {
    stays: function () { return safe(P.loadStays(ctx.user)).then(function (r) { ctx.stays = r; }); },
    faults: function () { return safe(P.loadMine('faultReports', ctx.user.uid)).then(function (r) { ctx.faults = r; }); },
    laundry: function () { return safe(P.loadMine('laundryRequests', ctx.user.uid)).then(function (r) { ctx.laundry = r; }); },
    feedback: function () { return safe(P.loadMine('feedback', ctx.user.uid)).then(function (r) { ctx.feedback = r; }); }
  };
  /* sections call ctx.reload('faults') after a write, then re-render themselves */
  ctx.reload = function (kind) { return loaders[kind]().then(renderNav); };

  /* ---------- verification gate ---------- */
  function needsVerification(u) {
    var pwOnly = u.providerData.every(function (p) { return p.providerId === 'password'; });
    return pwOnly && !u.emailVerified;
  }
  function showGate(u) {
    $('pt-boot').classList.add('pt-hide'); $('pt-shell').classList.add('pt-hide');
    var g = $('pt-gate'); g.classList.remove('pt-hide');
    g.innerHTML = '<div class="pt-card"><h2>Verify your e-mail</h2>' +
      '<p>We sent a verification link to <b>' + esc(u.email) + '</b>. Open it, then come back and press the button below. ' +
      'This keeps your booking details private to you.</p>' +
      '<div id="gate-msg"></div>' +
      '<div style="display:flex;gap:.6rem;flex-wrap:wrap">' +
      '<button class="pt-btn" id="gate-check" type="button">I’ve verified my e-mail</button>' +
      '<button class="pt-btn pt-btn-ghost" id="gate-resend" type="button">Resend e-mail</button></div>' +
      '<p class="pt-small pt-muted" style="margin-top:1rem">Can’t find it? Check your spam folder. Wrong address? Sign out and create the account again.</p></div>';
    function say(t, k) { $('gate-msg').innerHTML = '<div class="pt-alert ' + k + '">' + esc(t) + '</div>'; }
    $('gate-check').addEventListener('click', function () {
      P.busy(this, function () { return u.reload().then(function () { return P.auth.currentUser.getIdToken(true); }); }).then(function () {
        if (P.auth.currentUser.emailVerified) location.reload(); else say('Not verified yet. Open the link in the e-mail first.', 'warn');
      }).catch(function (e) { say(P.authError(e), 'err'); });
    });
    var rbtn = $('gate-resend'), rlabel = rbtn.textContent, rtimer = null;
    function countdown(secs) {
      clearInterval(rtimer);
      var end = Date.now() + secs * 1000;
      function tick() {
        var left = Math.ceil((end - Date.now()) / 1000);
        if (left <= 0) { clearInterval(rtimer); rbtn.disabled = false; rbtn.textContent = rlabel; return; }
        rbtn.disabled = true; rbtn.textContent = rlabel + ' (' + left + 's)';
      }
      tick(); rtimer = setInterval(tick, 250);
    }
    rbtn.addEventListener('click', function () {
      var wait = P.cooldown('verify', 60);
      if (wait) { countdown(wait); return say('Almost there. You can request another e-mail when the timer ends.', 'warn'); }
      P.busy(this, function () { return u.sendEmailVerification(); }).then(function () {
        say('Verification e-mail sent. Check your inbox and spam folder.', 'ok');
        countdown(60);
      }).catch(function (e) { say(P.authError(e), 'err'); });
    });
  }

  /* ---------- navigation ---------- */
  function currentId() {
    var id = (location.hash || '').replace('#', '');
    return NAV.some(function (n) { return n.id === id; }) ? id : 'stay';
  }
  function badgeFor(id) {
    var n = 0;
    if (id === 'fault') n = ctx.faults.filter(function (f) { return f.status !== 'resolved' && f.status !== 'closed'; }).length;
    if (id === 'laundry') n = ctx.laundry.filter(function (l) { return l.status !== 'delivered' && l.status !== 'cancelled'; }).length;
    var u = (id === 'fault' || id === 'laundry') && P.unread ? P.unread(id) : 0;
    return u ? ' <span class="n" title="' + u + ' unread message' + (u === 1 ? '' : 's') + '">' + u + '</span>' : '';
  }
  function renderNav() {
    var cur = currentId();
    $('pt-nav').innerHTML = NAV.map(function (n) {
      return '<a href="#' + n.id + '"' + (n.id === cur ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + n.icon + '</span> ' + esc(n.label) + badgeFor(n.id) + '</a>';
    }).join('');
    var nv = $('pt-nav'), on = nv.querySelector('[aria-current]');
    if (on && nv.scrollWidth > nv.clientWidth) nv.scrollLeft = on.offsetLeft - (nv.clientWidth - on.offsetWidth) / 2;
    renderBottom();
  }
  var BOTTOM = ['stay', 'rules', 'services', 'profile'];
  function renderBottom() {
    var bar = $('pt-bottom'), list = $('pt-more-list'), sheet = $('pt-more'); if (!bar || !list) return;
    var cur = currentId(), isOpen = !!sheet && !sheet.classList.contains('pt-hide');
    var more = NAV.filter(function (n) { return BOTTOM.indexOf(n.id) === -1; });
    var dot = more.some(function (n) { return badgeFor(n.id); });
    var unreadAll = P.unread ? P.unread('fault') + P.unread('laundry') : 0;
    bar.innerHTML = BOTTOM.map(function (id) {
      var n = NAV.filter(function (x) { return x.id === id; })[0];
      return '<a href="#' + n.id + '"' + (n.id === cur ? ' aria-current="page"' : '') + '><span class="ic" aria-hidden="true">' + n.icon + '</span><span>' + esc(n.label) + '</span></a>';
    }).join('') +
      '<button type="button" id="pt-more-btn" aria-haspopup="true" aria-expanded="' + isOpen + '"' + (BOTTOM.indexOf(cur) === -1 ? ' aria-current="page"' : '') + '>' +
      '<span class="ic" aria-hidden="true"><i class="fas fa-bars"></i>' + (dot ? '<b class="dot"></b>' : '') + '</span><span>More</span></button>';
    list.innerHTML = more.map(function (n) {
      return '<a role="menuitem" href="#' + n.id + '"' + (n.id === cur ? ' aria-current="page"' : '') + '><span aria-hidden="true">' + n.icon + '</span> ' + esc(n.label) + badgeFor(n.id) + '</a>';
    }).join('');
  }
  function closeMore() {
    var s = $('pt-more'), b = $('pt-more-btn');
    if (s) s.classList.add('pt-hide');
    if (b) b.setAttribute('aria-expanded', 'false');
  }
  function toggleMore() {
    var s = $('pt-more'); if (!s) return;
    var open = s.classList.contains('pt-hide');
    s.classList.toggle('pt-hide', !open);
    var b = $('pt-more-btn'); if (b) b.setAttribute('aria-expanded', String(open));
  }
  function route() {
    var id = currentId(), sec = P.sections[id], main = $('pt-main');
    renderNav();
    closeMore();
    var meta = NAV.filter(function (n) { return n.id === id; })[0];
    document.title = meta.label + ' – GTEC Guest Lodge';
    main.innerHTML = '<div class="pt-pagehead"><h1>' + esc(meta.label) + '</h1>' + (sec && sec.intro ? '<p>' + esc(sec.intro) + '</p>' : '') + '</div>' +
      (ctx.loadFailed ? '<div class="pt-alert warn">Some of your information couldn’t be loaded. Pull to refresh, or contact the front desk if this keeps happening.</div>' : '') +
      '<div id="pt-section"></div>';
    try { sec.render(ctx, $('pt-section')); }
    catch (e) { if (window.console) console.error(e); $('pt-section').innerHTML = '<div class="pt-alert err">This page couldn’t be shown. Please refresh.</div>'; }
    window.scrollTo(0, 0);
  }
  /* keeps the nav badges live on every page (the fault/laundry pages also have their own listeners) */
  var watching = false, lastUnread = null;
  function startWatch() {
    if (watching) return; watching = true;
    [['faults', 'faultReports', 'fault'], ['laundry', 'laundryRequests', 'laundry']].forEach(function (c) {
      P.db.collection(c[1]).where('uid', '==', ctx.user.uid).limit(100).onSnapshot(function (qs) {
        var rows = [];
        qs.forEach(function (d) { var x = d.data({ serverTimestamps: 'estimate' }); x.id = d.id; x._ts = P.toDate(x.createdAt); rows.push(x); });
        rows.sort(function (a, b) { return (b._ts || 0) - (a._ts || 0); });
        ctx[c[0]] = rows;
        var now = P.unread ? P.unread('fault') + P.unread('laundry') : 0;
        if (lastUnread != null && now > lastUnread && currentId() !== c[2]) P.toast('New message from the lodge.', 'ok');
        lastUnread = now;
        renderNav();
      }, function (e) { if (window.console) console.warn('[portal] watch:', e.code || e.message); });
    });
  }
  P.go = function (id) { location.hash = '#' + id; };
  P.rerender = route;
  P.renderNav = renderNav;

  /* ---------- boot ---------- */
  function boot() {
    try { P.init(); } catch (e) {
      $('pt-boot').innerHTML = '<div class="pt-alert err">' + esc(e.message) + '</div>'; return;
    }
    $('pt-bottom').addEventListener('click', function (e) { if (e.target.closest('#pt-more-btn')) toggleMore(); });
    $('pt-more').addEventListener('click', function (e) { if (e.target.id === 'pt-more' || e.target.closest('a')) closeMore(); });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeMore(); });
    $('pt-signout').addEventListener('click', function () {
      P.auth.signOut().then(function () { location.replace(P.CFG.paths.signin); });
    });

    P.auth.onAuthStateChanged(function (user) {
      if (!user) {
        location.replace(P.CFG.paths.signin + '?next=' + encodeURIComponent(P.CFG.paths.account + (location.hash || '')));
        return;
      }
      ctx.user = user;
      $('pt-who').textContent = user.displayName || user.email;
      if (needsVerification(user)) return showGate(user);

      P.ensureProfile(user).catch(function () { return {}; }).then(function (profile) {
        ctx.profile = profile || {};
        return Promise.all([loaders.stays(), loaders.faults(), loaders.laundry(), loaders.feedback()]);
      }).then(function () {
        $('pt-boot').classList.add('pt-hide'); $('pt-shell').classList.remove('pt-hide');
        window.addEventListener('hashchange', route);
        startWatch();
        route();
      });
    });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
