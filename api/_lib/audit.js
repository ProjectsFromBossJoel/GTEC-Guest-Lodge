// Server-side audit writer. Every row lands in Firestore `auditLogs` (browsers can never write there;
// only this Admin-SDK code can). Personal data is masked, IPs are stored as a salted hash.
import crypto from 'node:crypto';
import { getDb, FieldValue, Timestamp } from './firebase-admin.js';
import { getIp } from './http.js';

const RETENTION_DAYS = 90; // pair with a Firestore TTL policy on auditLogs.expireAt

const str = (v, max) => (v === undefined || v === null ? '' : String(v).slice(0, max));

function hmac(value) {
  const salt = process.env.AUDIT_SALT || 'change-me-set-AUDIT_SALT';
  return crypto.createHmac('sha256', salt).update(String(value)).digest('hex');
}

export function maskPhone(p) {
  const s = String(p || '').replace(/[^\d+]/g, '');
  if (s.length < 7) return s ? '•••' : '';
  return s.slice(0, 3) + '•••' + s.slice(-4);
}
export function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return s ? '•••' : '';
  return s[0] + '•••' + s.slice(at);
}
export function maskName(n) {
  const parts = String(n || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '';
  return parts.length === 1 ? parts[0].slice(0, 20) : parts[0].slice(0, 20) + ' ' + parts[parts.length - 1][0] + '.';
}

function parseUA(ua, env) {
  ua = String(ua || '');
  env = env && typeof env === 'object' ? env : {};
  const script = /curl|wget|python-requests|python-urllib|node-fetch|axios|PostmanRuntime|insomnia|go-http-client|httpie|java\//i.test(ua);
  const browser = script ? 'Script/Tool'
    : /Edg\//.test(ua) ? 'Edge'
    : /OPR\/|Opera/.test(ua) ? 'Opera'
    : /SamsungBrowser/.test(ua) ? 'Samsung Internet'
    : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome'
    : /Safari\//.test(ua) ? 'Safari'
    : ua ? 'Other' : 'None';
  const os = /Windows NT/.test(ua) ? 'Windows'
    : /Android/.test(ua) ? 'Android'
    : /iPhone|iPad|iPod/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS'
    : /CrOS/.test(ua) ? 'ChromeOS'
    : /Linux/.test(ua) ? 'Linux'
    : '';
  const type = script || !ua ? 'bot'
    : /iPad|Tablet/.test(ua) ? 'tablet'
    : /Mobi|Android|iPhone/.test(ua) ? 'mobile'
    : 'desktop';
  return {
    browser,
    os,
    type,
    screen: str(env.screen, 20),
    lang: str(env.lang, 12),
    tz: str(env.tz, 40),
    ua: ua.slice(0, 160),
  };
}

function netInfo(req) {
  const h = req.headers || {};
  const ip = getIp(req);
  let city = '';
  try { city = decodeURIComponent(h['x-vercel-ip-city'] || ''); } catch (_) { city = String(h['x-vercel-ip-city'] || ''); }
  return {
    ipHash: ip ? hmac(ip).slice(0, 12) : '',
    country: str(h['x-vercel-ip-country'], 4),
    region: str(h['x-vercel-ip-country-region'], 12),
    city: str(city, 60),
  };
}

function cleanMeta(meta) {
  const out = {};
  if (!meta || typeof meta !== 'object') return out;
  Object.keys(meta).slice(0, 12).forEach((k) => {
    const v = meta[k];
    if (typeof v === 'number' && isFinite(v)) out[str(k, 30)] = v;
    else if (typeof v === 'boolean') out[str(k, 30)] = v;
    else if (typeof v === 'string') out[str(k, 30)] = v.slice(0, 120);
  });
  return out;
}

/**
 * type:   'booking' | 'email' | 'sms' | 'security'
 * status: 'success' | 'failed' | 'blocked' | 'warning' | 'info'
 * Never throws — an audit failure must not break the real request.
 * In serverless code, `await` this BEFORE sending the response, or the write may be cut off.
 */
export async function writeAudit(req, e) {
  try {
    const kind = e.contactKind || (e.type === 'sms' ? 'phone' : 'email');
    await getDb().collection('auditLogs').add({
      type: str(e.type, 20),
      event: str(e.event, 40),
      status: str(e.status || 'info', 12),
      source: e.source === 'client' ? 'client' : 'server',
      bookingId: str(e.bookingId, 40),
      room: str(e.room, 20),
      guestName: maskName(e.guestName),
      contact: kind === 'phone' ? maskPhone(e.contact) : maskEmail(e.contact),
      detail: str(e.detail, 300),
      meta: cleanMeta(e.meta),
      deviceId: str(e.deviceId, 24),
      device: parseUA(req.headers && req.headers['user-agent'], e.env),
      net: netInfo(req),
      page: str(e.page, 80),
      ts: FieldValue.serverTimestamp(),
      expireAt: Timestamp.fromMillis(Date.now() + RETENTION_DAYS * 864e5),
    });
  } catch (err) {
    console.error('[audit] write failed:', err && err.message);
  }
}