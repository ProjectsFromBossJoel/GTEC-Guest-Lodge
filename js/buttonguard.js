/*!
 * ButtonGuard — loading spinner + double-tap protection for every button.
 *
 * Include once per page (in <head>, with defer):
 *     <script src="js/buttonguard.js" defer></script>
 *
 * Automatic behaviour (no code changes needed):
 *   - First click on a button  -> spinner shows, further clicks/Enter presses are swallowed.
 *   - The lock lifts when BOTH are true: at least 700 ms have passed AND no fetch() request is in flight.
 *     (hard stop after 15 s so a button can never stay stuck)
 *   - Forms: a second submit while the first is still locked is blocked too (Enter-key double submit).
 *
 * For slow Firestore / EmailJS work, wrap the handler so the button stays locked until it really finishes:
 *     btn.addEventListener('click', () => ButtonGuard.run(btn, async () => { ...await stuff... }));
 *
 * Opt-outs (toggles, tabs, pagination, menus):  <button data-guard="off">
 * Longer minimum lock for one button:           <button data-guard-ms="2500">
 *
 * NOTE: we deliberately do NOT set the `disabled` attribute. Disabling a submit button during its own
 * click cancels the form submission in Chrome. We use aria-disabled + a click-swallowing listener instead.
 */
(function () {
  'use strict';
  if (window.ButtonGuard) return;

  var CFG = {
    minMs: 700,
    maxMs: 15000,
    selector: 'button, input[type="submit"], input[type="button"], [role="button"], .btn',
    skip: '[data-guard="off"], .toggle-sidebar, .close, .modal-close, [data-dismiss], [data-bs-toggle], ' +
          '.fc-button, [role="tab"], .tab, .tab-btn, .pagination button, .no-guard, .no-guard *',
    // Requests that should never keep a button locked (fire-and-forget telemetry)
    ignoreFetch: /\/api\/log-event/
  };

  var states = new WeakMap();
  var active = new Set();
  var inflight = 0;

  /* ---- spinner CSS (injected so only one file is needed) ---- */
  var css =
    '.bg-loading{position:relative;pointer-events:none;cursor:progress!important;opacity:.72}' +
    '.bg-loading::before{content:"";display:inline-block;width:.9em;height:.9em;margin-right:.5em;' +
    'vertical-align:-.12em;border:2px solid currentColor;border-right-color:transparent;border-radius:50%;' +
    'animation:bg-spin .6s linear infinite}' +
    '@keyframes bg-spin{to{transform:rotate(360deg)}}' +
    '@media (prefers-reduced-motion:reduce){.bg-loading::before{animation-duration:1.8s}}';
  var style = document.createElement('style');
  style.setAttribute('data-buttonguard', '');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /* ---- count in-flight fetch() calls ---- */
  var nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input) {
      var url = typeof input === 'string' ? input : (input && input.url) || '';
      if (CFG.ignoreFetch.test(url)) return nativeFetch.apply(this, arguments);
      inflight++;
      var done = function () { inflight = Math.max(0, inflight - 1); };
      var p;
      try { p = nativeFetch.apply(this, arguments); } catch (e) { done(); throw e; }
      p.then(done, done);
      return p;
    };
  }

  function guardable(el) {
    if (!el || el.nodeType !== 1) return false;
    if (el.matches(CFG.skip)) return false;
    if (el.type === 'reset') return false;
    if (el.disabled) return false;
    return true;
  }

  function lock(el) {
    var st = {
      start: Date.now(),
      manual: false,
      minMs: Number(el.getAttribute('data-guard-ms')) || CFG.minMs,
      timer: null
    };
    states.set(el, st);
    active.add(el);
    el.classList.add('bg-loading');
    el.setAttribute('aria-busy', 'true');
    el.setAttribute('aria-disabled', 'true');
    st.timer = setInterval(function () {
      if (st.manual) return;
      var age = Date.now() - st.start;
      if ((age >= st.minMs && inflight === 0) || age >= CFG.maxMs) release(el);
    }, 100);
  }

  function release(el) {
    var st = states.get(el);
    if (!st) return;
    clearInterval(st.timer);
    states.delete(el);
    active.delete(el);
    el.classList.remove('bg-loading');
    el.removeAttribute('aria-busy');
    el.removeAttribute('aria-disabled');
  }

  /* ---- click guard (capture phase = runs before the page's own handlers) ---- */
  document.addEventListener('click', function (e) {
    var el = e.target && e.target.closest ? e.target.closest(CFG.selector) : null;
    if (!el || !guardable(el)) return;
    if (states.has(el)) {              // already busy -> swallow the repeat
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    lock(el);
  }, true);

  /* ---- form guard (Enter-key / programmatic double submit) ---- */
  document.addEventListener('submit', function (e) {
    var form = e.target;
    if (!form || form.nodeType !== 1 || form.matches('[data-guard="off"]')) return;
    if (form.__bgBusy) {
      e.preventDefault();
      e.stopImmediatePropagation();
      return;
    }
    form.__bgBusy = true;
    var start = Date.now();
    var t = setInterval(function () {
      var age = Date.now() - start;
      if ((age >= CFG.minMs && inflight === 0) || age >= CFG.maxMs) {
        clearInterval(t);
        form.__bgBusy = false;
      }
    }, 100);
    // Submitter may not have been caught by the click handler (Enter key)
    var sub = e.submitter;
    if (sub && guardable(sub) && !states.has(sub)) lock(sub);
  }, true);

  /* ---- back/forward cache: never restore a page with stuck spinners ---- */
  window.addEventListener('pageshow', function (e) {
    if (e.persisted) active.forEach(release);
  });

  /* ---- public API ---- */
  window.ButtonGuard = {
    /** Keep `el` locked until fn() settles. Ignores the call if it is already running. */
    run: async function (el, fn) {
      var st = states.get(el);
      if (st && st.manual) return undefined;
      if (!st) { lock(el); st = states.get(el); }
      st.manual = true;
      try {
        return await fn();
      } finally {
        var wait = Math.max(0, 300 - (Date.now() - st.start)); // avoid a spinner flash
        setTimeout(function () { release(el); }, wait);
      }
    },
    isBusy: function (el) { return states.has(el); },
    lock: lock,
    release: release
  };
})();