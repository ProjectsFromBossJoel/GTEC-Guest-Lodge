// Small HTTP helpers shared by the API routes.

// Same list as send-sms.js, plus the firebaseapp.com alias
const DEFAULT_ORIGINS = [
  'https://gtecguestlodge.web.app',
  'https://gtecguestlodge.firebaseapp.com',
  'https://gtecguesthouse.web.app',
  'http://localhost:5000',
  'http://localhost:3000',
];

function allowedOrigins() {
  const env = process.env.ALLOWED_ORIGINS; // comma separated, optional
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_ORIGINS;
}

/**
 * Applies CORS + no-store headers. Returns false when the request is already answered
 * (preflight, or origin not allowed) so the caller should simply `return`.
 * NOTE: Origin can be faked by scripts. This keeps browsers honest; it is not authentication.
 */
export function applyCors(req, res) {
  const origin = req.headers.origin || '';
  const ok = origin && allowedOrigins().includes(origin);
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Vary', 'Origin');
  if (ok) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Max-Age', '86400');
  }
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return false;
  }
  if (!ok) {
    res.status(403).json({ error: 'forbidden' });
    return false;
  }
  return true;
}

export function getIp(req) {
  const h = req.headers || {};
  const xff = String(h['x-forwarded-for'] || '').split(',')[0].trim();
  return xff || String(h['x-real-ip'] || '') || (req.socket && req.socket.remoteAddress) || '';
}

export function readJson(req) {
  const b = req.body;
  if (b && typeof b === 'object') return b;
  if (typeof b === 'string') {
    try { return JSON.parse(b); } catch (_) { /* fall through */ }
  }
  return {};
}