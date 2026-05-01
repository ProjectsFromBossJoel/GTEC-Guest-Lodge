// js/logs.js
// ─────────────────────────────────────────────────────────────────────────────
// Login and logout logging is handled EXCLUSIVELY in auth.js.
// This file contains NO logging code to prevent duplicate log entries.
//
// _writeLog() and addLog() are both defined in auth.js which always
// loads before this file. All other scripts (checkin.js, checkout.js,
// verification.js, guests.js) call addLog() which is defined in auth.js.
// ─────────────────────────────────────────────────────────────────────────────