/*!
 * Audit (browser side) — reports booking / email events to the server for the Monitoring page.
 * Include on the public booking page (index.html):
 *     <script src="js/audit.js" defer></script>
 *
 *   Audit.report({
 *     type: 'booking' | 'email' | 'security',
 *     event: 'booking_created' | 'booking_failed' | 'booking_blocked' |
 *            'email_sent' | 'email_failed' | 'double_submit_blocked' | 'client_error',
 *     bookingId, room, guestName, contact, contactKind: 'email' | 'phone',
 *     detail: 'error text', meta: { template: 'template_zbbfaym', httpStatus: 200 }
 *   });
 *
 * Fire-and-forget: it never throws and never blocks the booking flow.
 * The server adds the IP address, IP-derived location, and parses the device from the User-Agent.
 * This file adds what the User-Agent no longer carries: device model and OS version (Chrome/Edge
 * "client hints"), screen and window size, CPU cores, memory and connection type.
 * Names, emails and phones are masked on the server before they are stored.
 */
(function () {
  'use strict';
  if (window.Audit) return;

  var ENDPOINT = window.AUDIT_ENDPOINT || 'https://gtec-whatsapp-api.vercel.app/api/log-event';

  function deviceId() {
    try {
      var id = localStorage.getItem('gtec_device_id');
      if (!id) {
        var a = new Uint8Array(8);
        crypto.getRandomValues(a);
        id = Array.prototype.map.call(a, function (b) { return ('0' + b.toString(16)).slice(-2); }).join('');
        localStorage.setItem('gtec_device_id', id);
      }
      return id;
    } catch (e) { return ''; }
  }

  // Client hints: async and Chromium-only (Chrome/Edge). Start fetching at load; never wait more than 800 ms.
  var hints = {};
  var hintsReady = (function () {
    var p = Promise.resolve();
    try {
      var uad = navigator.userAgentData;
      if (uad && uad.getHighEntropyValues) {
        p = uad.getHighEntropyValues(['model', 'platformVersion', 'uaFullVersion'])
          .then(function (h) { hints = h || {}; }, function () { /* ignore */ });
      }
    } catch (e) { /* ignore */ }
    return Promise.race([p, new Promise(function (resolve) { setTimeout(resolve, 800); })]);
  })();

  function env() {
    var tz = '';
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (e) { /* ignore */ }
    var conn = navigator.connection || {};
    return {
      screen: (screen.width || 0) + 'x' + (screen.height || 0),
      viewport: (window.innerWidth || 0) + 'x' + (window.innerHeight || 0),
      dpr: window.devicePixelRatio || 0,
      lang: navigator.language || '',
      tz: tz,
      touch: (navigator.maxTouchPoints || 0) > 0,
      platform: (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '',
      model: hints.model || '',
      osVersion: hints.platformVersion || '',
      browserVersion: hints.uaFullVersion || '',
      cores: navigator.hardwareConcurrency || 0,
      memory: navigator.deviceMemory || 0,
      conn: conn.effectiveType || ''
    };
  }

  function send(ev) {
    var body = JSON.stringify(Object.assign({}, ev, {
      deviceId: deviceId(),
      env: env(),
      page: location.pathname
    }));
    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body,
      keepalive: true,
      mode: 'cors'
    }).catch(function () { /* logging must never break the page */ });
  }

  window.Audit = {
    report: function (ev) {
      try {
        hintsReady.then(function () { try { send(ev); } catch (e) { /* ignore */ } });
      } catch (e) { /* ignore */ }
    }
  };
})();