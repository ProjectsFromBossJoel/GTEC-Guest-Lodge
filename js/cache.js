/*!
 * AppCache — tiny TTL cache on top of sessionStorage (cleared when the tab closes).
 *
 *   const rows = await AppCache.wrap('mon:24h', 60000, () => fetchFromFirestore());
 *   await AppCache.wrap('mon:24h', 60000, fetcher, { force: true });   // bypass + refresh
 *   AppCache.clear('mon:');                                            // drop a group
 *
 * Good for: admin reports, monitoring tables, settings, anything read often and changed rarely.
 * Do NOT use for live room status or anything staff must see the instant it changes.
 */
(function () {
  'use strict';
  if (window.AppCache) return;

  var PREFIX = 'gtec:cache:';
  var pending = {};

  function store() {
    try { return window.sessionStorage; } catch (e) { return null; }
  }

  function get(key) {
    var s = store();
    if (!s) return null;
    try {
      var raw = s.getItem(PREFIX + key);
      if (!raw) return null;
      var o = JSON.parse(raw);
      if (!o || o.exp < Date.now()) { s.removeItem(PREFIX + key); return null; }
      return o.v;
    } catch (e) { return null; }
  }

  function set(key, value, ttlMs) {
    var s = store();
    if (!s) return;
    try {
      s.setItem(PREFIX + key, JSON.stringify({ v: value, exp: Date.now() + ttlMs }));
    } catch (e) {
      clear(); // quota exceeded -> start fresh rather than fail
    }
  }

  function clear(prefix) {
    var s = store();
    if (!s) return;
    try {
      var drop = [];
      for (var i = 0; i < s.length; i++) {
        var k = s.key(i);
        if (k && k.indexOf(PREFIX + (prefix || '')) === 0) drop.push(k);
      }
      drop.forEach(function (k) { s.removeItem(k); });
    } catch (e) { /* ignore */ }
  }

  /** Returns cached value if fresh, otherwise runs fn() once (concurrent callers share the promise). */
  function wrap(key, ttlMs, fn, opts) {
    var force = opts && opts.force;
    if (!force) {
      var hit = get(key);
      if (hit !== null) return Promise.resolve(hit);
    }
    if (pending[key]) return pending[key];
    pending[key] = Promise.resolve()
      .then(fn)
      .then(function (v) { set(key, v, ttlMs); return v; })
      .finally(function () { delete pending[key]; });
    return pending[key];
  }

  window.AppCache = { get: get, set: set, clear: clear, wrap: wrap };
})();