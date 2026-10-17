// POST /api/log-event — the booking page reports booking + email outcomes here.
// Browser-reported rows are stored with source:'client' (untrusted: anyone can call this endpoint),
// so the Monitoring page shows them with a "client" badge. SMS and security rows come from the server itself.
import { applyCors, getIp, readJson } from './_lib/http.js';
import { enforce, LIMITS } from './_lib/ratelimit.js';
import { writeAudit } from './_lib/audit.js';

// event -> [type, status]. The server decides type and status; the browser only names the event.
const EVENTS = {
  booking_created:       ['booking', 'success'],
  booking_failed:        ['booking', 'failed'],
  booking_blocked:       ['booking', 'blocked'],
  email_sent:            ['email', 'success'],
  email_failed:          ['email', 'failed'],
  double_submit_blocked: ['security', 'blocked'],
  client_error:          ['security', 'warning'],
};

export default async function handler(req, res) {
  if (!applyCors(req, res)) return;
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });

  const len = Number(req.headers['content-length'] || 0);
  if (len > 4096) return res.status(413).json({ error: 'payload too large' });

  const ip = getIp(req);
  if (!(await enforce(req, res, [{ scope: 'log_ip_min', id: ip, ...LIMITS.log_ip_min }]))) return;

  const b = readJson(req);
  const def = EVENTS[b.event];
  if (!def) return res.status(400).json({ error: 'unknown event' });

  await writeAudit(req, {
    type: def[0],
    event: b.event,
    status: def[1],
    source: 'client',
    bookingId: b.bookingId,
    room: b.room,
    guestName: b.guestName,
    contact: b.contact,
    contactKind: b.contactKind === 'phone' ? 'phone' : 'email',
    detail: b.detail,
    meta: b.meta,
    deviceId: b.deviceId,
    env: b.env,
    page: b.page,
  });

  return res.status(204).end();
}