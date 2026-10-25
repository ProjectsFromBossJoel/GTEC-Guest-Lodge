/* Admin: Client requests – Fault reports, Laundry requests, Feedback & ratings (draft / publish to website).
   Live (onSnapshot) so new requests appear without refreshing. */
(function () {
  'use strict';
  var P = window.Portal, $ = P.$, esc = P.esc;

  var ALLOWED_ROLES = ['superadmin', 'admin', 'manager', 'receptionist', 'observer'];   // real gate = Page Access (auth.js)     // who may use this page (must match your Firestore rules)
  var PAGE = 10;                                    // rows per page
  var MAX_DOCS = 300;                               // newest N documents per list

  var FV = function () { return firebase.firestore.FieldValue; };
  var data = { faults: [], laundry: [], feedback: [] };
  var tab = (function () {                          // popup click can ask for a specific tab
    var t = null; try { t = sessionStorage.getItem('cr_open_tab'); sessionStorage.removeItem('cr_open_tab'); } catch (e) {}
    return ['faults', 'laundry', 'feedback'].indexOf(t) !== -1 ? t : 'faults';
  })();
var openRef = null;                               // request currently open in the modal
  var ts = {};                                      // per-tab UI state

  /* ---------- helpers ---------- */
  function waNumber(ph) {                           // Ghana local 024… → 23324…
    var d = String(ph || '').replace(/[^\d]/g, '');
    if (!d) return '';
    if (String(ph).trim().charAt(0) === '+') return d;
    return d.charAt(0) === '0' ? '233' + d.slice(1) : d;
  }
  function csvCell(v) {
    v = String(v == null ? '' : v).replace(/\r?\n/g, ' ');
    if (/^[=+\-@\t]/.test(v)) v = "'" + v;           // spreadsheet formula injection guard
    return '"' + v.replace(/"/g, '""') + '"';
  }
  function who(r) { return '<b>' + esc(r.name || '—') + '</b><div class="pt-small pt-muted">' + esc(r.email || '') + '</div>'; }
  function pieces(r) { return (r.items || []).reduce(function (n, i) { return n + (Number(i.qty) || 0); }, 0); }
  function when(r) { return P.fmtDateTime(r._ts); }
  function hasNewReply(r) {          /* guest replied and staff haven't saved since */
    var g = P.toDate(r.guestReplyAt), u = P.toDate(r.updatedAt);
    return !!(r.guestReply && g && (!u || +g >= +u));
  }
  function statusCell(r) { return P.statusBadge(r.status) + (hasNewReply(r) ? ' <span class="pt-badge bad">Guest replied</span>' : ''); }
  function guestBlockInnerOld(r) {
    return r.guestReply
      ? '<div class="pt-label" style="display:flex;align-items:center;gap:.6rem;flex-wrap:wrap">Guest’s reply <span class="pt-muted pt-small">(' + esc(P.fmtDateTime(P.toDate(r.guestReplyAt))) + ')</span><button class="pt-btn pt-btn-sm" id="cr-m-replybtn" type="button" style="margin-left:auto">Reply</button></div><div class="pt-quote">' + esc(r.guestReply) + '</div>'
      : '';
  }
  function chatField(k) { return k === 'faults' ? 'adminResponse' : 'adminNote'; }
  function chatMsgs(r, field) {
    var t = Array.isArray(r.thread) ? r.thread.slice() : [];
    var pre = [];
    /* the note is now a pinned message, not part of the chat */
    if (!t.length && r.guestReply) { var g = P.toDate(r.guestReplyAt); pre.push({ from: 'guest', text: r.guestReply, at: g ? +g : null }); }
    return pre.concat(t);
  }
  function withStaff(r, field, text, replyTo) { var m = { from: 'staff', text: text, at: Date.now() }; if (replyTo) m.replyTo = replyTo; return chatMsgs(r, field).concat([m]); }
  function withStaffOld(r, field, text) { return chatMsgs(r, field).concat([{ from: 'staff', text: text, at: Date.now() }]); }
  function editStaff(r, field, at, text) { return chatMsgs(r, field).map(function (m) { if (!(m.from === 'staff' && m.at === at)) return m; var n = cp(m); n.text = text; n.edited = true; return n; }); }
  function editStaffOld(r, field, at, text) { return chatMsgs(r, field).map(function (m) { return (m.from === 'staff' && m.at === at) ? { from: 'staff', text: text, at: m.at, edited: true } : m; }); }
  function pinHtml(r, k) { var t = r[chatField(k)]; return t ? '<div class="pt-pin">📌 <b>Pinned:</b> ' + esc(t) + '</div>' : ''; }
  function cp(o) { var n = {}; Object.keys(o).forEach(function (x) { n[x] = o[x]; }); return n; }
  function chatHtml(list, gr, rd) {
    return '<div class="pt-chat">' + list.map(function (m) {
      var me = m.from === 'staff', del = !!m.deleted;
      var seen = me && !del && rd != null && rd > list.indexOf(m);
      var tick = (me && !del && m.at) ? '<div class="pt-msg-tick' + (seen ? ' seen' : '') + '" title="' + (seen ? 'Seen' : 'Sent') + '">' + (seen ? '✓✓' : '✓') + '</div>' : '';
      var who = (me ? 'You' : 'Guest') + (m.at ? ' · ' + esc(P.fmtDateTime(new Date(m.at))) : '') + (m.edited && !del ? ' · edited' : '') + (m.starred ? ' · <span class="pt-msg-star">★</span>' : '');
      var quote = (m.replyTo && !del) ? '<div class="pt-msg-quote"><b>' + (m.replyTo.from === 'staff' ? 'You' : 'Guest') + '</b><span>' + esc(m.replyTo.text) + '</span></div>' : '';
      var arrow = (m.at && !del) ? '<button type="button" class="pt-msg-arrow" data-menu="' + m.at + '" aria-label="Message options" aria-haspopup="menu"><i class="fas fa-chevron-down"></i></button>' : '';
      var rs = [m.react, (gr || {})[m.at]].filter(Boolean); var react = (rs.length && !del) ? '<span class="pt-msg-react">' + rs.map(function (x) { return esc(x); }).join(' ') + '</span>' : '';
      return '<div class="pt-msg ' + (me ? 'me' : 'them') + (del ? ' deleted' : '') + (rs.length && !del ? ' has-react' : '') + '"><div class="pt-msg-who">' + who + '</div>' +
        arrow + quote + (del ? '<i class="fas fa-ban"></i> ' : '') + '<span class="pt-msg-text">' + esc(m.text) + '</span>' + tick + react + '</div>';
    }).join('') + '</div>';
  }
  function chatHtmlOld(list) {
    return '<div class="pt-chat">' + list.map(function (m) {
      var me = m.from === 'staff';
      return '<div class="pt-msg ' + (me ? 'me' : 'them') + '"><div class="pt-msg-who">' + (me ? 'You' : 'Guest') + (m.at ? ' · ' + esc(P.fmtDateTime(new Date(m.at))) : '') + (m.edited ? ' · edited' : '') + '</div>' +
        (me && m.at ? '<button type="button" class="pt-msg-arrow" data-menu="' + m.at + '" aria-label="Message options" aria-haspopup="menu"><i class="fas fa-chevron-down"></i></button>' : '') +
        esc(m.text) + '</div>';
    }).join('') + '</div>';
  }
  function guestBlockInner(r, k) {
    var list = chatMsgs(r, chatField(k));
    return list.length ? chatHtml(list, r.guestReacts, r.guestReadN) : '<div class="pt-muted pt-small" style="text-align:center;padding:2rem 0">No messages yet.</div>';
  }
  function guestBlockInnerV1(r, k) {
    var list = chatMsgs(r, chatField(k));
    return '<div class="pt-label" style="display:flex;align-items:center;gap:.6rem">Conversation<button class="pt-btn pt-btn-sm" id="cr-m-replybtn" type="button" style="margin-left:auto">Reply</button></div>' +
      (list.length ? chatHtml(list) : '<div class="pt-muted pt-small" style="margin-bottom:.8rem">No messages yet.</div>');
  }
  /* ----- chat row (like a WhatsApp chat list item) ----- */
  function unreadCount(r, k) {
    var list = chatMsgs(r, chatField(k)), rn = r.staffReadN;
    if (rn == null) { rn = 0; list.forEach(function (m, i) { if (m.from === 'staff') rn = i + 1; }); }   // no marker yet: up to the lodge's last message counts as read
    return list.slice(rn).filter(function (m) { return m.from === 'guest'; }).length;
  }
  function chatStamp(at) {
    if (!at) return '';
    var d = new Date(at), n = new Date();
    return d.toDateString() === n.toDateString() ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
  }
  function isClosedReq(r, k) { return k === 'faults' ? (r.status === 'resolved' || r.status === 'closed') : (r.status === 'delivered' || r.status === 'cancelled'); }
  function closedBar(r, k) {
    if (!isClosedReq(r, k)) return '';
    var on = r.chatOpen === true, st = esc(String(r.status).replace('_', ' '));
    return '<div class="pt-wa-closedbar' + (on ? ' on' : '') + '"><span>' + (on
      ? '<b>Chat re-activated.</b> The guest can reply even though this request is ' + st + '.'
      : '<b>The guest can’t reply.</b> This request is ' + st + ', so their message box is hidden.') +
      '</span><button type="button" class="cr-chatopen" data-on="' + (on ? '1' : '0') + '">' + (on ? 'Turn off' : 'Activate chat') + '</button></div>';
  }
  function chatRowHtml(r, k) {
    var list = chatMsgs(r, chatField(k)), last = list[list.length - 1], n = unreadCount(r, k);
    var prev = last ? (last.from === 'staff' ? 'You: ' : '') + (last.deleted ? 'This message was deleted' : last.text) : (r[chatField(k)] ? '📌 ' + r[chatField(k)] : 'No messages yet. Click to start.');
    return '<div class="pt-chatlist" id="cr-chatlist"><div class="pt-chatlist-title">Lodge conversation</div>' +
      '<button type="button" class="pt-chatrow' + (n ? ' unread' : '') + '" id="cr-chatrow" aria-label="Open conversation with ' + esc(r.name || 'guest') + (n ? ', ' + n + ' unread' : '') + '">' +
      '<span class="pt-chatav">' + esc(String(r.name || 'G').trim().charAt(0).toUpperCase()) + '</span>' +
      '<span class="pt-chatmain"><span class="pt-chatname">' + esc(r.name || 'Guest') + '</span><span class="pt-chatprev">' + esc(prev) + '</span></span>' +
      '<span class="pt-chatmeta"><span class="pt-chattime">' + esc(last ? chatStamp(last.at) : '') + '</span>' + (n ? '<span class="pt-chatbadge">' + n + '</span>' : '') + '</span></button>' + closedBar(r, k) + '</div>';
  }
  function refreshChatRow(r, k) { var el = $('cr-chatlist'); if (el) el.outerHTML = chatRowHtml(r, k); }
  function chatPopOpen() { var p = $('cr-chatpop'); return !!p && !p.classList.contains('pt-hide'); }
  function markRead(k, id) {
    var r = data[k].filter(function (x) { return x.id === id; })[0]; if (!r || !unreadCount(r, k)) return;
    P.db.collection(TABS[k].coll).doc(id).update({ staffReadN: chatMsgs(r, chatField(k)).length }).catch(function () {});
  }
  function applyChatSearch(go) {
    var g = $('cr-m-guest'), inp = $('cr-m-search'), bar = $('cr-m-searchbar'); if (!g) return;
    var q = inp ? inp.value.trim().toLowerCase() : '', on = !!(q && bar && !bar.classList.contains('pt-hide')), hits = [];
    [].forEach.call(g.querySelectorAll('.pt-msg'), function (el) {
      var t = el.querySelector('.pt-msg-text'), hit = !on || (t && t.textContent.toLowerCase().indexOf(q) !== -1);
      el.classList.toggle('pt-msg-dim', !hit); el.classList.remove('pt-msg-cur'); if (on && hit) hits.push(el);
    });
    if (openRef && (openRef.si == null || openRef.si < 0 || openRef.si >= hits.length)) openRef.si = hits.length - 1;
    var i = openRef ? openRef.si : -1;
    if (on && hits.length && i > -1) { hits[i].classList.add('pt-msg-cur'); if (go) hits[i].scrollIntoView({ block: 'center', behavior: 'smooth' }); }
    var c = $('cr-m-searchcount'); if (c) c.textContent = on ? (hits.length ? (i + 1) + ' of ' + hits.length : 'No results') : '';
    var bu = $('cr-m-searchup'), bd = $('cr-m-searchdown');
    if (bu) bu.disabled = !(on && hits.length > 1);
    if (bd) bd.disabled = !(on && hits.length > 1);
  }
  function guestReplyBlock(r) {
    return chatRowHtml(r, tab) +
      '<div id="cr-chatpop" class="pt-chatpop pt-hide"><div class="pt-chatpop-card"><div class="pt-wa">' +
      '<div class="pt-wa-head"><span>Conversation with ' + esc(r.name || 'guest') + '</span><button type="button" class="pt-wa-close" id="cr-chat-close" aria-label="Close conversation">✕</button></div>' +
      '<div id="cr-m-searchbar" class="pt-wa-search pt-hide"><input type="search" id="cr-m-search" placeholder="Search in this conversation" aria-label="Search in this conversation"><span id="cr-m-searchcount"></span><button type="button" id="cr-m-searchup" aria-label="Previous match"><i class="fas fa-chevron-up"></i></button><button type="button" id="cr-m-searchdown" aria-label="Next match"><i class="fas fa-chevron-down"></i></button><button type="button" id="cr-m-searchclose" aria-label="Close search">✕</button></div>' +
      '<div id="cr-m-pin">' + pinHtml(r, tab) + '</div>' +
      '<div id="cr-m-closedbar">' + closedBar(r, tab) + '</div>' +
      '<div id="cr-m-guest" class="pt-wa-body">' + guestBlockInner(r, tab) + '</div>' +
      '<div id="cr-m-replybar" class="pt-wa-reply pt-hide"></div><div id="cr-m-editbar" class="pt-wa-edit pt-hide"><span>Editing message</span><button type="button" id="cr-m-editcancel">Cancel</button></div><div class="pt-wa-compose"><textarea id="cr-m-compose-text" rows="1" placeholder="Type a message" maxlength="' + (tab === 'faults' ? 500 : 300) + '"></textarea>' +
      '<button class="pt-wa-send" id="cr-m-compose-send" type="button" aria-label="Send">➤</button></div></div></div></div>';
  }
  function guestReplyBlockPrev(r) {
    return '<div class="pt-wa"><div class="pt-wa-head">Conversation with ' + esc(r.name || 'guest') + '</div><div id="cr-m-pin">' + pinHtml(r, tab) + '</div>' +
      '<div id="cr-m-guest" class="pt-wa-body">' + guestBlockInner(r, tab) + '</div>' +
      '<div id="cr-m-replybar" class="pt-wa-reply pt-hide"></div><div id="cr-m-editbar" class="pt-wa-edit pt-hide"><span>Editing message</span><button type="button" id="cr-m-editcancel">Cancel</button></div><div class="pt-wa-compose"><textarea id="cr-m-compose-text" rows="1" placeholder="Type a message" maxlength="' + (tab === 'faults' ? 500 : 300) + '"></textarea>' +
      '<button class="pt-wa-send" id="cr-m-compose-send" type="button" aria-label="Send">➤</button></div></div>';
  }
  function guestReplyBlockV1(r) {
    return '<div id="cr-m-guest">' + guestBlockInner(r, tab) + '</div>' +
      '<div id="cr-m-compose" class="pt-hide"><div class="pt-field"><label for="cr-m-compose-text">Your message to the guest</label><textarea class="pt-textarea" id="cr-m-compose-text" style="min-height:80px" maxlength="' + (tab === 'faults' ? 500 : 300) + '"></textarea></div>' +
      '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-bottom:1rem"><button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-m-compose-cancel" type="button">Cancel</button><button class="pt-btn pt-btn-sm" id="cr-m-compose-send" type="button">Send</button></div></div>';
  }
  function guestReplyBlockOld(r) {
    return '<div id="cr-m-guest">' + guestBlockInner(r) + '</div>' +
      '<div id="cr-m-compose" class="pt-hide"><div class="pt-field"><label for="cr-m-compose-text">Your reply to the guest <span class="pt-muted">(replaces the note they currently see)</span></label><textarea class="pt-textarea" id="cr-m-compose-text" style="min-height:80px" maxlength="' + (tab === 'faults' ? 500 : 300) + '"></textarea></div>' +
      '<div style="display:flex;gap:.5rem;justify-content:flex-end;margin-bottom:1rem"><button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-m-compose-cancel" type="button">Cancel</button><button class="pt-btn pt-btn-sm" id="cr-m-compose-send" type="button">Send reply</button></div></div>';
  }

  /* ---------- tab definitions: one config drives the table, search, filter and CSV ---------- */
  var TABS = {
    faults: {
      label: 'Fault reports', coll: 'faultReports', statuses: ['new', 'seen', 'in_progress', 'resolved', 'closed'], fresh: ['new'],
      open: function (r) { return r.status !== 'resolved' && r.status !== 'closed'; },
      cols: [
        ['Received', when], ['Guest', who], ['Room', function (r) { return esc(r.room); }],
        ['Category', function (r) { return esc(r.category); }],
        ['Urgency', function (r) { return r.urgency === 'Urgent' ? '<span class="pt-badge bad">Urgent</span>' : esc(r.urgency || ''); }],
        ['Status', statusCell],
        ['Problem', function (r) { return esc(r.description); }, 'clip']
      ],
      text: function (r) { return [r.name, r.email, r.phone, r.room, r.category, r.description, r.bookingRef].join(' '); },
      csv: [['Received', function (r) { return when(r); }], ['Guest', function (r) { return r.name; }], ['Email', function (r) { return r.email; }], ['Phone', function (r) { return r.phone; }],
        ['Room', function (r) { return r.room; }], ['Booking', function (r) { return r.bookingRef; }], ['Category', function (r) { return r.category; }], ['Urgency', function (r) { return r.urgency; }],
        ['Status', function (r) { return r.status; }], ['Problem', function (r) { return r.description; }], ['Reply', function (r) { return r.adminResponse; }]]
    },
    laundry: {
      label: 'Laundry requests', coll: 'laundryRequests', statuses: ['requested', 'collected', 'processing', 'ready', 'delivered', 'cancelled'], fresh: ['requested'],
      open: function (r) { return ['requested', 'collected', 'processing', 'ready'].indexOf(r.status) !== -1; },
      cols: [
        ['Received', when], ['Guest', who], ['Room', function (r) { return esc(r.room); }],
        ['Items', function (r) { return pieces(r) + ' piece' + (pieces(r) === 1 ? '' : 's'); }],
        ['Service', function (r) { return esc(r.service); }], ['Collection', function (r) { return esc(r.slot); }],
        ['Status', statusCell]
      ],
      text: function (r) { return [r.name, r.email, r.phone, r.room, r.service, r.note, r.bookingRef].join(' '); },
      csv: [['Received', function (r) { return when(r); }], ['Guest', function (r) { return r.name; }], ['Email', function (r) { return r.email; }], ['Phone', function (r) { return r.phone; }],
        ['Room', function (r) { return r.room; }], ['Items', function (r) { return (r.items || []).map(function (i) { return i.qty + 'x ' + i.type; }).join('; '); }],
        ['Service', function (r) { return r.service; }], ['Collection', function (r) { return r.slot; }], ['Status', function (r) { return r.status; }],
        ['Charge', function (r) { return r.price; }], ['Guest note', function (r) { return r.note; }], ['Lodge note', function (r) { return r.adminNote; }]]
    },
    feedback: {
      label: 'Feedback & ratings', coll: 'feedback', statuses: ['draft', 'published', 'hidden'], fresh: ['draft'],
      open: function (r) { return r.status === 'draft'; },
      cols: [
        ['Received', when], ['Guest', function (r) { return '<b>' + esc(r.name || '—') + '</b>'; }],
        ['Stay', function (r) { return esc(r.room || 'General') + '<div class="pt-small pt-muted">' + esc(r.bookingRef || '') + '</div>'; }],
        ['Rating', function (r) { return P.starsRO(r.rating); }],
        ['Public?', function (r) { return r.showPublic ? 'Allowed' : '<span class="pt-muted">No</span>'; }],
        ['Status', function (r) { return P.statusBadge(r.status); }],
        ['Comment', function (r) { return esc(r.comment); }, 'clip']
      ],
      text: function (r) { return [r.name, r.room, r.comment, r.bookingRef].join(' '); },
      csv: [['Received', function (r) { return when(r); }], ['Guest', function (r) { return r.name; }], ['Room', function (r) { return r.room; }], ['Booking', function (r) { return r.bookingRef; }],
        ['Rating', function (r) { return r.rating; }], ['Cleanliness', function (r) { return (r.ratings || {}).cleanliness; }], ['Comfort', function (r) { return (r.ratings || {}).comfort; }],
        ['Staff', function (r) { return (r.ratings || {}).staff; }], ['Location', function (r) { return (r.ratings || {}).location; }], ['Value', function (r) { return (r.ratings || {}).value; }],
        ['Status', function (r) { return r.status; }], ['Comment', function (r) { return r.comment; }]]
    }
  };
  Object.keys(TABS).forEach(function (k) { ts[k] = { q: '', status: 'all', page: 1 }; });

  /* ---------- shell ---------- */
  function build() {
    $('cr-app').innerHTML =
      '<p class="pt-muted" style="margin:0 0 1rem">Reports, laundry and feedback from guests. Updates live.</p>' +
      '<div class="pt-kpis" id="cr-kpis"></div>' +
      '<div class="pt-tabs" role="tablist" id="cr-tabs"></div>' +
      '<div id="cr-err"></div>' +
      '<div class="cr-scrollbar pt-hide" id="cr-scrollbar"><label class="cr-switch" title="Scroll reviews on website"><input type="checkbox" id="cr-scroll" aria-label="Scroll reviews on the website"><span class="cr-knob"></span></label>' +
      '<div><b>Scrolling reviews on the website</b><div class="pt-small pt-muted">On: reviews slide across the homepage (shows up to 30). Off: a fixed grid of the latest 9.</div></div></div>' +
      '<div class="pt-tools"><input class="pt-input grow" id="cr-q" type="search" placeholder="Search name, e-mail, room, text…" aria-label="Search">' +
      '<select class="pt-select" id="cr-status" aria-label="Filter by status"></select>' +
      '<button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-csv" type="button">Export CSV</button></div>' +
      '<div class="pt-tablewrap"><table class="pt-table"><thead id="cr-head"></thead><tbody id="cr-body"></tbody></table></div>' +
      '<div class="pt-pager"><span id="cr-count"></span><span><button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-prev" type="button">‹ Prev</button> <button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-next" type="button">Next ›</button></span></div>';

    $('cr-q').addEventListener('input', function () { ts[tab].q = this.value; ts[tab].page = 1; renderTable(); });
    $('cr-status').addEventListener('change', function () { ts[tab].status = this.value; ts[tab].page = 1; renderTable(); });
    $('cr-prev').addEventListener('click', function () { ts[tab].page--; renderTable(); });
    $('cr-next').addEventListener('click', function () { ts[tab].page++; renderTable(); });
    $('cr-csv').addEventListener('click', exportCsv);
    $('cr-scroll').addEventListener('change', function () {
      var box = this, on = box.checked; box.disabled = true;
      P.db.collection('publicSettings').doc('reviews').set({ scroll: on, updatedAt: FV().serverTimestamp(), updatedBy: actor() }, { merge: true })
        .then(function () { P.toast(on ? 'Reviews now scroll on the website.' : 'Reviews are now static on the website.', 'ok'); })
        .catch(function (e) { box.checked = !on; P.toast(e && e.code === 'permission-denied' ? 'Permission denied. Publish the updated Firestore rules.' : 'Couldn’t save. Try again.', 'err'); })
        .then(function () { box.disabled = false; });
    });
    $('cr-tabs').addEventListener('click', function (e) { var b = e.target.closest('[data-tab]'); if (b) { tab = b.getAttribute('data-tab'); renderAll(); } });
    $('cr-body').addEventListener('click', function (e) {
      if (window.getSelection && String(window.getSelection())) return;
      var tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.getAttribute('data-id'));
    });
    $('cr-body').addEventListener('keydown', function (e) { if (e.key === 'Enter') { var tr = e.target.closest('tr[data-id]'); if (tr) openDetail(tr.getAttribute('data-id')); } });
  }

  function rows() { return data[tab]; }
  function fresh(k) { return data[k].filter(function (r) { return TABS[k].fresh.indexOf(r.status) !== -1 || hasNewReply(r); }).length; }

  function renderKpis() {
    var f = data.faults, l = data.laundry, fb = data.feedback;
    var urgent = f.filter(function (r) { return TABS.faults.open(r) && r.urgency === 'Urgent'; }).length;
    var rated = fb.filter(function (r) { return r.rating; }), avg = rated.length ? (rated.reduce(function (a, r) { return a + r.rating; }, 0) / rated.length) : 0;
    function k(n, label, alert) { return '<div class="pt-kpi' + (alert && n ? ' alert' : '') + '"><b>' + n + '</b><span>' + label + '</span></div>'; }
    $('cr-kpis').innerHTML =
      k(f.filter(TABS.faults.open).length, 'Open fault reports') + k(urgent, 'Urgent & unresolved', true) +
      k(l.filter(TABS.laundry.open).length, 'Laundry in progress') + k(fresh('feedback'), 'Feedback awaiting review') +
      '<div class="pt-kpi"><b>' + (avg ? avg.toFixed(1) + ' ★' : '—') + '</b><span>Average rating (' + rated.length + ')</span></div>' +
      k(fb.filter(function (r) { return r.status === 'published'; }).length, 'Published on website');
    var n = fresh('faults') + fresh('laundry') + fresh('feedback');
    document.title = (n ? '(' + n + ') ' : '') + 'Client Requests – GTEC Guest Lodge';
  }

  function renderTabs() {
    $('cr-tabs').innerHTML = Object.keys(TABS).map(function (k) {
      var n = fresh(k);
      return '<button type="button" role="tab" data-tab="' + k + '" aria-selected="' + (k === tab) + '">' + esc(TABS[k].label) + (n ? '<span class="n">' + n + '</span>' : '') + '</button>';
    }).join('');
  }

  function filtered() {
    var T = TABS[tab], s = ts[tab], q = s.q.trim().toLowerCase();
    return rows().filter(function (r) {
      if (s.status === 'open' ? !T.open(r) : s.status !== 'all' && r.status !== s.status) return false;
      return !q || T.text(r).toLowerCase().indexOf(q) !== -1;
    });
  }

  function renderTable() {
    var T = TABS[tab], s = ts[tab], list = filtered();
    var pages = Math.max(1, Math.ceil(list.length / PAGE)); s.page = Math.min(Math.max(1, s.page), pages);
    var from = (s.page - 1) * PAGE, slice = list.slice(from, from + PAGE);

    $('cr-q').value = s.q;
    $('cr-status').innerHTML = '<option value="all">All statuses</option><option value="open">Needs attention</option>' +
      T.statuses.map(function (x) { return '<option value="' + x + '">' + esc(x.replace('_', ' ')) + '</option>'; }).join('');
    $('cr-status').value = s.status;
    $('cr-head').innerHTML = '<tr>' + T.cols.map(function (c) { return '<th>' + esc(c[0]) + '</th>'; }).join('') + '</tr>';
    $('cr-body').innerHTML = slice.length ? slice.map(function (r) {
      var isNew = T.fresh.indexOf(r.status) !== -1 || hasNewReply(r);
      return '<tr data-id="' + esc(r.id) + '" tabindex="0" class="' + (isNew ? 'new' : '') + '">' + T.cols.map(function (c) {
        return '<td' + (c[2] ? ' class="' + c[2] + '"' : '') + '>' + c[1](r) + '</td>';
      }).join('') + '</tr>';
    }).join('') : '<tr><td colspan="' + T.cols.length + '" class="pt-empty">Nothing here.</td></tr>';
    $('cr-count').textContent = list.length ? (from + 1) + '–' + (from + slice.length) + ' of ' + list.length : '0 results';
    $('cr-prev').disabled = s.page <= 1; $('cr-next').disabled = s.page >= pages;
  }
  function renderAll() { renderKpis(); renderTabs(); renderTable(); $('cr-scrollbar').classList.toggle('pt-hide', tab !== 'feedback'); }

  function exportCsv() {
    var T = TABS[tab], list = filtered();
    var out = [T.csv.map(function (c) { return csvCell(c[0]); }).join(',')].concat(list.map(function (r) {
      return T.csv.map(function (c) { return csvCell(c[1](r)); }).join(',');
    }));
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob(['﻿' + out.join('\r\n')], { type: 'text/csv;charset=utf-8' }));
    a.download = tab + '-' + P.ymd(new Date()) + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
  }

  /* ---------- detail modal ---------- */
  function closeModal() { openRef = null; var m = $('cr-modal'); if (m) m.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key !== 'Escape') return; var m1 = $('cr-msgmenu'); if (m1) { m1.remove(); return; } var pp = $('cr-chatpop'); if (pp && !pp.classList.contains('pt-hide')) { pp.classList.add('pt-hide'); return; } closeModal(); }
  function contactLinks(r) {
    var wa = waNumber(r.phone), h = '';
    if (r.phone) h += '<a class="pt-btn pt-btn-ghost pt-btn-sm" href="tel:' + esc(r.phone) + '">Call</a> ';
    if (wa) h += '<a class="pt-btn pt-btn-ghost pt-btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(wa) + '">WhatsApp</a> ';
    if (r.email) h += '<a class="pt-btn pt-btn-ghost pt-btn-sm" href="mailto:' + esc(r.email) + '">E-mail</a>';
    return h;
  }
  function kv(pairs) {
    return '<dl class="pt-kv">' + pairs.map(function (p) { return '<dt>' + esc(p[0]) + '</dt><dd>' + (p[2] ? p[1] : esc(p[1] == null || p[1] === '' ? '—' : p[1])) + '</dd>'; }).join('') + '</dl>';
  }
  function statusSelect(T, cur) {
    return '<select class="pt-select" id="cr-m-status">' + T.statuses.map(function (s) { return '<option value="' + s + '"' + (s === cur ? ' selected' : '') + '>' + esc(s.replace('_', ' ')) + '</option>'; }).join('') + '</select>';
  }
  function actor() { var u = firebase.auth().currentUser; return (u && u.email) || ''; }

  function openModal(title, sub, body, footer) {
    closeModal();
    var bg = document.createElement('div'); bg.className = 'pt-modalbg'; bg.id = 'cr-modal';
    bg.innerHTML = '<div class="pt-modal" role="dialog" aria-modal="true" aria-label="' + esc(title) + '"><header><div><h2>' + esc(title) + '</h2><div class="pt-muted pt-small" id="cr-m-sub">' + sub + '</div></div>' +
      '<button class="pt-btn pt-btn-ghost pt-btn-sm" id="cr-m-x" type="button" aria-label="Close">✕</button></header><div class="mb">' + body + '</div><footer>' + footer + '</footer></div>';
    document.body.appendChild(bg);
    bg.addEventListener('mousedown', function (e) { if (e.target === bg) closeModal(); });
    $('cr-m-x').addEventListener('click', closeModal);
    document.addEventListener('keydown', onKey);
    return bg;
  }
  function save(btn, work, okMsg) {
    P.busy(btn, work).then(function () { P.toast(okMsg, 'ok'); closeModal(); })
      .catch(function (e) { P.toast(e && e.code === 'permission-denied' ? 'Permission denied. Check your Firestore rules.' : 'Couldn’t save. Try again.', 'err'); if (window.console) console.warn(e); });
  }

  function refreshModal(k) {
    if (!openRef || openRef.tab !== k || !$('cr-modal')) return;
    var r = data[k].filter(function (x) { return x.id === openRef.id; })[0]; if (!r) return;
    var g = $('cr-m-guest'), sub = $('cr-m-sub');
    if (sub) sub.innerHTML = esc(when(r)) + ' · ' + P.statusBadge(r.status);
    if (g) {
      var list = chatMsgs(r, chatField(k)), last = list[list.length - 1];
      var om = $('cr-msgmenu'); if (om) om.remove(); var st = g.scrollTop, atEnd = g.scrollHeight - st - g.clientHeight < 60;
      g.innerHTML = guestBlockInner(r, k);
      g.scrollTop = (atEnd || list.length > openRef.n) ? g.scrollHeight : st; var pn = $('cr-m-pin'); if (pn) pn.innerHTML = pinHtml(r, k); var cbar = $('cr-m-closedbar'); if (cbar) cbar.innerHTML = closedBar(r, k);
      if (list.length > openRef.n && last && last.from === 'guest') P.toast('The guest just replied.', 'ok');
      openRef.n = list.length; applyChatSearch(); refreshChatRow(r, k); if (chatPopOpen()) markRead(k, openRef.id);
    }
  }
  function refreshModalOld(k) {
    if (!openRef || openRef.tab !== k || !$('cr-modal')) return;
    var r = data[k].filter(function (x) { return x.id === openRef.id; })[0]; if (!r) return;
    var g = $('cr-m-guest'), sub = $('cr-m-sub');
    if (sub) sub.innerHTML = esc(when(r)) + ' · ' + P.statusBadge(r.status);
    if (g) {
      var before = g.textContent;
      g.innerHTML = guestBlockInner(r);
      if (r.guestReply && g.textContent !== before) P.toast('The guest just replied.', 'ok');
    }
  }
  function openDetail(id) {
    openDetailCore(id);
    var mm = $('cr-modal');
    if (!mm || tab === 'feedback') return;
    var k = tab, f = chatField(k);
    var r0 = data[k].filter(function (x) { return x.id === id; })[0] || {};
    openRef = { tab: k, id: id, n: chatMsgs(r0, f).length };

    /* conversation popup (opens from the chat row) */
    var pop = $('cr-chatpop'); if (pop) mm.appendChild(pop);      // direct child of the modal overlay, so it is never clipped
    function openChat() {
      var pp = $('cr-chatpop'); if (!pp) return;
      pp.classList.remove('pt-hide');
      var g0 = $('cr-m-guest'); if (g0) g0.scrollTop = g0.scrollHeight;
      markRead(k, id);
      var t0 = $('cr-m-compose-text'); if (t0) t0.focus();
    }
    function closeChat() {
      var o = $('cr-msgmenu'); if (o) o.remove();
      closeSearch();
      var pp = $('cr-chatpop'); if (pp) pp.classList.add('pt-hide');
      refreshChatRow(data[k].filter(function (x) { return x.id === id; })[0] || {}, k);
    }
    function openSearch() { var b = $('cr-m-searchbar'), i = $('cr-m-search'); if (!b) return; b.classList.remove('pt-hide'); openRef.si = -1; i.focus(); applyChatSearch(); }
    function closeSearch() { var b = $('cr-m-searchbar'), i = $('cr-m-search'); if (!b) return; b.classList.add('pt-hide'); if (i) i.value = ''; applyChatSearch(); }
    function stepHit(d) {
      var g1 = $('cr-m-guest'), inp = $('cr-m-search'); if (!g1 || !inp || !inp.value.trim()) return;
      var n = g1.querySelectorAll('.pt-msg:not(.pt-msg-dim)').length; if (!n) return;
      openRef.si = ((((openRef.si == null || openRef.si < 0) ? n - 1 : openRef.si) + d) % n + n) % n;
      applyChatSearch(true);
    }
    mm.addEventListener('input', function (e) { if (e.target.id === 'cr-m-search') { openRef.si = -1; applyChatSearch(true); } });
    mm.addEventListener('keydown', function (e) {
      if (e.target.id !== 'cr-m-search') return;
      if (e.key === 'Enter') { e.preventDefault(); stepHit(e.shiftKey ? 1 : -1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); stepHit(-1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); stepHit(1); }
    });

    /* WhatsApp-style message options: reaction bar + menu */
    var EMOJIS = ['👍', '❤️', '😂', '😮', '😢', '🙏'];
    function closeMsgMenu() { var o = $('cr-msgmenu'); if (o) o.remove(); }
    function curReq() { return data[k].filter(function (x) { return x.id === id; })[0] || {}; }
    function findMsg(at) { return chatMsgs(curReq(), f).filter(function (m) { return String(m.at) === String(at); })[0]; }
    function touch() { return { handledBy: actor(), updatedAt: FV().serverTimestamp() }; }
    function mapAt(at, change) { return function (list) { return list.map(function (m) { return String(m.at) === String(at) ? change(cp(m)) : m; }); }; }
    function fail(err) { P.toast(err && err.code === 'permission-denied' ? 'Permission denied. Check your Firestore rules.' : 'Couldn’t save. Try again.', 'err'); if (window.console) console.warn(err); }

    /* reads the latest thread first, so a guest message that just arrived is never overwritten */
    function mutate(fn, extra, okMsg) {
      var ref = P.db.collection(TABS[k].coll).doc(id);
      return P.db.runTransaction(function (tx) {
        return tx.get(ref).then(function (snap) {
          var upd = { thread: fn(chatMsgs(snap.data() || {}, f)) };
          Object.keys(extra || {}).forEach(function (x) { upd[x] = extra[x]; });
          tx.update(ref, upd);
        });
      }).then(function () { if (okMsg) P.toast(okMsg, 'ok'); }).catch(fail);
    }

    function doReact(at, emo) { mutate(mapAt(at, function (m) { if (m.react === emo) delete m.react; else m.react = emo; return m; })); }
    function doStar(at) {
      var m0 = findMsg(at); if (!m0) return;
      mutate(mapAt(at, function (m) { if (m.starred) delete m.starred; else m.starred = true; return m; }), null, m0.starred ? 'Unstarred.' : 'Starred.');
    }
    function doDelete(at) {
      if (!window.confirm('Delete this message for everyone?\nThe guest will see “This message was deleted”.')) return;
      mutate(mapAt(at, function (m) { return { from: m.from, text: 'This message was deleted', at: m.at, deleted: true }; }), touch(), 'Message deleted.');
    }
    function doPin(at) {
      var m0 = findMsg(at); if (!m0 || m0.deleted) return;
      var txt = String(m0.text).slice(0, k === 'faults' ? 500 : 300), same = (curReq()[f] || '') === txt;
      var upd = touch(); upd[f] = same ? '' : txt;
      P.db.collection(TABS[k].coll).doc(id).update(upd).then(function () {
        var ta = $('cr-m-reply'); if (ta) ta.value = upd[f];
        P.toast(same ? 'Unpinned.' : 'Pinned.', 'ok');
      }).catch(fail);
    }
    function doCopy(at) {
      var m0 = findMsg(at); if (!m0) return;
      function done() { P.toast('Copied.', 'ok'); }
      function fallback() {
        var t = document.createElement('textarea'); t.value = m0.text; t.style.cssText = 'position:fixed;opacity:0'; document.body.appendChild(t); t.select();
        try { document.execCommand('copy'); done(); } catch (x) { P.toast('Couldn’t copy.', 'err'); } t.remove();
      }
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(m0.text).then(done, fallback); else fallback();
    }
    function clearReply() { if (openRef) openRef.replyTo = null; var b = $('cr-m-replybar'); if (b) { b.innerHTML = ''; b.classList.add('pt-hide'); } }
    function startReply(at) {
      var m0 = findMsg(at); if (!m0 || m0.deleted) return;
      if (openRef.editAt) { openRef.editAt = null; $('cr-m-compose-text').value = ''; $('cr-m-editbar').classList.add('pt-hide'); }
      openRef.replyTo = { from: m0.from, text: String(m0.text).slice(0, 100) };
      var bar = $('cr-m-replybar');
      bar.innerHTML = '<div class="pt-wa-reply-q"><b>' + (m0.from === 'staff' ? 'You' : 'Guest') + '</b><span>' + esc(openRef.replyTo.text) + '</span></div><button type="button" id="cr-m-replycancel" aria-label="Cancel reply">✕</button>';
      bar.classList.remove('pt-hide'); $('cr-m-compose-text').focus();
    }
    function startEdit(at) {
      var m0 = findMsg(at); if (!m0 || m0.from !== 'staff' || m0.deleted) return;
      clearReply(); openRef.editAt = m0.at;
      var et = $('cr-m-compose-text'); et.value = m0.text; et.focus(); $('cr-m-editbar').classList.remove('pt-hide');
    }
    function showInfo(at, menu) {
      var m0 = findMsg(at); if (!m0) return closeMsgMenu();
      var rows = [['From', m0.from === 'staff' ? 'You (staff)' : 'Guest'], ['Sent', P.fmtDateTime(new Date(m0.at))], ['Edited', m0.edited ? 'Yes' : 'No'], ['Starred', m0.starred ? 'Yes' : 'No']];
      if (m0.from === 'staff') {
        var allM = chatMsgs(curReq(), f), ix = -1, rdN = curReq().guestReadN;
        allM.forEach(function (x, i) { if (String(x.at) === String(m0.at)) ix = i; });
        rows.push(['Seen', rdN != null && ix > -1 && rdN > ix ? 'Yes' : 'Not yet']);
      }
      if (m0.react) rows.push(['Reaction', m0.react]);
      menu.innerHTML = '<div class="pt-wamenu-list pt-wamenu-info"><h4>Message info</h4><dl>' + rows.map(function (r) { return '<dt>' + esc(r[0]) + '</dt><dd>' + esc(r[1]) + '</dd>'; }).join('') + '</dl></div>';
    }
    function item(act, icon, label, cls) { return '<button type="button" role="menuitem" data-act="' + act + '"' + (cls ? ' class="' + cls + '"' : '') + '><i class="fas ' + icon + '"></i> ' + label + '</button>'; }

    function openMenu(arrow) {
      var at = arrow.getAttribute('data-menu'), m0 = findMsg(at); if (!m0) return;
      var me = m0.from === 'staff', rc = arrow.getBoundingClientRect();
      var pinned = (curReq()[f] || '') === String(m0.text).slice(0, k === 'faults' ? 500 : 300);
      var menu = document.createElement('div');
      menu.id = 'cr-msgmenu'; menu.className = 'pt-wamenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('data-for', at);
      menu.innerHTML =
        '<div class="pt-wamenu-bar">' + EMOJIS.map(function (em) { return '<button type="button" data-react="' + em + '"' + (m0.react === em ? ' class="on"' : '') + ' aria-label="React ' + em + '">' + em + '</button>'; }).join('') + '</div>' +
        '<div class="pt-wamenu-list">' +
          item('info', 'fa-circle-info', 'Message info') + item('search', 'fa-magnifying-glass', 'Search') + item('reply', 'fa-reply', 'Reply') + item('copy', 'fa-copy', 'Copy') +
          item('pin', 'fa-thumbtack', pinned ? 'Unpin' : 'Pin') + item('star', 'fa-star', m0.starred ? 'Unstar' : 'Star') +
          (me ? item('edit', 'fa-pen', 'Edit') + '<hr>' + item('delete', 'fa-trash', 'Delete', 'danger') : '') +
        '</div>';
      menu.style.visibility = 'hidden';
      mm.appendChild(menu);
      var mh = menu.offsetHeight, mw = menu.offsetWidth;
      var top = rc.bottom + 4;
      if (top + mh > window.innerHeight - 8) top = rc.top - mh - 4;
      top = Math.max(8, Math.min(top, window.innerHeight - mh - 8));
      var left = Math.min(Math.max(8, rc.right - mw), window.innerWidth - mw - 8);
      menu.style.top = top + 'px'; menu.style.left = left + 'px'; menu.style.visibility = '';
    }

    mm.addEventListener('click', function (e) {
      if (e.target.closest('#cr-chatrow')) { openChat(); return; }
      if (e.target.closest('#cr-chat-close') || e.target.id === 'cr-chatpop') { closeChat(); return; }
      if (e.target.closest('#cr-m-searchclose')) { closeSearch(); return; }
      if (e.target.closest('#cr-m-searchup')) { stepHit(-1); return; }
      if (e.target.closest('#cr-m-searchdown')) { stepHit(1); return; }
      if (e.target.closest('#cr-m-replycancel')) { clearReply(); return; }
      var menu = $('cr-msgmenu');
      if (menu && menu.contains(e.target)) {
        e.stopPropagation();
        var at = menu.getAttribute('data-for'), rb = e.target.closest('[data-react]'), ab = e.target.closest('[data-act]');
        if (rb) { closeMsgMenu(); doReact(at, rb.getAttribute('data-react')); return; }
        if (!ab) return;
        var act = ab.getAttribute('data-act');
        if (act === 'info') { showInfo(at, menu); return; }
        closeMsgMenu();
        if (act === 'reply') startReply(at);
        else if (act === 'copy') doCopy(at);
        else if (act === 'pin') doPin(at);
        else if (act === 'star') doStar(at);
        else if (act === 'edit') startEdit(at);
        else if (act === 'delete') doDelete(at);
        else if (act === 'search') openSearch();
        return;
      }
      var arrow = e.target.closest('[data-menu]');
      if (menu) menu.remove();
      if (!arrow) return;
      if (menu && menu.getAttribute('data-for') === arrow.getAttribute('data-menu')) return;
      openMenu(arrow);
    }, true);

    /* old single-item menu, switched off (kept only so no other line has to be deleted) */
    function oldMenuUnused() {
    function closeMsgMenu() { var o = $('cr-msgmenu'); if (o) o.remove(); }
    mm.addEventListener('click', function (e) {
      var old = $('cr-msgmenu');
      var arrow = e.target.closest('[data-menu]');
      if (old) old.remove();                                   // any click closes an open menu
      if (!arrow) return;
      var at = arrow.getAttribute('data-menu');
      if (old && old.getAttribute('data-for') === at) return;  // clicking the same arrow again = toggle off
      var rc = arrow.getBoundingClientRect();
      var menu = document.createElement('div');
      menu.id = 'cr-msgmenu'; menu.className = 'pt-msgmenu'; menu.setAttribute('role', 'menu'); menu.setAttribute('data-for', at);
      menu.innerHTML = '<button type="button" role="menuitem" data-edit="' + esc(at) + '"><i class="fas fa-pen"></i> Edit</button>';
      menu.style.visibility = 'hidden';
      mm.appendChild(menu);
      var mh = menu.offsetHeight, mw = menu.offsetWidth;
      var top = rc.bottom + 4;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, rc.top - mh - 4);   // flip up if no room below
      var left = Math.min(Math.max(8, rc.right - mw), window.innerWidth - mw - 8);  // right edge lines up with the arrow
      menu.style.top = top + 'px';
      menu.style.left = left + 'px';
      menu.style.visibility = '';
    }, true);
    }
    mm.addEventListener('click', function (e) {
      var cb = e.target.closest('.cr-chatopen'); if (!cb) return;
      var turnOn = cb.getAttribute('data-on') !== '1';
      if (turnOn && !window.confirm('Let the guest message you again on this ' + (k === 'faults' ? 'report' : 'request') + '?\n\nOnly do this if it is urgent or necessary.')) return;
      P.busy(cb, function () { return P.db.collection(TABS[k].coll).doc(id).update({ chatOpen: turnOn }); })
        .then(function () { P.toast(turnOn ? 'Chat activated. The guest can reply now.' : 'Chat turned off.', 'ok'); })
        .catch(fail);
    });
    mm.addEventListener('scroll', closeMsgMenu, true);   // capture: catches the chat box and the modal body
    var c0 = $('cr-m-guest'); if (c0) c0.scrollTop = c0.scrollHeight;
    mm.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'cr-m-compose-text') { e.preventDefault(); var sb = $('cr-m-compose-send'); if (sb) sb.click(); } });
    mm.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-edit')) { var at = +b.getAttribute('data-edit'); var em = chatMsgs(data[k].filter(function (x) { return x.id === id; })[0] || {}, f).filter(function (m) { return m.from === 'staff' && m.at === at; })[0]; if (em) { openRef.editAt = at; var et = $('cr-m-compose-text'); et.value = em.text; et.focus(); $('cr-m-editbar').classList.remove('pt-hide'); } }
      else if (b.id === 'cr-m-editcancel') { openRef.editAt = null; $('cr-m-compose-text').value = ''; $('cr-m-editbar').classList.add('pt-hide'); }
      else if (b.id === 'cr-m-compose-cancel') { $('cr-m-compose').classList.add('pt-hide'); }
      else if (b.id === 'cr-m-compose-send') {
        var ta = $('cr-m-compose-text'), text = ta.value.trim();
        if (!text) return P.toast('Type your message first.', 'err');
        text = text.slice(0, k === 'faults' ? 500 : 300);
        var cur = data[k].filter(function (x) { return x.id === id; })[0] || {};
        var upd = { thread: (openRef && openRef.editAt) ? editStaff(cur, f, openRef.editAt, text) : withStaff(cur, f, text, openRef && openRef.replyTo), handledBy: actor(), updatedAt: FV().serverTimestamp() };
        /* the pinned note is saved separately */
        P.busy(b, function () { return P.db.collection(TABS[k].coll).doc(id).update(upd); }).then(function () {
          if (openRef) openRef.editAt = null; var eb = $('cr-m-editbar'); if (eb) eb.classList.add('pt-hide');
          ta.value = '';
          P.toast('Message sent to the guest.', 'ok'); clearReply();
        }).catch(function (err) {
          P.toast(err && err.code === 'permission-denied' ? 'Permission denied. Check your Firestore rules.' : 'Couldn’t send. Try again.', 'err');
          if (window.console) console.warn(err);
        });
      }
    });
  }
  function openDetailOld(id) {
    openDetailCore(id);
    var mm = $('cr-modal');
    if (!mm || tab === 'feedback') return;
    var k = tab;
    openRef = { tab: k, id: id };
    mm.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.shiftKey && e.target.id === 'cr-m-compose-text') { e.preventDefault(); var sb = $('cr-m-compose-send'); if (sb) sb.click(); } });
    mm.addEventListener('click', function (e) {
      var b = e.target.closest('button'); if (!b) return;
      if (b.hasAttribute('data-edit')) { var at = +b.getAttribute('data-edit'); var em = chatMsgs(data[k].filter(function (x) { return x.id === id; })[0] || {}, f).filter(function (m) { return m.from === 'staff' && m.at === at; })[0]; if (em) { openRef.editAt = at; var et = $('cr-m-compose-text'); et.value = em.text; et.focus(); $('cr-m-editbar').classList.remove('pt-hide'); } }
      else if (b.id === 'cr-m-editcancel') { openRef.editAt = null; $('cr-m-compose-text').value = ''; $('cr-m-editbar').classList.add('pt-hide'); }
      else if (b.id === 'cr-m-compose-cancel') { $('cr-m-compose').classList.add('pt-hide'); }
      else if (b.id === 'cr-m-compose-send') {
        var ta = $('cr-m-compose-text'), text = ta.value.trim();
        if (!text) return P.toast('Type your reply first.', 'err');
        text = text.slice(0, k === 'faults' ? 500 : 300);
        var upd = { guestReply: FV().delete(), guestReplyAt: FV().delete(), handledBy: actor(), updatedAt: FV().serverTimestamp() };
        upd[k === 'faults' ? 'adminResponse' : 'adminNote'] = text;
        P.busy(b, function () { return P.db.collection(TABS[k].coll).doc(id).update(upd); }).then(function () {
          if (openRef) openRef.editAt = null; var eb = $('cr-m-editbar'); if (eb) eb.classList.add('pt-hide');
          ta.value = '';
          P.toast('Reply sent to the guest.', 'ok');
        }).catch(function (err) {
          P.toast(err && err.code === 'permission-denied' ? 'Permission denied. Check your Firestore rules.' : 'Couldn’t send. Try again.', 'err');
          if (window.console) console.warn(err);
        });
      }
    });
  }
  function openDetailCore(id) {
    var r = data[tab].filter(function (x) { return x.id === id; })[0]; if (!r) return;
    var T = TABS[tab], ref = P.db.collection(T.coll).doc(id), m;

    if (tab === 'faults') {
      m = openModal(r.category + ' · ' + r.room, esc(when(r)) + ' · ' + P.statusBadge(r.status),
        kv([['Guest', r.name], ['E-mail', r.email], ['Phone', r.phone], ['Booking', r.bookingRef], ['Urgency', r.urgency]]) +
        '<div class="pt-label">Problem</div><div class="pt-quote">' + esc(r.description) + '</div>' + guestReplyBlock(r) +
        '<div class="pt-row cols-2"><div class="pt-field"><label for="cr-m-status">Status</label>' + statusSelect(T, r.status) + '</div></div>' +
        '<div class="pt-field"><label for="cr-m-reply">📌 Pinned note to guest <span class="pt-muted">(shown at the top of the chat, press Save)</span></label><textarea class="pt-textarea" id="cr-m-reply" maxlength="500">' + esc(r.adminResponse || '') + '</textarea></div>',
        '<span style="margin-right:auto">' + contactLinks(r) + '</span><button class="pt-btn" id="cr-m-save" type="button">Save</button>');
      $('cr-m-save').addEventListener('click', function () {
        var cur = data.faults.filter(function (x) { return x.id === id; })[0] || r;
        var txt = $('cr-m-reply').value.trim().slice(0, 500), upd = { status: $('cr-m-status').value, adminResponse: txt, handledBy: actor(), updatedAt: FV().serverTimestamp() };
        /* pinned note: not added to the chat */
        save(this, function () { return ref.update(upd); }, 'Report updated.');
      });
    }

    if (tab === 'laundry') {
      m = openModal(r.service + ' · ' + r.room, esc(when(r)) + ' · ' + P.statusBadge(r.status),
        kv([['Guest', r.name], ['E-mail', r.email], ['Phone', r.phone], ['Booking', r.bookingRef], ['Collection', r.slot], ['Guest note', r.note]]) +
        guestReplyBlock(r) + '<div class="pt-label">Items</div><div class="pt-quote">' + ((r.items || []).map(function (i) { return esc(i.qty) + ' × ' + esc(i.type); }).join('\n') || '—') + '</div>' +
        '<div class="pt-row cols-2"><div class="pt-field"><label for="cr-m-status">Status</label>' + statusSelect(T, r.status) + '</div>' +
        '<div class="pt-field"><label for="cr-m-price">Charge (' + esc(P.CFG.lodge.currency) + ')</label><input class="pt-input" id="cr-m-price" type="number" min="0" step="0.01" value="' + esc(r.price != null ? r.price : '') + '"></div></div>' +
        '<div class="pt-field"><label for="cr-m-reply">📌 Pinned note to guest <span class="pt-muted">(shown at the top of the chat, press Save)</span></label><textarea class="pt-textarea" id="cr-m-reply" style="min-height:80px" maxlength="300">' + esc(r.adminNote || '') + '</textarea></div>',
        '<span style="margin-right:auto">' + contactLinks(r) + '</span><button class="pt-btn" id="cr-m-save" type="button">Save</button>');
      $('cr-m-save').addEventListener('click', function () {
        var pr = $('cr-m-price').value, upd = { status: $('cr-m-status').value, adminNote: $('cr-m-reply').value.trim().slice(0, 300), handledBy: actor(), updatedAt: FV().serverTimestamp() };
        var cur = data.laundry.filter(function (x) { return x.id === id; })[0] || r;
        /* pinned note: not added to the chat */
        if (pr !== '') { if (!(Number(pr) >= 0)) return P.toast('Enter a valid charge.', 'err'); upd.price = Math.round(Number(pr) * 100) / 100; }
        save(this, function () { return ref.update(upd); }, 'Laundry request updated.');
      });
    }

    if (tab === 'feedback') {
      var rt = r.ratings || {}, labels = { cleanliness: 'Cleanliness', comfort: 'Comfort', staff: 'Staff & service', location: 'Location', value: 'Value' };
      var consent = !!r.showPublic;
      m = openModal((r.name || 'Guest') + ' · ' + (r.room || 'General feedback'), esc(when(r)) + ' · ' + P.statusBadge(r.status),
        kv([['Overall', P.starsRO(r.rating), true]].concat(Object.keys(labels).filter(function (k) { return rt[k]; }).map(function (k) { return [labels[k], P.starsRO(rt[k]), true]; }))
          .concat([['Booking', r.bookingRef], ['Guest allows public display', consent ? 'Yes' : 'No']])) +
        '<div class="pt-label">Guest’s comment</div><div class="pt-quote">' + esc(r.comment || '(no comment)') + '</div>' +
        '<hr style="border:0;border-top:1px solid var(--pt-line);margin:1rem 0"><h3 style="margin-bottom:.6rem">Website version</h3>' +
        (consent ? '' : '<div class="pt-alert warn">This guest did not allow their comment to be shown publicly, so it can’t be published.</div>') +
        '<div class="pt-field"><label for="cr-m-name">Name shown</label><input class="pt-input" id="cr-m-name" maxlength="40" value="' + esc(r.publicName || 'Guest') + '"></div>' +
        '<div class="pt-field"><label for="cr-m-text">Text shown <span class="pt-muted">(trim or fix typos – keep the guest’s meaning)</span></label><textarea class="pt-textarea" id="cr-m-text" maxlength="800">' + esc(r.publicText != null ? r.publicText : r.comment || '') + '</textarea></div>',
        '<button class="pt-btn pt-btn-danger" id="cr-m-hide" type="button">Hide</button><span style="margin-right:auto"></span>' +
        '<button class="pt-btn pt-btn-ghost" id="cr-m-draft" type="button">' + (r.status === 'published' ? 'Unpublish (back to draft)' : 'Save as draft') + '</button>' +
        '<button class="pt-btn pt-btn-accent" id="cr-m-pub" type="button"' + (consent && r.rating ? '' : ' disabled') + '>' + (r.status === 'published' ? 'Update on website' : 'Publish to website') + '</button>');

      var pub = P.db.collection('publicReviews').doc(id);
      function texts() { return { publicName: ($('cr-m-name').value.trim() || 'Guest').slice(0, 40), publicText: $('cr-m-text').value.trim().slice(0, 800) }; }
      function stamp(o) { o.reviewedBy = actor(); o.updatedAt = FV().serverTimestamp(); return o; }

      $('cr-m-pub').addEventListener('click', function () {
        var t = texts(); if (!t.publicText) return P.toast('Add the text to show on the website.', 'err');
        save(this, function () {
          var b = P.db.batch();
          b.set(pub, { rating: r.rating, name: t.publicName, text: t.publicText, publishedAt: r.publishedAt || FV().serverTimestamp() });
          b.update(ref, stamp({ status: 'published', publicName: t.publicName, publicText: t.publicText, publishedAt: r.publishedAt || FV().serverTimestamp() }));
          return b.commit();
        }, 'Published on the website.');
      });
      $('cr-m-draft').addEventListener('click', function () {
        var t = texts();
        save(this, function () { var b = P.db.batch(); b.delete(pub); b.update(ref, stamp({ status: 'draft', publicName: t.publicName, publicText: t.publicText })); return b.commit(); }, r.status === 'published' ? 'Removed from the website.' : 'Saved as draft.');
      });
      $('cr-m-hide').addEventListener('click', function () {
        save(this, function () { var b = P.db.batch(); b.delete(pub); b.update(ref, stamp({ status: 'hidden' })); return b.commit(); }, 'Hidden. It will not appear on the website.');
      });
    }
  }

  /* ---------- data (live) ---------- */
  function listen() {
    P.db.collection('publicSettings').doc('reviews').onSnapshot(function (d) {
      var box = $('cr-scroll'); if (box) box.checked = !!(d.exists && d.data().scroll);
    }, function () {});
    Object.keys(TABS).forEach(function (k) {
      P.db.collection(TABS[k].coll).orderBy('createdAt', 'desc').limit(MAX_DOCS).onSnapshot(function (qs) {
        var out = []; qs.forEach(function (d) { var x = d.data(); x.id = d.id; x._ts = P.toDate(x.createdAt); out.push(x); });
        data[k] = out; $('cr-err').innerHTML = ''; renderAll(); refreshModal(k);
      }, function (e) {
        $('cr-err').innerHTML = '<div class="pt-alert err">Couldn’t read ' + esc(TABS[k].label.toLowerCase()) + ' (' + esc(e.code || 'error') + '). Deploy the portal rules from PORTAL_SETUP.md and check your role.</div>';
      });
    });
  }

  var started = false;
  function start() { if (started) return; started = true; $('cr-loading').classList.add('pt-hide'); $('cr-app').classList.remove('pt-hide'); build(); renderAll(); listen(); }
  function deny(msg) { $('cr-loading').classList.add('pt-hide'); var d = $('cr-denied'); d.textContent = msg || 'Client requests are available to Super Admin and Admin accounts only.'; d.classList.remove('pt-hide'); }
  function waitForRole() {
    var tries = 0, t = setInterval(function () {
      tries++;
      if (window._userRole) { clearInterval(t); ALLOWED_ROLES.indexOf(window._userRole) !== -1 ? start() : deny(); }
      else if (tries > 80) { clearInterval(t); deny('Could not verify your role. Reload the page.'); }
    }, 100);
  }

  document.addEventListener('DOMContentLoaded', function () {
    try { P.init(); } catch (e) { deny(e.message); return; }
    firebase.auth().onAuthStateChanged(function (u) { if (u) waitForRole(); else $('cr-loading').textContent = 'Please sign in to the admin dashboard first.'; });
  });
})();
