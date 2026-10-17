/* Monitoring & Auditing page.
 * Reads the `auditLogs` collection (written only by the server) and shows four tables:
 *   Bookings & devices · Email delivery · SMS delivery · Security events
 * plus a "Needs attention" list that flags anything unusual.
 * Everything rendered from the database goes through esc() — audit rows contain text typed by the public.
 */
(function () {
  'use strict';

  var HOME_COUNTRY = 'GH';             // bookings from anywhere else are highlighted
  var ALLOWED_ROLES = ['superadmin', 'admin'];
  var MAX_DOCS = 500;
  var PAGE_SIZE = 25;
  var CACHE_TTL = 60 * 1000;
  var GRACE_MS = 3 * 60 * 1000;        // how long a booking may wait for its email/SMS before it is flagged
  var RANGES = { '1h': 36e5, '24h': 864e5, '7d': 6048e5, '30d': 2592e6 };

  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) {
    return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  };

  var state = { range: '24h', rows: [], live: false };
  var ctx = { email: new Map(), sms: new Map() };
  var flagged = new Set();
  var tstate = {};
  var liveTimer = null;

  /* ───────────── formatting helpers ───────────── */
  function fmtTime(ms) {
    return ms ? new Date(ms).toLocaleString([], { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—';
  }
  function ago(ms) {
    if (!ms) return '';
    var s = Math.max(0, Math.round((Date.now() - ms) / 1000));
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + 'm ago';
    var h = Math.round(m / 60);
    if (h < 48) return h + 'h ago';
    return Math.round(h / 24) + 'd ago';
  }

  var BADGE = {
    success: ['ok', 'OK'], sent: ['ok', 'Sent'], failed: ['bad', 'Failed'], missing: ['bad', 'Not sent'],
    blocked: ['warn', 'Blocked'], warning: ['warn', 'Warning'], pending: ['info', 'Pending'], info: ['info', 'Info']
  };
  function badge(k) {
    var b = BADGE[k] || ['info', k];
    return '<span class="badge ' + b[0] + '">' + esc(b[1]) + '</span>';
  }

  var EVENT_LABEL = {
    rate_limited: 'Rate limit hit', recaptcha_failed: 'reCAPTCHA failed', recaptcha_low: 'Low reCAPTCHA score',
    double_submit_blocked: 'Double submit blocked', client_error: 'Browser error', sms_rejected: 'SMS rejected'
  };

  function placeText(r) {
    var n = r.net || {};
    return [n.city, n.region, n.country].filter(Boolean).join(', ') || '—';
  }
  function placeCell(r) {
    var n = r.net || {};
    var foreign = n.country && n.country !== HOME_COUNTRY;
    return '<div class="' + (foreign ? 'foreign' : '') + '">' + esc(placeText(r)) + '</div><div class="sub">ip ' + esc(n.ipHash || '—') + '</div>';
  }
  function deviceText(r) {
    var d = r.device || {};
    return [d.browser, d.os, d.type, d.screen].filter(Boolean).join(' · ') + (r.deviceId ? ' id:' + r.deviceId : '');
  }
  function deviceCell(r) {
    var d = r.device || {};
    var main = [d.browser, d.os].filter(Boolean).join(' · ') || 'Unknown';
    var sub = [d.type, d.screen].filter(Boolean).join(' · ');
    return '<div>' + esc(main) + '</div><div class="sub">' + esc(sub) + (r.deviceId ? ' · id ' + esc(r.deviceId.slice(0, 6)) : '') + '</div>';
  }
  function timeCell(r) {
    return '<div>' + esc(fmtTime(r.tsMs)) + '</div><div class="sub">' + esc(ago(r.tsMs)) + '</div>';
  }
  function timeText(r) { return r.tsMs ? new Date(r.tsMs).toISOString() : ''; }
  function sourceCell(r) {
    return r.source === 'client' ? '<span class="badge client" title="Reported by a browser — unverified">client</span>' : '<span class="badge info">server</span>';
  }

  function deliveryOf(map, r) {
    if (r.status !== 'success' || !r.bookingId) return null;
    var s = map.get(r.bookingId);
    if (s === 'success') return 'sent';
    if (s === 'failed') return 'failed';
    return Date.now() - r.tsMs > GRACE_MS ? 'missing' : 'pending';
  }
  function deliveryCell(map) {
    return function (r) { var s = deliveryOf(map === 'email' ? ctx.email : ctx.sms, r); return s ? badge(s) : '—'; };
  }
  function deliveryText(map) {
    return function (r) { return deliveryOf(map === 'email' ? ctx.email : ctx.sms, r) || ''; };
  }

  function detailOf(r, extra) {
    var m = r.meta || {};
    var bits = [];
    if (extra) extra(m, bits);
    if (r.detail) bits.push(r.detail);
    return bits.join(' · ') || '—';
  }
  var emailDetail = function (r) {
    return detailOf(r, function (m, b) { if (m.template) b.push(m.template); if (m.httpStatus) b.push('HTTP ' + m.httpStatus); });
  };
  var smsDetail = function (r) {
    return detailOf(r, function (m, b) {
      if (m.provider) b.push(m.provider);
      if (m.httpStatus) b.push('HTTP ' + m.httpStatus);
      if (m.durationMs !== undefined) b.push(m.durationMs + ' ms');
      if (m.recaptchaScore !== undefined) b.push('reCAPTCHA ' + m.recaptchaScore);
    });
  };

  /* ───────────── table definitions ───────────── */
  var cTime = { h: 'Time', c: timeCell, t: timeText };
  var cBid = { h: 'Booking ID', c: function (r) { return '<code>' + esc(r.bookingId || '—') + '</code>'; }, t: function (r) { return r.bookingId; } };
  var cStatus = { h: 'Status', c: function (r) { return badge(r.status); }, t: function (r) { return r.status; } };
  var cDevice = { h: 'Device', c: deviceCell, t: deviceText };
  var cPlace = { h: 'Location', c: placeCell, t: function (r) { return placeText(r) + ' ip:' + ((r.net || {}).ipHash || ''); } };
  var cSource = { h: 'Source', c: sourceCell, t: function (r) { return r.source; } };
  var cTo = { h: 'To', c: function (r) { return esc(r.contact || '—'); }, t: function (r) { return r.contact; } };

  var TABLES = {
    bookings: {
      title: 'Bookings & devices', icon: 'fa-calendar-check', statuses: ['success', 'failed', 'blocked'],
      filter: function (r) { return r.type === 'booking'; },
      cols: [
        cTime, cBid,
        { h: 'Room', c: function (r) { return esc(r.room || '—'); }, t: function (r) { return r.room; } },
        { h: 'Guest', c: function (r) { return esc(r.guest || '—'); }, t: function (r) { return r.guest; } },
        cStatus,
        { h: 'Email', c: deliveryCell('email'), t: deliveryText('email') },
        { h: 'SMS', c: deliveryCell('sms'), t: deliveryText('sms') },
        cDevice, cPlace, cSource
      ]
    },
    email: {
      title: 'Email delivery', icon: 'fa-envelope', statuses: ['success', 'failed'],
      filter: function (r) { return r.type === 'email'; },
      cols: [
        cTime, cBid, cTo, cStatus,
        { h: 'Detail', c: function (r) { return '<span class="detail">' + esc(emailDetail(r)) + '</span>'; }, t: emailDetail },
        cDevice, cPlace, cSource
      ]
    },
    sms: {
      title: 'SMS delivery', icon: 'fa-message', statuses: ['success', 'failed', 'blocked'],
      filter: function (r) { return r.type === 'sms'; },
      cols: [
        cTime, cBid, cTo, cStatus,
        { h: 'Campaign ID', c: function (r) { return '<code>' + esc((r.meta || {}).campaignId || '—') + '</code>'; }, t: function (r) { return (r.meta || {}).campaignId; } },
        { h: 'Detail', c: function (r) { return '<span class="detail">' + esc(smsDetail(r)) + '</span>'; }, t: smsDetail },
        cPlace, cSource
      ]
    },
    security: {
      title: 'Security events', icon: 'fa-shield-halved', statuses: ['blocked', 'warning', 'failed', 'info'],
      filter: function (r) { return r.type === 'security'; },
      cols: [
        cTime,
        { h: 'Event', c: function (r) { return esc(EVENT_LABEL[r.event] || r.event); }, t: function (r) { return EVENT_LABEL[r.event] || r.event; } },
        cStatus,
        { h: 'Detail', c: function (r) { return '<span class="detail">' + esc(r.detail || '—') + '</span>'; }, t: function (r) { return r.detail; } },
        cDevice, cPlace, cSource
      ]
    }
  };
  var STATUS_LABEL = { success: 'OK', failed: 'Failed', blocked: 'Blocked', warning: 'Warning', info: 'Info' };

  /* ───────────── data ───────────── */
  function db() { return firebase.firestore(); }
  function cacheKey() { return 'mon:v1:' + state.range; }

  function normalize(id, d) {
    var ts = d.ts && d.ts.toMillis ? d.ts.toMillis() : 0;
    return {
      id: id, type: d.type || '', event: d.event || '', status: d.status || 'info', tsMs: ts,
      bookingId: d.bookingId || '', room: d.room || '', guest: d.guestName || '', contact: d.contact || '',
      detail: d.detail || '', meta: d.meta || {}, device: d.device || {}, net: d.net || {},
      source: d.source || '', deviceId: d.deviceId || ''
    };
  }

  function fetchRows() {
    var since = firebase.firestore.Timestamp.fromMillis(Date.now() - RANGES[state.range]);
    return db().collection('auditLogs').where('ts', '>=', since).orderBy('ts', 'desc').limit(MAX_DOCS).get()
      .then(function (snap) { return snap.docs.map(function (d) { return normalize(d.id, d.data()); }); });
  }

  function load(force) {
    $('mon-status').textContent = 'Loading…';
    return AppCache.wrap(cacheKey(), CACHE_TTL, fetchRows, { force: !!force })
      .then(function (rows) { state.rows = rows; renderAll(); })
      .catch(showError);
  }

  function loadDelta() {
    if (!state.rows.length) return load(true);
    var maxTs = state.rows.reduce(function (m, r) { return Math.max(m, r.tsMs); }, 0);
    return db().collection('auditLogs')
      .where('ts', '>', firebase.firestore.Timestamp.fromMillis(maxTs))
      .orderBy('ts', 'desc').limit(200).get()
      .then(function (snap) {
        var seen = new Set(state.rows.map(function (r) { return r.id; }));
        var fresh = snap.docs.filter(function (d) { return !seen.has(d.id); })
          .map(function (d) { return normalize(d.id, d.data()); });
        if (fresh.length) {
          state.rows = fresh.concat(state.rows).slice(0, MAX_DOCS);
          AppCache.set(cacheKey(), state.rows, CACHE_TTL);
        }
        renderAll();  // also refreshes "x min ago" and pending→not-sent states
      })
      .catch(showError);
  }

  function showError(e) {
    var msg = e && e.code === 'permission-denied'
      ? 'Firestore refused the read. Deploy the auditLogs rule from MONITORING_SETUP.md, and check that your role is superadmin, admin or manager.'
      : 'Could not load audit data: ' + (e && e.message ? e.message : e);
    $('mon-status').textContent = msg;
  }

  /* ───────────── analysis ───────────── */
  function buildCtx(rows) {
    var email = new Map(), sms = new Map();
    rows.forEach(function (r) {
      if (!r.bookingId || (r.type !== 'email' && r.type !== 'sms')) return;
      var map = r.type === 'email' ? email : sms;
      var cur = map.get(r.bookingId);
      if (cur === 'success') return;
      if (r.status === 'success') map.set(r.bookingId, 'success');
      else if (r.status === 'failed' && !cur) map.set(r.bookingId, 'failed');
    });
    ctx = { email: email, sms: sms };
  }

  function computeAlerts(rows) {
    var now = Date.now();
    var alerts = [];
    flagged = new Set();
    var count = function (fn) { return rows.filter(fn).length; };

    var emailFailed = count(function (r) { return r.type === 'email' && r.status === 'failed'; });
    var smsFailed = count(function (r) { return r.type === 'sms' && r.status === 'failed'; });
    if (emailFailed) alerts.push({ l: 'bad', t: emailFailed + ' email(s) failed to send', d: 'See the Email delivery table. EmailJS quota or template errors are the usual cause.' });
    if (smsFailed) alerts.push({ l: 'bad', t: smsFailed + ' SMS failed to send', d: 'See the SMS delivery table for the provider response.' });

    var bookings = rows.filter(function (r) { return r.type === 'booking' && r.event === 'booking_created' && r.status === 'success' && r.bookingId; });
    var noEmail = bookings.filter(function (b) { return now - b.tsMs > GRACE_MS && !ctx.email.has(b.bookingId); }).length;
    var noSms = bookings.filter(function (b) { return now - b.tsMs > GRACE_MS && !ctx.sms.has(b.bookingId); }).length;
    if (noEmail) alerts.push({ l: 'bad', t: noEmail + ' booking(s) have no email record', d: 'No confirmation email was logged within 3 minutes of the booking.' });
    if (noSms) alerts.push({ l: 'warn', t: noSms + ' booking(s) have no SMS record', d: 'No SMS was logged within 3 minutes of the booking.' });

    // same device / network making 3+ bookings within an hour
    var by = new Map();
    bookings.forEach(function (b) {
      var k = b.deviceId || (b.net || {}).ipHash;
      if (!k) return;
      if (!by.has(k)) by.set(k, []);
      by.get(k).push(b.tsMs);
    });
    by.forEach(function (ts, k) {
      ts.sort(function (a, b) { return a - b; });
      var lo = 0;
      for (var hi = 0; hi < ts.length; hi++) {
        while (ts[hi] - ts[lo] > 36e5) lo++;
        if (hi - lo + 1 >= 3) { flagged.add(k); break; }
      }
    });
    if (flagged.size) alerts.push({ l: 'warn', t: flagged.size + ' device(s) made 3+ bookings within an hour', d: 'Marked with an orange bar in the Bookings table. Could be a front-desk tablet, or someone holding rooms.' });

    var recentRl = count(function (r) { return r.event === 'rate_limited' && now - r.tsMs < 15 * 60e3; });
    if (recentRl >= 10) alerts.push({ l: 'warn', t: recentRl + ' rate-limit blocks in the last 15 minutes', d: 'Someone is hammering an endpoint. Check the Security events table for the location and device.' });
    var recaptcha = count(function (r) { return r.event === 'recaptcha_failed'; });
    if (recaptcha >= 5) alerts.push({ l: 'warn', t: recaptcha + ' reCAPTCHA failures in this range', d: 'Likely bots trying the SMS endpoint.' });
    var tools = count(function (r) { return r.device && r.device.type === 'bot'; });
    if (tools) alerts.push({ l: 'warn', t: tools + ' request(s) from scripts or tools (curl, Postman, …)', d: 'Real guests use browsers. Filter by device in the tables.' });
    var foreign = count(function (r) { return r.type === 'booking' && r.net && r.net.country && r.net.country !== HOME_COUNTRY; });
    if (foreign) alerts.push({ l: 'info', t: foreign + ' booking event(s) from outside ' + HOME_COUNTRY, d: 'Shown in orange in the Location column. May be legitimate foreign guests.' });
    var clientRows = count(function (r) { return r.source === 'client'; });
    if (clientRows) alerts.push({ l: 'info', t: 'Booking and email rows are reported by the guest\'s browser', d: 'They are marked "client" and can be forged. SMS and security rows are written by the server and are trustworthy.' });
    if (rows.length >= MAX_DOCS) alerts.push({ l: 'info', t: 'Showing only the newest ' + MAX_DOCS + ' events', d: 'Pick a shorter time range to see everything in it.' });
    if (!rows.length) alerts.push({ l: 'info', t: 'No audit events in this range', d: 'If this is unexpected, the booking page or send-sms function is not reporting yet — see MONITORING_SETUP.md.' });

    var serious = alerts.some(function (a) { return a.l === 'bad' || a.l === 'warn'; });
    if (rows.length && !serious) alerts.unshift({ l: 'ok', t: 'No problems detected in this range', d: 'All logged emails and SMS were delivered and nothing suspicious was flagged.' });
    return alerts;
  }

  /* ───────────── rendering ───────────── */
  function renderAlerts(alerts) {
    $('mon-alerts').innerHTML = alerts.map(function (a) {
      var icon = { bad: 'fa-circle-xmark', warn: 'fa-triangle-exclamation', info: 'fa-circle-info', ok: 'fa-circle-check' }[a.l];
      return '<li class="' + a.l + '"><i class="fas ' + icon + '"></i><div><div class="a-title">' + esc(a.t) + '</div><div class="a-desc">' + esc(a.d) + '</div></div></li>';
    }).join('');
  }

  function renderCards(rows) {
    var n = function (fn) { return rows.filter(fn).length; };
    var devices = new Set(), countries = new Set();
    rows.forEach(function (r) {
      if (r.type === 'booking') devices.add(r.deviceId || (r.net || {}).ipHash || r.id);
      if (r.net && r.net.country) countries.add(r.net.country);
    });
    var emailFail = n(function (r) { return r.type === 'email' && r.status === 'failed'; });
    var smsFail = n(function (r) { return r.type === 'sms' && r.status === 'failed'; });
    var blocked = n(function (r) { return r.status === 'blocked'; });
    var cards = [
      ['Bookings', n(function (r) { return r.event === 'booking_created'; }), 'fa-calendar-check', ''],
      ['Unique devices', devices.size, 'fa-mobile-screen', ''],
      ['Emails sent', n(function (r) { return r.type === 'email' && r.status === 'success'; }), 'fa-envelope', ''],
      ['Emails failed', emailFail, 'fa-envelope-circle-check', emailFail ? 'bad' : ''],
      ['SMS sent', n(function (r) { return r.type === 'sms' && r.status === 'success'; }), 'fa-message', ''],
      ['SMS failed', smsFail, 'fa-comment-slash', smsFail ? 'bad' : ''],
      ['Blocked requests', blocked, 'fa-ban', blocked ? 'warn' : ''],
      ['Countries', countries.size, 'fa-globe', '']
    ];
    $('mon-cards').innerHTML = cards.map(function (c) {
      return '<div class="mon-card ' + c[3] + '"><div class="k"><i class="fas ' + c[2] + '"></i> ' + esc(c[0]) + '</div><div class="v">' + Number(c[1]) + '</div></div>';
    }).join('');
  }

  function rowsFor(name) {
    var T = TABLES[name], st = tstate[name], q = st.q.trim().toLowerCase();
    return state.rows.filter(T.filter)
      .filter(function (r) { return st.status === 'all' || r.status === st.status; })
      .filter(function (r) {
        if (!q) return true;
        return T.cols.map(function (c) { return String(c.t(r) || ''); }).join(' ').toLowerCase().indexOf(q) !== -1;
      });
  }

  function renderTable(name) {
    var T = TABLES[name], st = tstate[name];
    var all = rowsFor(name);
    var shown = all.slice(0, st.limit);
    $('cnt-' + name).textContent = '(' + all.length + ')';
    $('more-' + name).style.display = all.length > shown.length ? '' : 'none';
    if (!shown.length) {
      $('tb-' + name).innerHTML = '<tr><td class="empty" colspan="' + T.cols.length + '">No events match.</td></tr>';
      return;
    }
    $('tb-' + name).innerHTML = shown.map(function (r) {
      var cls = r.status === 'failed' ? 'row-bad' : (r.status === 'blocked' || r.status === 'warning') ? 'row-warn' : '';
      if (r.type === 'booking' && flagged.has(r.deviceId || (r.net || {}).ipHash)) cls += ' row-flag';
      return '<tr class="' + cls + '">' + T.cols.map(function (c) {
        return '<td data-label="' + esc(c.h) + '">' + c.c(r) + '</td>';
      }).join('') + '</tr>';
    }).join('');
  }

  function renderAll() {
    buildCtx(state.rows);
    renderAlerts(computeAlerts(state.rows));
    renderCards(state.rows);
    Object.keys(TABLES).forEach(renderTable);
    var newest = state.rows.length ? ago(state.rows[0].tsMs) : 'n/a';
    $('mon-status').textContent = 'Loaded ' + state.rows.length + ' event(s) · newest ' + newest + ' · times shown in your local time zone';
  }

  /* ───────────── CSV export ───────────── */
  function exportCsv(name) {
    var T = TABLES[name];
    var cell = function (v) {
      var s = String(v === undefined || v === null ? '' : v);
      if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;           // stop spreadsheet formula injection
      return '"' + s.replace(/"/g, '""') + '"';
    };
    var lines = [T.cols.map(function (c) { return cell(c.h); }).join(',')]
      .concat(rowsFor(name).map(function (r) { return T.cols.map(function (c) { return cell(c.t(r)); }).join(','); }));
    var blob = new Blob([lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'audit-' + name + '-' + new Date().toISOString().slice(0, 10) + '.csv';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  }

  /* ───────────── setup ───────────── */
  function buildTables() {
    $('tables').innerHTML = Object.keys(TABLES).map(function (k) {
      var T = TABLES[k];
      tstate[k] = { q: '', status: 'all', limit: PAGE_SIZE };
      var opts = T.statuses.map(function (s) { return '<option value="' + s + '">' + STATUS_LABEL[s] + '</option>'; }).join('');
      var heads = T.cols.map(function (c) { return '<th>' + esc(c.h) + '</th>'; }).join('');
      return '<div class="card mon-table">' +
        '<div class="card-header mon-th">' +
        '<h2 class="card-title"><i class="fas ' + T.icon + '"></i> ' + esc(T.title) + '<span class="mon-count" id="cnt-' + k + '"></span></h2>' +
        '<div class="mon-tools">' +
        '<input type="search" id="q-' + k + '" placeholder="Search…" aria-label="Search ' + esc(T.title) + '">' +
        '<select id="st-' + k + '" aria-label="Filter by status"><option value="all">All statuses</option>' + opts + '</select>' +
        '<button class="mon-btn" id="csv-' + k + '"><i class="fas fa-download"></i> CSV</button>' +
        '</div></div>' +
        '<div class="card-body"><div class="mon-scroll"><table class="mon-table-el"><thead><tr>' + heads + '</tr></thead><tbody id="tb-' + k + '"></tbody></table></div>' +
        '<div class="mon-more"><button class="mon-btn" id="more-' + k + '" data-guard="off">Show more</button></div></div></div>';
    }).join('');

    Object.keys(TABLES).forEach(function (k) {
      $('q-' + k).addEventListener('input', function (e) { tstate[k].q = e.target.value; tstate[k].limit = PAGE_SIZE; renderTable(k); });
      $('st-' + k).addEventListener('change', function (e) { tstate[k].status = e.target.value; tstate[k].limit = PAGE_SIZE; renderTable(k); });
      $('more-' + k).addEventListener('click', function () { tstate[k].limit += PAGE_SIZE; renderTable(k); });
      $('csv-' + k).addEventListener('click', function () { exportCsv(k); });
    });
  }

  function start() {
    $('mon-app').style.display = '';
    load(false);
  }
  function deny(msg) {
    var el = $('mon-denied');
    el.textContent = msg || 'The Monitoring page is available to Super Admin and Admin accounts only.';
    el.style.display = '';
  }
  function waitForRole() {
    var tries = 0;
    var t = setInterval(function () {
      tries++;
      if (window._userRole) {
        clearInterval(t);
        ALLOWED_ROLES.indexOf(window._userRole) !== -1 ? start() : deny();
      } else if (tries > 80) {
        clearInterval(t);
        deny('Could not verify your role. Reload the page.');
      }
    }, 100);
  }

  function init() {
    buildTables();

    $('mon-range').addEventListener('change', function (e) { state.range = e.target.value; load(false); });
    $('mon-refresh').addEventListener('click', function (e) {
      var btn = e.currentTarget;
      if (window.ButtonGuard) ButtonGuard.run(btn, function () { return load(true); });
      else load(true);
    });
    $('mon-live').addEventListener('change', function (e) {
      state.live = e.target.checked;
      clearInterval(liveTimer);
      if (state.live) {
        liveTimer = setInterval(function () { if (!document.hidden) loadDelta(); }, 30000);
        loadDelta();
      }
    });

    firebase.auth().onAuthStateChanged(function (user) { if (user) waitForRole(); });
  }

  document.addEventListener('DOMContentLoaded', init);
})();