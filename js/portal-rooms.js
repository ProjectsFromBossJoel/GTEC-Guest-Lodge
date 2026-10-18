/* js/portal-rooms.js – "Available rooms": live availability status only.
   Loads after portal-info.js and replaces its Rooms section. Reads rooms.status
   (Available / Occupied / Reserved / Cleaning / Maintenance) in real time. */
(function () {
  'use strict';
  var P = window.Portal, esc = P.esc, unsub = null;

  var SHOW_TYPE = true;       // show "Standard", "Deluxe"… under the room number
  var SHOW_CAPACITY = false;  // show "Sleeps 2"
  var SHOW_PRICE = false;     // show price per night

  var COLORS = {
    available:   ['#dcfce7', '#15803d'],
    occupied:    ['#fee2e2', '#b91c1c'],
    reserved:    ['#dbeafe', '#1d4ed8'],
    cleaning:    ['#fef3c7', '#92400e'],
    maintenance: ['#ede9fe', '#6d28d9']
  };

  function css() {
    if (document.getElementById('ra-style')) return;
    var s = document.createElement('style'); s.id = 'ra-style';
    s.textContent =
      '.ra-bar{display:flex;flex-wrap:wrap;gap:.8rem;align-items:center;justify-content:space-between;margin-bottom:1.1rem}' +
      '.ra-sum{font-weight:600}.ra-sum b{color:#15803d}' +
      '.ra-filter{display:flex;gap:.4rem;flex-wrap:wrap}' +
      '.ra-filter button{border:1px solid #d6d3c8;background:#fff;border-radius:999px;padding:.45rem .95rem;font:inherit;font-size:.9rem;cursor:pointer}' +
      '.ra-filter button[aria-pressed="true"]{background:#0b4a47;border-color:#0b4a47;color:#fff}' +
      '.ra-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:.8rem}' +
      '.ra-card{background:#fff;border:1px solid #e7e3d8;border-radius:14px;padding:1rem;display:flex;flex-direction:column;gap:.35rem}' +
      '.ra-num{font-size:1.25rem;font-weight:700}' +
      '.ra-meta{color:#6b7280;font-size:.88rem}' +
      '.ra-badge{align-self:flex-start;border-radius:999px;padding:.25rem .7rem;font-size:.8rem;font-weight:700}' +
      '.ra-empty{grid-column:1/-1;text-align:center;color:#6b7280;padding:2rem 0}' +
      '@media(max-width:600px){.ra-bar{flex-direction:column;align-items:stretch}.ra-bar .pt-btn{width:100%}' +
      '.ra-filter{width:100%}.ra-filter button{flex:1 1 0}.ra-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}' +
      '@media(max-width:360px){.ra-grid{grid-template-columns:1fr}}';
    document.head.appendChild(s);
  }

  P.sections.rooms = {
    intro: 'Live availability of our rooms. To reserve one, use the booking page.',
    render: function (ctx, root) {
      css();
      var filter = 'all', rooms = [];
      var bookUrl = (P.CFG && P.CFG.paths && P.CFG.paths.book) || 'index.html#rooms';

      root.innerHTML =
        '<div class="ra-bar"><div class="ra-sum" id="ra-sum">Loading…</div>' +
        '<div class="ra-filter" id="ra-f">' +
        '<button type="button" data-f="all" aria-pressed="true">All rooms</button>' +
        '<button type="button" data-f="available" aria-pressed="false">Available only</button></div>' +
        '<a class="pt-btn" href="' + esc(bookUrl) + '">Book a room</a></div>' +
        '<div class="ra-grid" id="ra-grid"></div>';

      function draw() {
        var avail = rooms.filter(function (r) { return r.key === 'available'; }).length;
        document.getElementById('ra-sum').innerHTML = '<b>' + avail + '</b> of ' + rooms.length + ' rooms available now';
        var list = filter === 'available' ? rooms.filter(function (r) { return r.key === 'available'; }) : rooms;
        document.getElementById('ra-grid').innerHTML = list.length ? list.map(function (r) {
          var c = COLORS[r.key] || ['#e5e7eb', '#374151'];
          return '<div class="ra-card"><div class="ra-num">Room ' + esc(r.number) + '</div>' +
            (SHOW_TYPE && r.type ? '<div class="ra-meta">' + esc(r.type) + '</div>' : '') +
            (SHOW_CAPACITY && r.capacity ? '<div class="ra-meta">Sleeps ' + esc(r.capacity) + '</div>' : '') +
            (SHOW_PRICE && r.price ? '<div class="ra-meta">' + esc((P.CFG.lodge.currency || '') + ' ' + Number(r.price).toLocaleString()) + ' / night</div>' : '') +
            '<span class="ra-badge" style="background:' + c[0] + ';color:' + c[1] + '">' + esc(r.status || 'Unknown') + '</span></div>';
        }).join('') : '<div class="ra-empty">No rooms to show.</div>';
      }

      document.getElementById('ra-f').addEventListener('click', function (e) {
        var b = e.target.closest('[data-f]'); if (!b) return;
        filter = b.getAttribute('data-f');
        [].forEach.call(this.querySelectorAll('button'), function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        draw();
      });

      if (unsub) { unsub(); unsub = null; }
      unsub = P.db.collection('rooms').onSnapshot(function (snap) {
        if (!root.isConnected) { unsub(); unsub = null; return; }   // guest left this page
        rooms = [];
        snap.forEach(function (d) {
          var x = d.data();
          rooms.push({ number: x.number != null ? x.number : d.id, type: x.type, capacity: x.capacity, price: x.price, status: x.status, key: String(x.status || '').toLowerCase() });
        });
        rooms.sort(function (a, b) { return (parseInt(a.number, 10) || 0) - (parseInt(b.number, 10) || 0); });
        draw();
      }, function () {
        document.getElementById('ra-sum').textContent = '';
        document.getElementById('ra-grid').innerHTML = '<div class="ra-empty">Couldn’t load room availability. Please refresh or contact the front desk.</div>';
      });
    }
  };
})();