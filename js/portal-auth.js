/* Sign-in and sign-up page logic. Chosen by <body data-page="signin|signup">. */
(function () {
  'use strict';
  var P = window.Portal, $ = P.$, esc = P.esc;
  var page = document.body.getAttribute('data-page');
  var working = false;

  function msg(text, kind) {
    var m = $('pt-msg');
    if (!text) { m.className = 'pt-hide'; m.textContent = ''; return; }
    m.className = 'pt-alert ' + (kind || 'err');
    m.textContent = text;
    m.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
  function fieldErr(id, text) {
    var e = $(id + '-err'), i = $(id);
    if (e) e.textContent = text || '';
    if (i) i.setAttribute('aria-invalid', text ? 'true' : 'false');
    return !text;
  }
  function clearErrs() { ['name', 'email', 'phone', 'password', 'password2', 'agree'].forEach(function (f) { fieldErr(f, ''); }); msg(''); }

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  function goAccount() { location.replace(P.safeNext(P.CFG.paths.account)); }

  /* keep ?next on the cross links */
  function carryNext() {
    var n = new URLSearchParams(location.search).get('next');
    if (!n) return;
    ['to-signup', 'to-signin'].forEach(function (id) {
      var a = $(id); if (a) a.href = a.getAttribute('href').split('?')[0] + '?next=' + encodeURIComponent(n);
    });
  }

  function bindShowPassword() {
    document.querySelectorAll('[data-toggle]').forEach(function (b) {
      b.addEventListener('click', function () {
        var i = $(b.getAttribute('data-toggle')), show = i.type === 'password';
        i.type = show ? 'text' : 'password';
        b.textContent = show ? 'Hide' : 'Show';
      });
    });
  }

  function persistence() {
    var remember = $('remember') ? $('remember').checked : true;
    var A = firebase.auth.Auth.Persistence;
    return P.auth.setPersistence(remember ? A.LOCAL : A.SESSION).catch(function () { /* non-fatal */ });
  }

  function google(btn) {
    clearErrs();
    return P.busy(btn, function () {
      working = true;
      return persistence().then(function () {
        return P.auth.signInWithPopup(new firebase.auth.GoogleAuthProvider());
      }).then(function (res) {
        return P.ensureProfile(res.user).then(goAccount);
      }).catch(function (e) {
        working = false;
        if (e && e.code === 'auth/popup-blocked') return P.auth.signInWithRedirect(new firebase.auth.GoogleAuthProvider());
        msg(P.authError(e));
      });
    });
  }

  /* ---------------- sign in ---------------- */
  function initSignin() {
    $('pt-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); clearErrs();
      var email = $('email').value.trim().toLowerCase(), pw = $('password').value;
      var ok = fieldErr('email', EMAIL_RE.test(email) ? '' : 'Enter a valid e-mail address.');
      ok = fieldErr('password', pw ? '' : 'Enter your password.') && ok;
      if (!ok) return;
      P.busy($('submit'), function () {
        working = true;
        return persistence().then(function () { return P.auth.signInWithEmailAndPassword(email, pw); })
          .then(function (cred) { return P.ensureProfile(cred.user).catch(function () { /* account.js retries */ }); })
          .then(goAccount)
          .catch(function (e) { working = false; msg(P.authError(e)); });
      });
    });

    $('forgot').addEventListener('click', function (ev) {
      ev.preventDefault(); clearErrs();
      var email = $('email').value.trim().toLowerCase();
      if (!fieldErr('email', EMAIL_RE.test(email) ? '' : 'Type your e-mail above first, then press “Forgot password”.')) return;
      // Same message whether or not the account exists, so the form can't be used to discover who has an account.
      P.auth.sendPasswordResetEmail(email).catch(function (e) {
        if (e && (e.code === 'auth/too-many-requests' || e.code === 'auth/network-request-failed')) msg(P.authError(e));
      });
      msg('If an account exists for ' + email + ', we’ve sent a link to reset the password. Check your inbox and spam folder.', 'ok');
    });
  }

  /* ---------------- sign up ---------------- */
  function strength(pw) {
    var s = 0;
    if (pw.length >= 8) s++;
    if (pw.length >= 12) s++;
    if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) s++;
    if (/\d/.test(pw)) s++;
    if (/[^A-Za-z0-9]/.test(pw)) s++;
    return Math.min(s, 4);
  }

  function initSignup() {
    var meter = $('meter'), txt = $('meter-txt');
    $('password').addEventListener('input', function () {
      var s = strength(this.value);
      meter.style.width = (this.value ? (s + 1) * 20 : 0) + '%';
      meter.style.background = ['#b3261e', '#b3261e', '#c27a1e', '#4f8f3a', '#1c7c4a'][s];
      txt.textContent = this.value ? ['Too weak', 'Weak', 'Fair', 'Good', 'Strong'][s] : 'At least 8 characters, with letters and numbers.';
    });

    $('pt-form').addEventListener('submit', function (ev) {
      ev.preventDefault(); clearErrs();
      if ($('website').value) return;                                   // honeypot: bots fill hidden fields
      var name = $('name').value.trim().replace(/\s+/g, ' '),
          email = $('email').value.trim().toLowerCase(),
          phone = $('phone').value.replace(/[\s\-()]/g, ''),
          pw = $('password').value, pw2 = $('password2').value;
      var ok = true;
      ok = fieldErr('name', name.length >= 2 ? '' : 'Enter your full name.') && ok;
      ok = fieldErr('email', EMAIL_RE.test(email) ? '' : 'Enter a valid e-mail address.') && ok;
      ok = fieldErr('phone', /^\+?\d{9,15}$/.test(phone) ? '' : 'Enter a valid phone number.') && ok;
      ok = fieldErr('password', pw.length >= 8 && /[A-Za-z]/.test(pw) && /\d/.test(pw) ? '' : 'Use at least 8 characters with letters and numbers.') && ok;
      ok = fieldErr('password2', pw === pw2 ? '' : 'Passwords don’t match.') && ok;
      ok = fieldErr('agree', $('agree').checked ? '' : 'Please accept to continue.') && ok;
      if (!ok) return;

      P.busy($('submit'), function () {
        working = true;
        var user;
        return P.auth.createUserWithEmailAndPassword(email, pw).then(function (cred) {
          user = cred.user;
          return user.updateProfile({ displayName: name }).catch(function () {});
        }).then(function () {
          return P.ensureProfile(user, { name: name, phone: phone });
        }).then(function () {
          return user.sendEmailVerification().catch(function () {});     // account.js lets them resend
        }).then(goAccount).catch(function (e) { working = false; msg(P.authError(e)); });
      });
    });
  }

  /* ---------------- boot ---------------- */
  function boot() {
    try { P.init(); } catch (e) { msg(e.message); $('submit').disabled = true; return; }
    carryNext(); bindShowPassword();
    $('google').addEventListener('click', function () { google(this); });
    if (page === 'signin') initSignin(); else initSignup();

    // Returned from a Google redirect, or already signed in → straight to the account.
    var off = P.auth.onAuthStateChanged(function (u) {
      off();
      if (u && !working) goAccount();
    });
    P.auth.getRedirectResult().then(function (r) { if (r && r.user) return P.ensureProfile(r.user).then(goAccount); }).catch(function (e) { msg(P.authError(e)); });
  }
  document.addEventListener('DOMContentLoaded', boot);
})();
