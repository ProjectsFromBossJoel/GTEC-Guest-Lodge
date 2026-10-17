// Rate limiting. Two layers:
//   1) in-memory counter  – instant, catches bursts hitting a warm serverless instance
//   2) Firestore counter  – shared across all instances (collection `rateLimits`, no client access)
// If Firestore itself fails we fail OPEN (a Firestore hiccup should not stop real guests from booking)
// and the in-memory layer still applies.
import crypto from 'node:crypto';
import { getDb, Timestamp } from './firebase-admin.js';
import { writeAudit } from './audit1.js';

// ── Tune limits here ────────────────────────────────────────────────────────
// IPs on Ghanaian mobile networks are often shared by many people, so IP limits are generous;
// the per-phone and per-booking limits are the strict ones.
export const LIMITS = {
  sms_ip_min:     { limit: 5,  windowSec: 60 },
  sms_ip_hour:    { limit: 20, windowSec: 3600 },
  sms_phone_hour: { limit: 3,  windowSec: 3600 },
  sms_booking:    { limit: 2,  windowSec: 86400 },
  log_ip_min:     { limit: 30, windowSec: 60 },
};

const mem = new Map();

function memCheck(key, limit, windowMs) {
  const now = Date.now();
  const e = mem.get(key);
  if (!e || e.reset <= now) {
    mem.set(key, { count: 1, reset: now + windowMs });
    if (mem.size > 5000) for (const [k, v] of mem) if (v.reset <= now) mem.delete(k);
    return { ok: true, retryAfter: 0 };
  }
  e.count += 1;
  return e.count <= limit
    ? { ok: true, retryAfter: 0 }
    : { ok: false, retryAfter: Math.max(1, Math.ceil((e.reset - now) / 1000)) };
}

async function fsCheck(key, limit, windowSec) {
  const win = Math.floor(Date.now() / (windowSec * 1000));
  const resetAt = (win + 1) * windowSec * 1000;
  const id = crypto.createHash('sha256').update(key).digest('hex').slice(0, 40) + '_' + win;
  const db = getDb();
  const ref = db.collection('rateLimits').doc(id);
  const count = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const c = (snap.exists ? snap.data().count : 0) + 1;
    tx.set(ref, { count: c, expireAt: Timestamp.fromMillis(resetAt + 3600e3) });
    return c;
  });
  return { ok: count <= limit, retryAfter: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) };
}

export async function check({ scope, id, limit, windowSec }) {
  const key = scope + ':' + id;
  const m = memCheck(key, limit, windowSec * 1000);
  if (!m.ok) return m;
  try {
    return await fsCheck(key, limit, windowSec);
  } catch (err) {
    console.error('[ratelimit] firestore check failed, using memory only:', err && err.message);
    return m;
  }
}

/**
 * rules: [{ scope, id, limit, windowSec }]  e.g.  { scope: 'sms_ip_min', id: ip, ...LIMITS.sms_ip_min }
 * Returns true if the request may continue. Otherwise answers 429 itself and returns false.
 */
export async function enforce(req, res, rules) {
  for (const rule of rules) {
    if (!rule.id) continue; // nothing to key on
    const r = await check(rule);
    if (!r.ok) {
      // log only the first block per scope+id per window, so an attack cannot flood the audit log
      const first = memCheck('blocklog:' + rule.scope + ':' + rule.id, 1, rule.windowSec * 1000);
      if (first.ok) {
        await writeAudit(req, {
          type: 'security',
          event: 'rate_limited',
          status: 'blocked',
          detail: 'Limit ' + rule.limit + ' per ' + rule.windowSec + 's hit on ' + rule.scope,
          meta: { scope: rule.scope, limit: rule.limit, windowSec: rule.windowSec },
        });
      }
      res.setHeader('Retry-After', String(r.retryAfter));
      res.status(429).json({ error: 'Too many requests. Please try again shortly.', retryAfter: r.retryAfter });
      return false;
    }
  }
  return true;
}