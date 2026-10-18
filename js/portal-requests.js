/* Guest requests: Report a fault, Request laundry, Feedback & ratings.
   Each write goes straight to Firestore; the security rules (see firestore.rules.portal.txt) check
   ownership, allowed fields, starting status and field sizes. */
(function () {
  'use strict';
  var P = window.Portal, esc = P.esc, CFG = P.CFG, FV = function () { return firebase.firestore.FieldValue; };

  /* ---------- shared bits ---------- */
  function stayOptions(ctx, selectedId) {
    var list = ctx.stays.filter(function (s) { return !s.cancelled; });
    var best = selectedId || (list.filter(function (s) { return P.stayPhase(s) === 'current'; })[0] || list[0] || {}).id;
    return list.map(function (s) {
      return '<option value="' + esc(s.id) + '"' + (s.id === best ? ' selected' : '') + '>' + esc(s.room) + ' · ' + esc(s.ref) + ' (' + esc(P.fmtShort(s.checkIn)) + ' → ' + esc(P.fmtShort(s.checkOut)) + ')</option>';
    }).join('') + '<option value=""' + (!best ? ' selected' : '') + '>Not linked to a booking</option>';
  }
  function stayById(ctx, id) { return ctx.stays.filter(function (s) { return s.id === id; })[0] || null; }
  function who(ctx) { return { name: String(ctx.profile.name || ctx.user.displayName || '').slice(0, 80), email: String(ctx.user.email || '').toLowerCase(), phone: String(ctx.profile.phone || '') }; }
  function phoneField(ctx) {
    return '<div class="pt-field"><label for="f-phone">Phone / WhatsApp</label><input class="pt-input" id="f-phone" type="tel" inputmode="tel" maxlength="20" value="' + esc(ctx.profile.phone || '') + '" placeholder="So we can reach you"><div class="pt-err" id="f-phone-err"></div></div>';
  }
  function cleanPhone(v) { v = String(v || '').replace(/[\s\-()]/g, ''); return /^\+?\d{9,15}$/.test(v) ? v : null; }
  function setErr(id, t) { var e = document.getElementById(id); if (e) e.textContent = t || ''; return !t; }
  function steps(order, status) {
    var i = order.indexOf(status); if (i < 0) return '';
    return '<div class="pt-steps" aria-hidden="true">' + order.map(function (_, k) { return '<i class="' + (k <= i ? 'on' : '') + '"></i>'; }).join('') + '</div>';
  }
  function fail(e) { P.toast(e && e.code === 'permission-denied' ? 'Not allowed. Please sign in again and retry.' : 'Couldn’t save. Check your connection and try again.', 'err'); if (window.console) console.warn(e); }

  /* ---------- chat thread (shared by fault + laundry) ---------- */
  function chatMsgs(r, field) {
    var t = Array.isArray(r.thread) ? r.thread.slice() : [];
    var pre = [];
    /* the note is now a pinned message */
    if (!t.length && r.guestReply) { var g = P.toDate(r.guestReplyAt); pre.push({ from: 'guest', text: r.guestReply, at: g ? +g : null }); }
    return pre.concat(t);
  }
  function chatHtml(list) {
    return '<div class="pt-chat">' + list.map(function (m) {
      var me = m.from === 'guest';
      return '<div class="pt-msg ' + (me ? 'me' : 'them') + '"><div class="pt-msg-who">' + (me ? 'You' : 'Lodge') + (m.at ? ' · ' + esc(P.fmtDateTime(new Date(m.at))) : '') + (m.edited ? ' · edited' : '') + '</div>' + esc(m.text) + '</div>';
    }).join('') + '</div>';
  }

  /* ---------- WhatsApp-style conversation box (same look as the admin modal) ---------- */
  function waBox(pin, cm, canReply, taAttr, sendAttr, id, draft) {
    return '<div class="pt-wa"><div class="pt-wa-head">Conversation with the Lodge</div>' + pin +
      '<div class="pt-wa-body">' + (cm.length ? chatHtml(cm) : '<div class="pt-muted pt-small" style="text-align:center;padding:2rem 0">No messages yet.</div>') + '</div>' +
      (canReply
        ? '<div class="pt-wa-compose"><textarea id="' + taAttr + '-' + esc(id) + '" data-' + taAttr + '="' + esc(id) + '" rows="1" maxlength="300" placeholder="Type a message">' + esc(draft || '') + '</textarea>' +
          '<button class="pt-wa-send" type="button" data-' + sendAttr + '="' + esc(id) + '" aria-label="Send">➤</button></div>'
        : '') +
      '</div>';
  }
  document.addEventListener('keydown', function (e) {          /* Enter sends, Shift+Enter = new line */
    if (e.key === 'Enter' && !e.shiftKey && e.target.tagName === 'TEXTAREA' && e.target.closest && e.target.closest('.pt-wa-compose')) {
      e.preventDefault();
      var b = e.target.parentNode.querySelector('.pt-wa-send'); if (b) b.click();
    }
  });

  /* =========================================================== FAULT */
  P.sections.fault = {
    intro: 'Something not working? Tell us and the team will take care of it.',
    render: function (ctx, root) {
      var C = CFG.fault;
      root.innerHTML =
        '<div class="pt-card"><h2>New report</h2><form id="f-form" novalidate>' +
        '<div class="pt-row cols-2"><div class="pt-field"><label for="f-stay">Booking</label><select class="pt-select" id="f-stay">' + stayOptions(ctx) + '</select></div>' +
        '<div class="pt-field"><label for="f-room">Room / location</label><input class="pt-input" id="f-room" maxlength="60" placeholder="e.g. Room 4, corridor, lounge"><div class="pt-err" id="f-room-err"></div></div></div>' +
        '<div class="pt-field"><span class="pt-label">What is it about? (tick all that apply)</span><div class="pt-checks">' + C.categories.map(function (c) { return '<label class="pt-check"><input type="checkbox" name="f-cat" value="' + esc(c) + '"> <span>' + esc(c) + '</span></label>'; }).join('') + '</div><div class="pt-err" id="f-cat-err"></div></div>' +
        '<div class="pt-field"><label for="f-urg">How urgent?</label><select class="pt-select" id="f-urg">' + C.urgencies.map(function (c) { return '<option' + (c === 'Normal' ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select><div class="pt-hint">Choose Urgent only for safety problems or no water/power.</div></div>' +
        '<div class="pt-field"><label for="f-desc">Describe the problem</label><textarea class="pt-textarea" id="f-desc" maxlength="1000" placeholder="What happened, and when did you notice it?"></textarea><div class="pt-hint"><span id="f-count">0</span>/1000</div><div class="pt-err" id="f-desc-err"></div></div>' +
        phoneField(ctx) +
        '<button class="pt-btn" id="f-submit" type="submit">Send report</button></form></div>' +
        '<div class="pt-card"><h2>My reports</h2><div id="f-list"></div></div>';

      var stay = root.querySelector('#f-stay'), room = root.querySelector('#f-room');
      function syncRoom() { var s = stayById(ctx, stay.value); if (s) room.value = s.room; }
      syncRoom(); stay.addEventListener('change', syncRoom);
      var desc = root.querySelector('#f-desc');
      desc.addEventListener('input', function () { root.querySelector('#f-count').textContent = desc.value.length; });

      root.querySelector('#f-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var d = desc.value.trim(), r = room.value.trim(), ph = cleanPhone(root.querySelector('#f-phone').value);
        var ok = setErr('f-room-err', r ? '' : 'Tell us where the problem is.');
        ok = setErr('f-desc-err', d.length >= 10 ? '' : 'Please describe the problem (at least 10 characters).') && ok;
        ok = setErr('f-phone-err', ph ? '' : 'Enter a valid phone number.') && ok;
        var cats = Array.prototype.map.call(root.querySelectorAll('input[name="f-cat"]:checked'), function (x) { return x.value; });
        ok = setErr('f-cat-err', cats.length ? '' : 'Choose at least one category.') && ok;
        if (!ok) return;
        var wait = P.cooldown('fault', 20); if (wait) return P.toast('Please wait ' + wait + 's before sending another report.', 'err');
        var s = stayById(ctx, stay.value), w = who(ctx);
        P.busy(root.querySelector('#f-submit'), function () {
          return P.db.collection('faultReports').add({
            uid: ctx.user.uid, name: w.name, email: w.email, phone: ph,
            bookingRef: s ? s.ref : '', room: r.slice(0, 60),
            category: cats.join(', ').slice(0, 200), urgency: root.querySelector('#f-urg').value,
            description: d, status: 'new', createdAt: FV().serverTimestamp()
          }).then(function () { return ctx.reload('faults'); }).then(function () {
            P.toast('Report sent. We’ll update the status here.', 'ok'); P.rerender();
          });
        }).catch(fail);
      });

      var list = root.querySelector('#f-list');
      var drafts = {};      /* reply text being typed, kept while the list repaints */
      var seen = null;      /* last known status/reply per report, to announce changes */
      stopLive();

      function paintList() {
        var act = document.activeElement;
        var actId = act && act.getAttribute ? act.getAttribute('data-freply') : null;
        var pos = actId ? act.selectionStart : 0;

        list.innerHTML = !ctx.faults.length ? '<div class="pt-empty">You haven’t reported anything.</div>' :
          '<ul class="pt-list">' + ctx.faults.map(function (f) {
            var open = f.status !== 'resolved' && f.status !== 'closed';
            var reply = '';
            var cm = chatMsgs(f, 'adminResponse'); var pin = f.adminResponse ? '<div class="pt-pin">📌 <b>Lodge note:</b> ' + esc(f.adminResponse) + '</div>' : '';
            if (cm.length || pin) {
              reply = waBox(pin, cm, open && (pin || cm.some(function (m) { return m.from === 'staff'; })), 'freply', 'send-freply', f.id, drafts[f.id]);
            }
            return '<li class="pt-item"><div class="pt-item-top"><div><b>' + esc(f.category) + '</b> <span class="pt-muted pt-small">· ' + esc(f.room) + ' · ' + esc(P.fmtDateTime(f._ts)) + '</span></div>' +
              '<div>' + (f.urgency === 'Urgent' ? '<span class="pt-badge bad">Urgent</span> ' : '') + P.statusBadge(f.status) + '</div></div>' +
              '<p>' + esc(f.description) + '</p>' + steps(['new', 'seen', 'in_progress', 'resolved'], f.status) +
              reply + '</li>';
          }).join('') + '</ul>';

        list.querySelectorAll('.pt-wa-body').forEach(function (b) { b.scrollTop = b.scrollHeight; });
        if (actId) {
          var ta = list.querySelector('textarea[data-freply="' + actId + '"]');
          if (ta) { ta.focus(); try { ta.setSelectionRange(pos, pos); } catch (e) {} }
        }
      }

      list.addEventListener('input', function (e) {
        var id = e.target.getAttribute && e.target.getAttribute('data-freply');
        if (id) drafts[id] = e.target.value;
      });

      list.addEventListener('click', function (e) {
        var s = e.target.closest('[data-send-freply]');
        if (!s) return;
        var id = s.getAttribute('data-send-freply');
        var ta = list.querySelector('textarea[data-freply="' + id + '"]');
        var text = ta ? ta.value.trim().slice(0, 300) : '';
        if (!text) return P.toast('Type your reply first.', 'err');
        var wait = P.cooldown('fault-reply', 5); if (wait) return P.toast('Please wait ' + wait + 's.', 'err');
        P.busy(s, function () {
          return P.db.collection('faultReports').doc(id).update({
            thread: FV().arrayUnion({ from: 'guest', text: text, at: Date.now() }), guestReply: text, guestReplyAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
          }).then(function () { delete drafts[id]; P.toast('Reply sent.', 'ok'); });
        }).catch(fail);
      });

      paintList();   /* show what we already have, then go live */

      liveUnsub = P.db.collection('faultReports').where('uid', '==', ctx.user.uid).limit(100).onSnapshot(function (qs) {
        var rows = [], map = {};
        qs.forEach(function (d) {
          var x = d.data({ serverTimestamps: 'estimate' }); x.id = d.id; x._ts = P.toDate(x.createdAt);
          rows.push(x); map[x.id] = { status: x.status, reply: x.adminResponse || '' };
        });
        rows.sort(function (a, b) { return (b._ts || 0) - (a._ts || 0); });
        if (seen && !qs.metadata.hasPendingWrites) {
          var changed = rows.some(function (r) { var p = seen[r.id]; return p && (p.status !== r.status || p.reply !== (r.adminResponse || '')); });
          if (changed) P.toast('The lodge updated your fault report.', 'ok');
        }
        seen = map;
        ctx.faults = rows;
        paintList();
        if (P.renderNav) P.renderNav();
      }, function (e) {
        if (window.console) console.warn('[portal] fault listener:', e.code || e.message);
        list.innerHTML = '<div class="pt-alert warn">Live updates are unavailable. Refresh the page to see changes.</div>';
      });
    }
  };

  /* =========================================================== LAUNDRY */
  var liveUnsub = null;   /* live Firestore listener for the open list (faults or laundry) */
  function stopLive() { if (liveUnsub) { liveUnsub(); liveUnsub = null; } }
  window.addEventListener('hashchange', stopLive);
  window.addEventListener('pagehide', stopLive);

  P.sections.laundry = {
    intro: 'We collect from your room and bring it back clean.',
    render: function (ctx, root) {
      var C = CFG.laundry;
      root.innerHTML =
        '<div class="pt-card"><h2>New laundry request</h2><form id="l-form" novalidate>' +
        '<div class="pt-field"><label for="l-stay">Booking</label><select class="pt-select" id="l-stay">' + stayOptions(ctx) + '</select></div>' +
        '<div class="pt-field"><label for="l-room">Room</label><input class="pt-input" id="l-room" maxlength="60"><div class="pt-err" id="l-room-err"></div></div>' +
        '<div class="pt-field"><span class="pt-label">Items (how many pieces?)</span>' +
        C.items.map(function (it, i) {
          return '<div class="pt-rate-row"><span>' + esc(it) + '</span><span class="pt-qty"><button type="button" data-q="' + i + '" data-d="-1" aria-label="Less ' + esc(it) + '">–</button><output id="q' + i + '">0</output><button type="button" data-q="' + i + '" data-d="1" aria-label="More ' + esc(it) + '">+</button></span></div>';
        }).join('') + '<div class="pt-err" id="l-items-err"></div></div>' +
        '<div class="pt-field"><span class="pt-label">Service (tick all that apply)</span><div class="pt-checks">' + C.services.map(function (c) { return '<label class="pt-check"><input type="checkbox" name="l-svc" value="' + esc(c) + '"> <span>' + esc(c) + '</span></label>'; }).join('') + '</div><div class="pt-err" id="l-svc-err"></div></div>' +
        '<div class="pt-field"><label for="l-slot">Collect from my room</label><select class="pt-select" id="l-slot">' + C.slots.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div class="pt-field"><label for="l-note">Notes (optional)</label><textarea class="pt-textarea" id="l-note" style="min-height:80px" maxlength="300" placeholder="e.g. delicate fabric, no starch"></textarea></div>' +
        phoneField(ctx) +
        (C.note ? '<p class="pt-small pt-muted">' + esc(C.note) + '</p>' : '') +
        '<button class="pt-btn" id="l-submit" type="submit">Send request</button></form></div>' +
        '<div class="pt-card"><h2>My laundry requests</h2><div id="l-list"></div></div>';

      var qty = C.items.map(function () { return 0; });
      root.querySelectorAll('[data-q]').forEach(function (b) {
        b.addEventListener('click', function () {
          var i = +b.getAttribute('data-q'); qty[i] = Math.max(0, Math.min(30, qty[i] + +b.getAttribute('data-d')));
          root.querySelector('#q' + i).textContent = qty[i];
        });
      });
      var stay = root.querySelector('#l-stay'), room = root.querySelector('#l-room');
      function syncRoom() { var s = stayById(ctx, stay.value); if (s) room.value = s.room; }
      syncRoom(); stay.addEventListener('change', syncRoom);

      root.querySelector('#l-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var items = C.items.map(function (t, i) { return { type: t, qty: qty[i] }; }).filter(function (x) { return x.qty > 0; });
        var ph = cleanPhone(root.querySelector('#l-phone') ? root.querySelector('#l-phone').value : root.querySelector('#f-phone').value);
        var ok = setErr('l-room-err', room.value.trim() ? '' : 'Enter your room.');
        ok = setErr('l-items-err', items.length ? '' : 'Add at least one item.') && ok;
        var svcs = Array.prototype.map.call(root.querySelectorAll('input[name="l-svc"]:checked'), function (x) { return x.value; });
        ok = setErr('l-svc-err', svcs.length ? '' : 'Choose at least one service.') && ok;
        ok = setErr('f-phone-err', ph ? '' : 'Enter a valid phone number.') && ok;
        if (!ok) return;
        var wait = P.cooldown('laundry', 20); if (wait) return P.toast('Please wait ' + wait + 's before sending another request.', 'err');
        var s = stayById(ctx, stay.value), w = who(ctx);
        P.busy(root.querySelector('#l-submit'), function () {
          return P.db.collection('laundryRequests').add({
            uid: ctx.user.uid, name: w.name, email: w.email, phone: ph,
            bookingRef: s ? s.ref : '', room: room.value.trim().slice(0, 60),
            items: items, service: svcs.join(', ').slice(0, 200), slot: root.querySelector('#l-slot').value,
            note: root.querySelector('#l-note').value.trim().slice(0, 300),
            status: 'requested', createdAt: FV().serverTimestamp()
          }).then(function () { return ctx.reload('laundry'); }).then(function () {
            P.toast('Laundry request sent.', 'ok'); P.rerender();
          });
        }).catch(fail);
      });

      var list = root.querySelector('#l-list');
      var drafts = {};      /* reply text being typed, kept while the list repaints */
      var seen = null;      /* last known status/note per request, to announce changes */
      stopLive();

      function paintList() {
        var act = document.activeElement;
        var actId = act && act.getAttribute ? act.getAttribute('data-reply') : null;
        var pos = actId ? act.selectionStart : 0;

        list.innerHTML = !ctx.laundry.length ? '<div class="pt-empty">No laundry requests yet.</div>' :
          '<ul class="pt-list">' + ctx.laundry.map(function (l) {
            var pieces = (l.items || []).map(function (i) { return esc(i.qty) + '× ' + esc(i.type); }).join(', ');
            var open = l.status !== 'delivered' && l.status !== 'cancelled';
            var reply = '';
            var cm = chatMsgs(l, 'adminNote'); var pin = l.adminNote ? '<div class="pt-pin">📌 <b>Lodge note:</b> ' + esc(l.adminNote) + '</div>' : '';
            if (cm.length || pin) {
              reply = waBox(pin, cm, open && (pin || cm.some(function (m) { return m.from === 'staff'; })), 'reply', 'send-reply', l.id, drafts[l.id]);
            }
            return '<li class="pt-item"><div class="pt-item-top"><div><b>' + esc(l.service) + '</b> <span class="pt-muted pt-small">· ' + esc(l.room) + ' · ' + esc(P.fmtDateTime(l._ts)) + '</span></div>' + P.statusBadge(l.status) + '</div>' +
              '<p>' + pieces + '<br><span class="pt-muted pt-small">Collection: ' + esc(l.slot) + '</span></p>' +
              (l.price != null && l.price !== '' ? '<p><b>Charge:</b> ' + esc(P.money(l.price)) + '</p>' : '') +
              steps(['requested', 'collected', 'processing', 'ready', 'delivered'], l.status) +
              reply +
              (l.status === 'requested' ? '<p><button class="pt-btn pt-btn-danger pt-btn-sm" data-cancel="' + esc(l.id) + '" type="button">Cancel request</button></p>' : '') + '</li>';
          }).join('') + '</ul>';

        list.querySelectorAll('.pt-wa-body').forEach(function (b) { b.scrollTop = b.scrollHeight; });
        if (actId) {
          var ta = list.querySelector('textarea[data-reply="' + actId + '"]');
          if (ta) { ta.focus(); try { ta.setSelectionRange(pos, pos); } catch (e) {} }
        }
      }

      list.addEventListener('input', function (e) {
        var id = e.target.getAttribute && e.target.getAttribute('data-reply');
        if (id) drafts[id] = e.target.value;
      });

      list.addEventListener('click', function (e) {
        var c = e.target.closest('[data-cancel]');
        if (c) {
          if (!window.confirm('Cancel this laundry request?')) return;
          P.busy(c, function () {
            return P.db.collection('laundryRequests').doc(c.getAttribute('data-cancel')).update({ status: 'cancelled', updatedAt: FV().serverTimestamp() })
              .then(function () { P.toast('Request cancelled.', 'ok'); });
          }).catch(fail);
          return;
        }
        var s = e.target.closest('[data-send-reply]');
        if (s) {
          var id = s.getAttribute('data-send-reply');
          var ta = list.querySelector('textarea[data-reply="' + id + '"]');
          var text = ta ? ta.value.trim().slice(0, 300) : '';
          if (!text) return P.toast('Type your reply first.', 'err');
          var wait = P.cooldown('laundry-reply', 5); if (wait) return P.toast('Please wait ' + wait + 's.', 'err');
          P.busy(s, function () {
            return P.db.collection('laundryRequests').doc(id).update({
              thread: FV().arrayUnion({ from: 'guest', text: text, at: Date.now() }), guestReply: text, guestReplyAt: FV().serverTimestamp(), updatedAt: FV().serverTimestamp()
            }).then(function () { delete drafts[id]; P.toast('Reply sent.', 'ok'); });
          }).catch(fail);
        }
      });

      paintList();   /* show what we already have, then go live */

      liveUnsub = P.db.collection('laundryRequests').where('uid', '==', ctx.user.uid).limit(100).onSnapshot(function (qs) {
        var rows = [], map = {};
        qs.forEach(function (d) {
          var x = d.data({ serverTimestamps: 'estimate' }); x.id = d.id; x._ts = P.toDate(x.createdAt);
          rows.push(x); map[x.id] = { status: x.status, note: x.adminNote || '', price: x.price };
        });
        rows.sort(function (a, b) { return (b._ts || 0) - (a._ts || 0); });
        if (seen && !qs.metadata.hasPendingWrites) {
          var changed = rows.some(function (r) { var p = seen[r.id]; return p && (p.status !== r.status || p.note !== (r.adminNote || '') || p.price !== r.price); });
          if (changed) P.toast('The lodge updated your laundry request.', 'ok');
        }
        seen = map;
        ctx.laundry = rows;
        paintList();
        if (P.renderNav) P.renderNav();
      }, function (e) {
        if (window.console) console.warn('[portal] laundry listener:', e.code || e.message);
        list.innerHTML = '<div class="pt-alert warn">Live updates are unavailable. Refresh the page to see changes.</div>';
      });
    }
  };

  /* =========================================================== FEEDBACK */
  var CATS = [['cleanliness', 'Cleanliness'], ['comfort', 'Comfort'], ['staff', 'Staff & service'], ['location', 'Location'], ['value', 'Value for money']];

  function publicName(full) {
    var p = String(full || '').trim().split(/\s+/).filter(Boolean);
    if (!p.length) return 'Guest';
    return p.length === 1 ? p[0] : p[0] + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.';
  }
  function fbId(ctx, stayId) {
    var s = stayById(ctx, stayId);
    return ctx.user.uid + '_' + (s ? String(s.ref).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 40) || 'stay' : 'general');
  }

  P.sections.feedback = {
    intro: 'Rate your stay and tell us how we did. With your OK, the best comments appear on our website.',
    render: function (ctx, root) {
      var eligible = ctx.stays.filter(function (s) { return !s.cancelled && s.checkIn && P.day0(new Date()) >= s.checkIn; });
      var opts = eligible.map(function (s) { return '<option value="' + esc(s.id) + '">' + esc(s.room) + ' · ' + esc(s.ref) + ' (' + esc(P.fmtShort(s.checkIn)) + ')</option>'; }).join('') + '<option value="">General feedback</option>';
      root.innerHTML = '<div class="pt-card"><h2>Your feedback</h2><form id="r-form" novalidate>' +
        '<div class="pt-field"><label for="r-stay">About which stay?</label><select class="pt-select" id="r-stay">' + opts + '</select></div>' +
        '<div id="r-status"></div>' +
        '<div class="pt-field"><span class="pt-label">Overall rating</span><div id="r-overall"></div><div class="pt-err" id="r-overall-err"></div></div>' +
        '<div class="pt-field"><span class="pt-label">Rate each area (optional)</span>' +
        CATS.map(function (c) { return '<div class="pt-rate-row"><span>' + c[1] + '</span><span id="rc-' + c[0] + '"></span></div>'; }).join('') + '</div>' +
        '<div class="pt-field"><label for="r-comment">Your comments</label><textarea class="pt-textarea" id="r-comment" maxlength="800" placeholder="What did you enjoy? What could we do better?"></textarea><div class="pt-hint"><span id="r-count">0</span>/800</div></div>' +
        '<div class="pt-field"><label class="pt-check"><input type="checkbox" id="r-public"> <span>You may show my comment on the lodge website with my first name and last initial (<b id="r-pname"></b>).</span></label></div>' +
        '<button class="pt-btn" id="r-submit" type="submit">Submit feedback</button></form></div>';

      var overall = P.starPicker(0); root.querySelector('#r-overall').appendChild(overall.el);
      var cats = {}; CATS.forEach(function (c) { cats[c[0]] = P.starPicker(0); root.querySelector('#rc-' + c[0]).appendChild(cats[c[0]].el); });
      var stay = root.querySelector('#r-stay'), comment = root.querySelector('#r-comment'), pub = root.querySelector('#r-public');
      var pn = publicName(ctx.profile.name || ctx.user.displayName); root.querySelector('#r-pname').textContent = pn;
      comment.addEventListener('input', function () { root.querySelector('#r-count').textContent = comment.value.length; });

      var existing = null;
      function load() {
        var id = fbId(ctx, stay.value);
        existing = ctx.feedback.filter(function (f) { return f.id === id; })[0] || null;
        overall.set(existing ? existing.rating : 0);
        CATS.forEach(function (c) { cats[c[0]].set(existing && existing.ratings ? existing.ratings[c[0]] || 0 : 0); });
        comment.value = existing ? existing.comment || '' : ''; pub.checked = !!(existing && existing.showPublic);
        root.querySelector('#r-count').textContent = comment.value.length;
        var locked = existing && existing.status === 'published';
        var st = root.querySelector('#r-status');
        st.innerHTML = !existing ? '' : locked
          ? '<div class="pt-alert ok">Thank you! Your review is now live on our website.</div>'
          : '<div class="pt-alert info">We received your feedback. You can still edit it until it is published.</div>';
        root.querySelectorAll('#r-form input, #r-form textarea, #r-form button[type=submit], .pt-stars button').forEach(function (el) { el.disabled = !!locked; });
        root.querySelector('#r-submit').textContent = existing ? 'Update feedback' : 'Submit feedback';
      }
      stay.addEventListener('change', load); load();

      root.querySelector('#r-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        if (!setErr('r-overall-err', overall.get() ? '' : 'Please choose an overall rating.')) return;
        var wait = P.cooldown('feedback', 15); if (wait) return P.toast('Please wait ' + wait + 's.', 'err');
        var s = stayById(ctx, stay.value), id = fbId(ctx, stay.value), ratings = {};
        CATS.forEach(function (c) { if (cats[c[0]].get()) ratings[c[0]] = cats[c[0]].get(); });
        var body = { rating: overall.get(), ratings: ratings, comment: comment.value.trim().slice(0, 800), showPublic: pub.checked, publicName: pn };
        var ref = P.db.collection('feedback').doc(id);
        P.busy(root.querySelector('#r-submit'), function () {
          var w = who(ctx);
          var write = existing
            ? ref.update(Object.assign({}, body, { updatedAt: FV().serverTimestamp() }))
            : ref.set(Object.assign({ uid: ctx.user.uid, name: w.name, bookingRef: s ? s.ref : '', room: s ? s.room : '', status: 'draft', createdAt: FV().serverTimestamp() }, body));
          return write.then(function () { return ctx.reload('feedback'); }).then(function () { P.toast('Thank you for your feedback!', 'ok'); P.rerender(); });
        }).catch(fail);
      });
    }
  };
})();
