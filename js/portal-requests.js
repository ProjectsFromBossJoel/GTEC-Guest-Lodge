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

  /* =========================================================== FAULT */
  P.sections.fault = {
    intro: 'Something not working? Tell us and the team will take care of it.',
    render: function (ctx, root) {
      var C = CFG.fault;
      root.innerHTML =
        '<div class="pt-card"><h2>New report</h2><form id="f-form" novalidate>' +
        '<div class="pt-row cols-2"><div class="pt-field"><label for="f-stay">Booking</label><select class="pt-select" id="f-stay">' + stayOptions(ctx) + '</select></div>' +
        '<div class="pt-field"><label for="f-room">Room / location</label><input class="pt-input" id="f-room" maxlength="60" placeholder="e.g. Room 4, corridor, lounge"><div class="pt-err" id="f-room-err"></div></div></div>' +
        '<div class="pt-row cols-2"><div class="pt-field"><label for="f-cat">What is it about?</label><select class="pt-select" id="f-cat">' + C.categories.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div class="pt-field"><label for="f-urg">How urgent?</label><select class="pt-select" id="f-urg">' + C.urgencies.map(function (c) { return '<option' + (c === 'Normal' ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join('') + '</select><div class="pt-hint">Choose Urgent only for safety problems or no water/power.</div></div></div>' +
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
        if (!ok) return;
        var wait = P.cooldown('fault', 20); if (wait) return P.toast('Please wait ' + wait + 's before sending another report.', 'err');
        var s = stayById(ctx, stay.value), w = who(ctx);
        P.busy(root.querySelector('#f-submit'), function () {
          return P.db.collection('faultReports').add({
            uid: ctx.user.uid, name: w.name, email: w.email, phone: ph,
            bookingRef: s ? s.ref : '', room: r.slice(0, 60),
            category: root.querySelector('#f-cat').value, urgency: root.querySelector('#f-urg').value,
            description: d, status: 'new', createdAt: FV().serverTimestamp()
          }).then(function () { return ctx.reload('faults'); }).then(function () {
            P.toast('Report sent. We’ll update the status here.', 'ok'); P.rerender();
          });
        }).catch(fail);
      });

      var list = root.querySelector('#f-list');
      list.innerHTML = !ctx.faults.length ? '<div class="pt-empty">You haven’t reported anything.</div>' :
        '<ul class="pt-list">' + ctx.faults.map(function (f) {
          return '<li class="pt-item"><div class="pt-item-top"><div><b>' + esc(f.category) + '</b> <span class="pt-muted pt-small">· ' + esc(f.room) + ' · ' + esc(P.fmtDateTime(f._ts)) + '</span></div>' +
            '<div>' + (f.urgency === 'Urgent' ? '<span class="pt-badge bad">Urgent</span> ' : '') + P.statusBadge(f.status) + '</div></div>' +
            '<p>' + esc(f.description) + '</p>' + steps(['new', 'seen', 'in_progress', 'resolved'], f.status) +
            (f.adminResponse ? '<div class="pt-reply"><b>Lodge reply:</b> ' + esc(f.adminResponse) + '</div>' : '') + '</li>';
        }).join('') + '</ul>';
    }
  };

  /* =========================================================== LAUNDRY */
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
        '<div class="pt-row cols-2"><div class="pt-field"><label for="l-svc">Service</label><select class="pt-select" id="l-svc">' + C.services.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div>' +
        '<div class="pt-field"><label for="l-slot">Collect from my room</label><select class="pt-select" id="l-slot">' + C.slots.map(function (c) { return '<option>' + esc(c) + '</option>'; }).join('') + '</select></div></div>' +
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
        ok = setErr('f-phone-err', ph ? '' : 'Enter a valid phone number.') && ok;
        if (!ok) return;
        var wait = P.cooldown('laundry', 20); if (wait) return P.toast('Please wait ' + wait + 's before sending another request.', 'err');
        var s = stayById(ctx, stay.value), w = who(ctx);
        P.busy(root.querySelector('#l-submit'), function () {
          return P.db.collection('laundryRequests').add({
            uid: ctx.user.uid, name: w.name, email: w.email, phone: ph,
            bookingRef: s ? s.ref : '', room: room.value.trim().slice(0, 60),
            items: items, service: root.querySelector('#l-svc').value, slot: root.querySelector('#l-slot').value,
            note: root.querySelector('#l-note').value.trim().slice(0, 300),
            status: 'requested', createdAt: FV().serverTimestamp()
          }).then(function () { return ctx.reload('laundry'); }).then(function () {
            P.toast('Laundry request sent.', 'ok'); P.rerender();
          });
        }).catch(fail);
      });

      var list = root.querySelector('#l-list');
      list.innerHTML = !ctx.laundry.length ? '<div class="pt-empty">No laundry requests yet.</div>' :
        '<ul class="pt-list">' + ctx.laundry.map(function (l) {
          var pieces = (l.items || []).map(function (i) { return esc(i.qty) + '× ' + esc(i.type); }).join(', ');
          return '<li class="pt-item"><div class="pt-item-top"><div><b>' + esc(l.service) + '</b> <span class="pt-muted pt-small">· ' + esc(l.room) + ' · ' + esc(P.fmtDateTime(l._ts)) + '</span></div>' + P.statusBadge(l.status) + '</div>' +
            '<p>' + pieces + '<br><span class="pt-muted pt-small">Collection: ' + esc(l.slot) + '</span></p>' +
            (l.price != null && l.price !== '' ? '<p><b>Charge:</b> ' + esc(P.money(l.price)) + '</p>' : '') +
            steps(['requested', 'collected', 'processing', 'ready', 'delivered'], l.status) +
            (l.adminNote ? '<div class="pt-reply"><b>Lodge note:</b> ' + esc(l.adminNote) + '</div>' : '') +
            (l.status === 'requested' ? '<p><button class="pt-btn pt-btn-danger pt-btn-sm" data-cancel="' + esc(l.id) + '" type="button">Cancel request</button></p>' : '') + '</li>';
        }).join('') + '</ul>';
      list.querySelectorAll('[data-cancel]').forEach(function (b) {
        b.addEventListener('click', function () {
          if (!window.confirm('Cancel this laundry request?')) return;
          P.busy(b, function () {
            return P.db.collection('laundryRequests').doc(b.getAttribute('data-cancel')).update({ status: 'cancelled', updatedAt: FV().serverTimestamp() })
              .then(function () { return ctx.reload('laundry'); }).then(function () { P.toast('Request cancelled.', 'ok'); P.rerender(); });
          }).catch(fail);
        });
      });
    }
  };
  /* the phone field id is shared; laundry validation reads #f-phone */

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
