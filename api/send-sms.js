// api/send-sms.js
// Vercel serverless function that sends booking SMS messages (MNotify).
// Called by the frontend (roomsui.js). Rate limited, and every outcome is written to the audit log.
import { enforce, LIMITS } from './_lib/ratelimit.js';
import { writeAudit } from './_lib/audit.js';
import { getIp } from './_lib/http.js';

export default async function handler(req, res) {
  const t0 = Date.now();

  // ── CORS ──
  const ALLOWED_ORIGINS = [
    'https://gtecguestlodge.web.app',
    'https://gtecguesthouse.web.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ];
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── Rate limit by IP (before any paid or slow work) ──
  const ip = getIp(req);
  if (!(await enforce(req, res, [
    { scope: 'sms_ip_min', id: ip, ...LIMITS.sms_ip_min },
    { scope: 'sms_ip_hour', id: ip, ...LIMITS.sms_ip_hour },
  ]))) return;

  try {
    const { customerPhone, bookingId, bookingDetails, recaptchaToken } = req.body || {};
    if (!customerPhone || !bookingId) {
      return res.status(400).json({ error: 'Missing customerPhone or bookingId' });
    }

    // ── Rate limit by phone number and booking (these do the real work) ──
    if (!(await enforce(req, res, [
      { scope: 'sms_phone_hour', id: String(customerPhone), ...LIMITS.sms_phone_hour },
      { scope: 'sms_booking', id: String(bookingId), ...LIMITS.sms_booking },
    ]))) return;

    // ── reCAPTCHA Enterprise verification ──
    const rcProject = process.env.RECAPTCHA_PROJECT_ID;
    const rcApiKey = process.env.RECAPTCHA_API_KEY;
    if (!rcProject || !rcApiKey) {
      console.error('[reCAPTCHA] Not configured on server');
      return res.status(500).json({ error: 'Server not configured' });
    }
    if (!recaptchaToken) {
      await writeAudit(req, {
        type: 'security', event: 'recaptcha_failed', status: 'blocked',
        bookingId, contact: customerPhone, contactKind: 'phone', detail: 'missing token',
      });
      return res.status(403).json({ error: 'Missing security token' });
    }

    let score = 0;
    try {
      const rcRes = await fetch(
        `https://recaptchaenterprise.googleapis.com/v1/projects/${rcProject}/assessments?key=${rcApiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            event: {
              token: recaptchaToken,
              siteKey: '6LdyWi0tAAAAABVOjmWK51Q1qIKsQpqIwRh3m4uh',
              expectedAction: 'BOOKING'
            }
          })
        }
      );
      const rc = await rcRes.json();
      const valid = rc.tokenProperties?.valid === true;
      const actionOk = rc.tokenProperties?.action === 'BOOKING';
      score = rc.riskAnalysis?.score ?? 0;
      if (!valid || !actionOk || score < 0.5) {
        console.warn('[reCAPTCHA] Rejected:', { valid, actionOk, score, reason: rc.tokenProperties?.invalidReason, error: rc.error?.message });
        await writeAudit(req, {
          type: 'security',
          event: valid && actionOk ? 'recaptcha_low' : 'recaptcha_failed',
          status: 'blocked',
          bookingId, contact: customerPhone, contactKind: 'phone',
          detail: valid && actionOk ? 'score ' + score : (rc.tokenProperties?.invalidReason || 'invalid token'),
          meta: { recaptchaScore: score },
        });
        return res.status(403).json({ error: 'Security check failed' });
      }
      console.log('[reCAPTCHA] ✅ Verified, score:', score);
    } catch (rcErr) {
      console.error('[reCAPTCHA] Verification error:', rcErr.message);
      await writeAudit(req, {
        type: 'security', event: 'recaptcha_failed', status: 'failed',
        bookingId, contact: customerPhone, contactKind: 'phone',
        detail: 'verification unavailable: ' + rcErr.message,
      });
      return res.status(500).json({ error: 'Security verification unavailable' });
    }

    // Parse booking details (stringified JSON)
    let details = {};
    try {
      details = typeof bookingDetails === 'string' ? JSON.parse(bookingDetails) : bookingDetails;
    } catch {
      details = { guestName: 'Guest', room: 'N/A', checkIn: 'N/A', checkOut: 'N/A', nights: 'N/A' };
    }
    details = details || {};

    const promises = [];

    // ────────────────────────────────
    // SMS via MNotify – always sends if configured
    // ────────────────────────────────
    const mnotifyKey = process.env.MNOTIFY_API_KEY;
    const mnotifySender = process.env.MNOTIFY_SENDER_ID; // e.g., 'GTECLodge'

    if (mnotifyKey && mnotifySender) {
      const totalAmount = details.price && details.nights
          ? (parseFloat(details.price) * parseInt(details.nights)).toFixed(2)
          : (details.amount || 'N/A');
      const smsMessage =
      `Hello ${details.guestName}, we have received your booking at GTEC Guest Lodge and your room is reserved.\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Room: ${details.room}${details.roomType ? ' (' + details.roomType + ')' : ''}\n` +
      `Check-in: ${details.checkIn}\n` +
      `Check-out: ${details.checkOut}\n` +
      `Nights: ${details.nights}\n\n` +
      `Total: GHS ${totalAmount}\n\n` +
      `Kindly check your email for Terms and Conditions. Thank you for choosing GTEC Guest Lodge!`;
      // MNotify expects local format: 024XXXXXXX (without country code)
      // Our customerPhone is already 233XXXXXXXXX
      const localPhone = customerPhone.startsWith('233')
        ? '0' + customerPhone.slice(3)
        : customerPhone;

      promises.push(
        (async () => {
          const started = Date.now();
          try {
            const url = `https://api.mnotify.com/api/sms/quick?key=${mnotifyKey}`;

            const response = await fetch(url, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                recipient: [localPhone],
                sender: mnotifySender,
                message: smsMessage,
                is_schedule: false,
                schedule_date: ''
              })
            });

            const data = await response.json();
            const durationMs = Date.now() - started;
            if (response.ok && data.code === '2000') {
              console.log('[SMS] ✅ MNotify message sent, campaign ID:', data.summary?._id);
              return { success: true, campaignId: data.summary?._id, httpStatus: response.status, durationMs };
            } else {
              console.error('[SMS] ❌ MNotify error:', data);
              return { success: false, error: data, httpStatus: response.status, durationMs };
            }
          } catch (err) {
            console.error('[SMS] ❌ Error:', err.message);
            return { success: false, error: err.message, durationMs: Date.now() - started };
          }
        })()
      );
    } else {
      console.log('[SMS] MNotify not configured – skipping');
    }

    const results = await Promise.allSettled(promises);
    const outcomes = results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: String(r.reason) });
    if (!promises.length) outcomes.push({ success: false, error: 'MNotify not configured' });
    const smsOk = outcomes.every(o => o.success);
    console.log('[Notify] Outcomes:', JSON.stringify(outcomes));

    // ── Audit: await BEFORE responding, or Vercel may freeze the function and cut the write off ──
    for (const o of outcomes) {
      await writeAudit(req, {
        type: 'sms',
        event: o.success ? 'sms_sent' : 'sms_failed',
        status: o.success ? 'success' : 'failed',
        bookingId,
        room: details.room,
        guestName: details.guestName,
        contact: customerPhone,
        contactKind: 'phone',
        detail: o.success ? '' : (typeof o.error === 'string' ? o.error : JSON.stringify(o.error)),
        meta: {
          provider: 'mnotify',
          campaignId: o.campaignId,
          httpStatus: o.httpStatus,
          durationMs: o.durationMs ?? (Date.now() - t0),
          recaptchaScore: score,
        },
      });
    }

    return res.status(200).json({ success: smsOk, message: smsOk ? 'SMS sent' : 'SMS not sent' });

  } catch (err) {
    console.error('Server error:', err);
    await writeAudit(req, {
      type: 'sms', event: 'sms_failed', status: 'failed',
      detail: 'server error: ' + (err && err.message), meta: { durationMs: Date.now() - t0 },
    });
    return res.status(500).json({ error: 'Internal server error' });
  }
}