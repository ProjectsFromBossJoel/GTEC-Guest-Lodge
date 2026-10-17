/* Informational pages: Rules, Available rooms, Services, Profile. */
(function () {
  'use strict';
  var P = window.Portal, esc = P.esc, CFG = P.CFG;

  /* =========================================================== RULES */
  P.sections.rules = {
    intro: 'A few simple rules keep the lodge comfortable and safe for everyone.',
    render: function (ctx, root) {
      var L = CFG.lodge;
      root.innerHTML =
        '<div class="pt-card"><h2>Your times</h2><div class="pt-row cols-2">' +
        '<div><div class="pt-muted pt-small">Check-in</div><b style="font-size:1.3rem">from ' + esc(P.timeLabel(L.checkInTime)) + '</b></div>' +
        '<div><div class="pt-muted pt-small">Check-out</div><b style="font-size:1.3rem">by ' + esc(P.timeLabel(L.checkOutTime)) + '</b></div></div></div>' +
        '<div class="pt-acc">' + CFG.rules.map(function (g, i) {
          return '<details' + (i === 0 ? ' open' : '') + '><summary>' + esc(g.title) + '</summary><ul>' + g.items.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul></details>';
        }).join('') + '</div>' +
        '<div class="pt-card"><h2>Contact the front desk</h2>' +
        '<p>Phone: <a href="tel:' + esc(L.phone.replace(/[^\d+]/g, '')) + '">' + esc(L.phone) + '</a><br>' +
        'E-mail: <a href="mailto:' + esc(L.email) + '">' + esc(L.email) + '</a></p>' +
        '<a class="pt-btn pt-btn-ghost pt-btn-sm" target="_blank" rel="noopener" href="https://wa.me/' + esc(L.whatsapp) + '">WhatsApp</a></div>';
    }
  };

  /* =========================================================== ROOMS */
  function roomView(id, d) {
    var F = CFG.data.rooms.fields, pick = P.pick;
    var img = pick(d, F.image); if (Array.isArray(img)) img = img[0]; if (img && typeof img === 'object') img = img.url || '';
    var am = pick(d, F.amenities); if (!Array.isArray(am)) am = typeof am === 'string' ? am.split(',') : [];
    var av = pick(d, F.available);
    // only http(s) / relative image paths are used in CSS, never anything else
    img = /^(https?:\/\/|\/)?[^\s'"()\\<>]+$/.test(String(img || '')) ? String(img) : '';
    return { id: id, name: String(pick(d, F.name) || 'Room'), price: pick(d, F.price), capacity: pick(d, F.capacity), img: img,
      amenities: am.map(String).map(function (x) { return x.trim(); }).filter(Boolean).slice(0, 8), desc: String(pick(d, F.description) || ''),
      available: av === null ? null : !(av === false || /^(false|no|unavailable|booked|inactive)$/i.test(String(av))) };
  }
  P.sections.rooms = {
    intro: 'Browse our rooms. Pick your dates on the booking page to confirm availability.',
    render: function (ctx, root) {
      root.innerHTML = '<div class="pt-card"><div class="pt-skel" style="margin:0"></div></div>';
      P.db.collection(CFG.data.rooms.collection).limit(60).get().then(function (qs) {
        var rooms = []; qs.forEach(function (doc) { rooms.push(roomView(doc.id, doc.data())); });
        if (!rooms.length) { root.innerHTML = '<div class="pt-card pt-empty">No rooms to show right now.</div>'; return; }
        rooms.sort(function (a, b) { return (a.available === false) - (b.available === false) || (Number(a.price) || 0) - (Number(b.price) || 0); });
        root.innerHTML = '<div class="pt-grid">' + rooms.map(function (r) {
          return '<article class="pt-tile"><div class="img"' + (r.img ? ' style="background-image:url(\'' + esc(r.img) + '\')"' : '') + ' role="img" aria-label="' + esc(r.name) + '"></div><div class="body">' +
            '<div style="display:flex;justify-content:space-between;gap:.5rem;align-items:start"><h3>' + esc(r.name) + '</h3>' +
            (r.available === null ? '' : r.available ? '<span class="pt-badge ok">Available</span>' : '<span class="pt-badge bad">Not available</span>') + '</div>' +
            (r.price != null && r.price !== '' ? '<div class="price">' + esc(P.money(r.price)) + ' <span class="pt-muted pt-small" style="font-weight:400">/ night</span></div>' : '') +
            (r.capacity ? '<div class="pt-small pt-muted">Sleeps ' + esc(r.capacity) + '</div>' : '') +
            (r.desc ? '<p class="pt-small" style="margin:0">' + esc(r.desc.slice(0, 160)) + (r.desc.length > 160 ? '…' : '') + '</p>' : '') +
            (r.amenities.length ? '<div class="pt-chips">' + r.amenities.map(function (a) { return '<span>' + esc(a) + '</span>'; }).join('') + '</div>' : '') +
            '<a class="pt-btn pt-btn-sm" style="margin-top:.4rem" href="' + esc(CFG.paths.book) + '">Book this room</a></div></article>';
        }).join('') + '</div>';
      }).catch(function () {
        root.innerHTML = '<div class="pt-alert err">Couldn’t load the rooms. Please try again.</div>';
      });
    }
  };

  /* =========================================================== SERVICES */
  P.sections.services = {
    intro: 'Everything we offer during your stay.',
    render: function (ctx, root) {
      function draw(list) {
        root.innerHTML = '<div class="pt-grid">' + list.map(function (s) {
          return '<article class="pt-card pt-svc" style="margin:0"><div class="ic" aria-hidden="true">' + esc(s.icon || '✨') + '</div><h3>' + esc(s.name) + '</h3><p class="pt-muted" style="margin:.3rem 0 0">' + esc(s.text || '') + '</p>' +
            (/laundry/i.test(s.name) ? '<p style="margin:.7rem 0 0"><a class="pt-btn pt-btn-sm" href="#laundry">Request laundry</a></p>' : '') + '</article>';
        }).join('') + '</div>';
      }
      draw(CFG.services);
      // Optional override: a Firestore `services` collection (public read) replaces the defaults.
      P.db.collection('services').limit(40).get().then(function (qs) {
        var l = []; qs.forEach(function (d) { var x = d.data(); if (x.name && x.active !== false) l.push(x); });
        if (l.length) draw(l);
      }).catch(function () { /* keep defaults */ });
    }
  };

  /* =========================================================== PROFILE */
  P.sections.profile = {
    intro: 'Your details are used to contact you about your stay.',
    render: function (ctx, root) {
      var u = ctx.user, google = u.providerData.some(function (p) { return p.providerId === 'google.com'; }), pwd = u.providerData.some(function (p) { return p.providerId === 'password'; });
      root.innerHTML = '<div class="pt-card"><h2>Your details</h2><form id="p-form" novalidate>' +
        '<div class="pt-field"><label for="p-name">Full name</label><input class="pt-input" id="p-name" maxlength="80" value="' + esc(ctx.profile.name || u.displayName || '') + '"><div class="pt-err" id="p-name-err"></div></div>' +
        '<div class="pt-field"><label for="p-phone">Phone / WhatsApp</label><input class="pt-input" id="p-phone" type="tel" maxlength="20" value="' + esc(ctx.profile.phone || '') + '"><div class="pt-err" id="p-phone-err"></div></div>' +
        '<div class="pt-field"><label>E-mail</label><input class="pt-input" value="' + esc(u.email) + '" disabled> <div class="pt-hint">' + (u.emailVerified ? '<span class="pt-badge ok">Verified</span>' : '<span class="pt-badge warn">Not verified</span>') + ' Bookings are matched to this address.</div></div>' +
        '<button class="pt-btn" id="p-save" type="submit">Save changes</button></form></div>' +
        '<div class="pt-card"><h2>Security</h2>' +
        (pwd ? '<p>Change your password by e-mail link.</p><button class="pt-btn pt-btn-ghost" id="p-reset" type="button">Send password reset e-mail</button>' : '<p class="pt-muted">You sign in with Google, so there is no password to manage here.</p>') +
        '</div>';

      root.querySelector('#p-form').addEventListener('submit', function (ev) {
        ev.preventDefault();
        var name = root.querySelector('#p-name').value.trim().replace(/\s+/g, ' '), ph = root.querySelector('#p-phone').value.replace(/[\s\-()]/g, '');
        var ok = true;
        root.querySelector('#p-name-err').textContent = name.length >= 2 ? '' : (ok = false, 'Enter your name.');
        root.querySelector('#p-phone-err').textContent = !ph || /^\+?\d{9,15}$/.test(ph) ? '' : (ok = false, 'Enter a valid phone number.');
        if (!ok) return;
        P.busy(root.querySelector('#p-save'), function () {
          return P.db.collection('clients').doc(u.uid).update({ name: name, phone: ph, updatedAt: firebase.firestore.FieldValue.serverTimestamp() })
            .then(function () { return u.updateProfile({ displayName: name }).catch(function () {}); })
            .then(function () { ctx.profile.name = name; ctx.profile.phone = ph; document.getElementById('pt-who').textContent = name; P.toast('Saved.', 'ok'); });
        }).catch(function () { P.toast('Couldn’t save. Please try again.', 'err'); });
      });
      var reset = root.querySelector('#p-reset');
      if (reset) reset.addEventListener('click', function () {
        P.busy(reset, function () { return P.auth.sendPasswordResetEmail(u.email); }).then(function () { P.toast('Reset e-mail sent. Check your inbox.', 'ok'); })
          .catch(function (e) { P.toast(P.authError(e), 'err'); });
      });
    }
  };
})();
