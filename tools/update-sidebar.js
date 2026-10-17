#!/usr/bin/env node
/*
 * One-time site update. Run from the repo root (the folder that holds dashboard.html):
 *
 *     node tools/update-sidebar.js --dry     # shows what would change, writes nothing
 *     node tools/update-sidebar.js           # applies it
 *
 * For every *.html in the folder (not subfolders) it:
 *   1. removes the "Payments" sidebar link            (there is no payment system for now)
 *   2. adds a "Monitoring" link after the "Roles" link (admin pages only)
 *   3. adds <script src="js/buttonguard.js" defer> before </head>  (spinner + double-tap protection)
 *   4. index.html only: also adds js/audit.js
 * It is safe to run twice — it skips anything already done. Use `git diff` to review.
 *
 * Skip pages with:  --skip=verification.html,card.html
 */
const fs = require('fs');
const path = require('path');

const dry = process.argv.includes('--dry');
const skipArg = process.argv.find((a) => a.startsWith('--skip='));
const skip = new Set((skipArg ? skipArg.slice(7).split(',') : []).map((s) => s.trim()));

const PAYMENTS = /[ \t]*<a\s+(?=[^>]*href="payments\.html")(?=[^>]*menu-item)[^>]*>[\s\S]*?<\/a>[ \t]*\r?\n?/g;
const ROLES = /(<a\s+(?=[^>]*href="roles\.html")(?=[^>]*menu-item)[^>]*>[\s\S]*?<\/a>)/;
const MONITORING = '<a href="monitoring.html" class="menu-item"><i class="fas fa-shield-halved"></i> Monitoring</a>';

const files = fs.readdirSync(process.cwd()).filter((f) => f.endsWith('.html') && !skip.has(f));
let touched = 0;

for (const f of files) {
  const p = path.join(process.cwd(), f);
  const before = fs.readFileSync(p, 'utf8');
  let html = before;
  const notes = [];

  // 1. remove Payments
  const removed = (html.match(PAYMENTS) || []).length;
  if (removed) { html = html.replace(PAYMENTS, ''); notes.push('removed Payments link x' + removed); }

  // 2. add Monitoring (not on monitoring.html itself, which already has it, active)
  if (f !== 'monitoring.html' && !html.includes('href="monitoring.html"') && ROLES.test(html)) {
    html = html.replace(ROLES, '$1\n                ' + MONITORING);
    notes.push('added Monitoring link');
  }

  // 3 + 4. scripts
  const heads = [];
  if (f !== 'monitoring.html' && !html.includes('js/buttonguard.js')) heads.push('<script src="js/buttonguard.js" defer></script>');
  if (f === 'index.html' && !html.includes('js/audit.js')) heads.push('<script src="js/audit.js" defer></script>');
  if (heads.length && /<\/head>/i.test(html)) {
    html = html.replace(/<\/head>/i, '    ' + heads.join('\n    ') + '\n</head>');
    notes.push('added ' + heads.length + ' script tag(s)');
  }

  if (html !== before) {
    touched++;
    console.log((dry ? '[dry] ' : '') + f + ': ' + notes.join(', '));
    if (!dry) fs.writeFileSync(p, html);
  }
}

console.log('\n' + (dry ? 'Would change ' : 'Changed ') + touched + ' of ' + files.length + ' HTML file(s).');