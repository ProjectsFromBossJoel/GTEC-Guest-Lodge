/* GTEC Guest Lodge – portal core (shared by sign-in, sign-up, account and admin pages).
   Exposes window.Portal. No page-specific code lives here. */
(function () {
  'use strict';
  var CFG = window.PORTAL;
  var P = window.Portal = { CFG: CFG, sections: {} };

  /* ---------- tiny helpers ---------- */
  P.$ = function (id) { return document.getElementById(id); };
  P.esc = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };
  var esc = P.esc;

  P.toast = function (msg, kind) {
    var box = P.$('pt-toasts');
    if (!box) { box = document.createElement('div'); box.id = 'pt-toasts'; box.setAttribute('role', 'status'); box.setAttribute('aria-live', 'polite'); document.body.appendChild(box); }
    var t = document.createElement('div');
    t.className = 'pt-toast ' + (kind || '');
    t.textContent = msg;
    box.appendChild(t);
    setTimeout(function () { t.remove(); }, kind === 'err' ? 6000 : 3500);
  };

  /* Disable a button, show a spinner, and re-enable when the promise settles. */
  P.busy = function (btn, work) {
    if (btn.classList.contains('is-busy')) return Promise.resolve();
    btn.classList.add('is-busy');
    return Promise.resolve().then(work).then(function (r) { btn.classList.remove('is-busy'); return r; },
      function (e) { btn.classList.remove('is-busy'); throw e; });
  };

  /* ---------- dates ---------- */
  P.toDate = function (v) {
    if (!v) return null;
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v.toDate === 'function') return v.toDate();
    if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
    if (typeof v === 'number') return new Date(v < 1e12 ? v * 1000 : v);
    var s = String(v).trim(), m;
    if ((m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);            // date only = local midnight
    if ((m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s))) return new Date(+m[3], +m[2] - 1, +m[1]); // dd/mm/yyyy (Ghana)
    var d = new Date(s);
    return isNaN(d) ? null : d;
  };
  P.day0 = function (d) { return new Date(d.getFullYear(), d.getMonth(), d.getDate()); };
  P.ymd = function (d) { return d.getFullYear() + '-' + ('0' + (d.getMonth() + 1)).slice(-2) + '-' + ('0' + d.getDate()).slice(-2); };
  P.addDays = function (d, n) { return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n); };
  P.daysBetween = function (a, b) { return Math.round((P.day0(b) - P.day0(a)) / 86400000); };
  P.fmtDate = function (d) { return d ? d.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  P.fmtShort = function (d) { return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
  P.fmtDateTime = function (d) { return d ? d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'; };
  P.withTime = function (d, hhmm) {                       // date + "14:00" → Date
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); var x = P.day0(d);
    if (m) x.setHours(+m[1], +m[2]);
    return x;
  };
  P.timeLabel = function (hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); if (!m) return hhmm || '';
    var h = +m[1]; return ((h + 11) % 12 + 1) + ':' + m[2] + ' ' + (h >= 12 ? 'pm' : 'am');
  };
  P.money = function (n) { return isFinite(n) && n !== '' && n != null ? CFG.lodge.currency + ' ' + Number(n).toLocaleString('en-GB', { maximumFractionDigits: 2 }) : '—'; };

  /* ---------- Firebase ---------- */
  P.init = function () {
    if (typeof firebase === 'undefined') throw new Error('Firebase SDK did not load.');
    if (!firebase.apps.length) {
      if (/PASTE_/.test(JSON.stringify(CFG.firebaseConfig))) throw new Error('Paste your firebaseConfig into js/portal-config.js');
      firebase.initializeApp(CFG.firebaseConfig);
    }
    P.auth = firebase.auth();
    P.db = firebase.firestore();
    return P;
  };

  /* Only same-site relative paths are allowed as ?next= (prevents open redirects). */
  P.safeNext = function (fallback) {
    var n = new URLSearchParams(location.search).get('next') || '';
    return /^[A-Za-z0-9_\-./]+(\?[A-Za-z0-9_\-.=&%]*)?(#[A-Za-z0-9_\-]*)?$/.test(n) && n.indexOf('//') === -1 && n.indexOf('..') === -1 ? n : fallback;
  };

  P.authError = function (e) {
    var c = e && e.code || '';
    var map = {
      'auth/invalid-email': 'That e-mail address doesn’t look right.',
      'auth/user-not-found': 'E-mail or password is incorrect.',
      'auth/wrong-password': 'E-mail or password is incorrect.',
      'auth/invalid-credential': 'E-mail or password is incorrect.',
      'auth/invalid-login-credentials': 'E-mail or password is incorrect.',
      'auth/email-already-in-use': 'An account with this e-mail already exists. Try signing in instead.',
      'auth/weak-password': 'Choose a stronger password (at least 8 characters).',
      'auth/too-many-requests': 'Too many attempts. Please wait a few minutes and try again.',
      'auth/network-request-failed': 'No internet connection. Check your network and try again.',
      'auth/popup-closed-by-user': 'Sign-in was cancelled.',
      'auth/cancelled-popup-request': 'Sign-in was cancelled.',
      'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups and try again.',
      'auth/account-exists-with-different-credential': 'This e-mail is already registered with a different sign-in method.',
      'auth/user-disabled': 'This account has been disabled. Please contact the lodge.',
      'auth/requires-recent-login': 'For security, please sign in again and retry.',
      'permission-denied': 'You don’t have permission to do that. Please sign in again.'
    };
    return map[c] || 'Something went wrong. Please try again.';
  };

  /* Create clients/{uid} the first time someone signs in or up (never overwrites). */
  P.ensureProfile = function (user, extra) {
    var ref = P.db.collection('clients').doc(user.uid);
    return ref.get().then(function (snap) {
      if (snap.exists) return snap.data();
      var data = {
        name: String((extra && extra.name) || user.displayName || '').trim().slice(0, 80),
        email: String(user.email || '').toLowerCase(),
        phone: String((extra && extra.phone) || '').trim().slice(0, 30),
        provider: (user.providerData[0] && user.providerData[0].providerId) || 'password',
        createdAt: firebase.firestore.FieldValue.serverTimestamp()
      };
      return ref.set(data).then(function () { return data; });
    });
  };

  /* ---------- bookings → "stays" ---------- */
  function pick(d, keys) {
    for (var i = 0; i < keys.length; i++) { var v = d[keys[i]]; if (v != null && v !== '') return v; }
    return null;
  }
  P.pick = pick;

  P.normalizeBooking = function (id, d) {
    var F = CFG.data.bookings.fields;
    var ci = P.toDate(pick(d, F.checkIn)), co = P.toDate(pick(d, F.checkOut));
    var status = String(pick(d, F.status) || '').toLowerCase();
    var room = pick(d, F.room);
    if (room && typeof room === 'object') room = room.name || room.title || '';
    return {
      id: id,
      ref: String(pick(d, F.ref) || id),
      room: String(room || 'Room'),
      checkIn: ci ? P.day0(ci) : null,
      checkOut: co ? P.day0(co) : null,
      status: status,
      cancelled: /cancel|void|reject|declin|no.?show/.test(status),
      guests: pick(d, F.guests),
      total: pick(d, F.total)
    };
  };

  /* upcoming / current / past, based on today's date */
  P.stayPhase = function (s, now) {
    now = P.day0(now || new Date());
    if (s.cancelled) return 'cancelled';
    if (!s.checkIn || !s.checkOut) return 'unknown';
    if (now < s.checkIn) return 'upcoming';
    if (now > s.checkOut) return 'past';            // checkout date has passed
    return 'current';                                // includes check-out day
  };

  /* Reads every booking whose e-mail field matches the signed-in guest. Each field is queried
     separately so one denied/missing field doesn't hide the rest. */
  P.loadStays = function (user) {
    var email = String(user.email || '').toLowerCase();
    var B = CFG.data.bookings, seen = {}, out = [];
    return Promise.all(B.emailFields.map(function (f) {
      return P.db.collection(B.collection).where(f, '==', email).limit(100).get().then(function (qs) {
        qs.forEach(function (doc) { if (!seen[doc.id]) { seen[doc.id] = 1; out.push(P.normalizeBooking(doc.id, doc.data())); } });
      }).catch(function (e) { if (window.console) console.warn('[portal] bookings query on "' + f + '" failed:', e.code || e.message); });
    })).then(function () {
      out.sort(function (a, b) { return (b.checkIn || 0) - (a.checkIn || 0); });
      return out;
    });
  };

  /* Own documents from a collection (no orderBy → no composite index needed; sorted here). */
  P.loadMine = function (collection, uid, limit) {
    return P.db.collection(collection).where('uid', '==', uid).limit(limit || 100).get().then(function (qs) {
      var rows = [];
      qs.forEach(function (d) { var x = d.data(); x.id = d.id; x._ts = P.toDate(x.createdAt); rows.push(x); });
      rows.sort(function (a, b) { return (b._ts || 0) - (a._ts || 0); });
      return rows;
    });
  };

  /* Stars as read-only text */
  P.starsRO = function (n) {
    var h = '<span class="pt-stars ro" aria-label="' + esc(n) + ' out of 5">';
    for (var i = 1; i <= 5; i++) h += '<button type="button" tabindex="-1" class="' + (i <= n ? 'on' : '') + '">★</button>';
    return h + '</span>';
  };

  /* Star picker; returns {el, get, set} */
  P.starPicker = function (initial, onChange) {
    var el = document.createElement('div'); el.className = 'pt-stars'; el.setAttribute('role', 'radiogroup');
    var val = initial || 0;
    function paint() {
      [].forEach.call(el.children, function (b, i) { b.classList.toggle('on', i < val); b.setAttribute('aria-checked', String(i + 1 === val)); });
    }
    for (var i = 1; i <= 5; i++) (function (n) {
      var b = document.createElement('button'); b.type = 'button'; b.textContent = '★'; b.setAttribute('role', 'radio');
      b.setAttribute('aria-label', n + ' star' + (n > 1 ? 's' : ''));
      b.addEventListener('click', function () { val = n; paint(); if (onChange) onChange(val); });
      el.appendChild(b);
    })(i);
    paint();
    return { el: el, get: function () { return val; }, set: function (v) { val = v; paint(); } };
  };

  /* Avoid double submits / spam: one write per key per N seconds */
  var last = {};
  P.cooldown = function (key, secs) {
    var now = Date.now();
    if (last[key] && now - last[key] < secs * 1000) return Math.ceil((secs * 1000 - (now - last[key])) / 1000);
    last[key] = now; return 0;
  };

  P.statusBadge = function (s) {
    var cls = { new: 'bad', seen: 'warn', in_progress: 'info', resolved: 'ok', closed: '', requested: 'warn', collected: 'info', processing: 'info', ready: 'brand', delivered: 'ok', cancelled: '', draft: 'warn', published: 'ok', hidden: '' }[s];
    var label = { new: 'New', seen: 'Seen', in_progress: 'In progress', resolved: 'Resolved', closed: 'Closed', requested: 'Requested', collected: 'Collected', processing: 'Processing', ready: 'Ready', delivered: 'Delivered', cancelled: 'Cancelled', draft: 'Draft', published: 'Published', hidden: 'Hidden' }[s] || s;
    return '<span class="pt-badge ' + (cls || '') + '">' + esc(label) + '</span>';
  };
})();
