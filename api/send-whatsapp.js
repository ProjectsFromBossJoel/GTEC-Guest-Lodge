// gtec-whatsapp-api/api/send-whatsapp.js
// This is the Vercel serverless function that sends WhatsApp messages
// It will be called by your frontend (roomsui.js)

// api/send-whatsapp.js
export default async function handler(req, res) {
  // ── CORS ──
  const ALLOWED_ORIGINS = [
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
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  // ── API Key check ──
  const API_SECRET = process.env.API_SECRET;
  if (API_SECRET && req.headers['x-api-key'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const { customerPhone, bookingId, bookingDetails } = req.body;
    if (!customerPhone || !bookingId) {
      return res.status(400).json({ error: 'Missing customerPhone or bookingId' });
    }

    // Parse booking details (stringified JSON)
    let details = {};
    try {
      details = typeof bookingDetails === 'string' ? JSON.parse(bookingDetails) : bookingDetails;
    } catch {
      details = { guestName: 'Guest', room: 'N/A', checkIn: 'N/A', checkOut: 'N/A', nights: 'N/A' };
    }

    const promises = [];

    // ────────────────────────────────
    // 1. WhatsApp attempt (if configured)
    // ────────────────────────────────
    const whatsappToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    const templateName = 'gtecguestlodge_booking_confirmation';
    const templateLang = 'en';

    if (whatsappToken && phoneNumberId) {
      promises.push(
        (async () => {
          try {
            const response = await fetch(
              `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`,
              {
                method: 'POST',
                headers: {
                  Authorization: `Bearer ${whatsappToken}`,
                  'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                  messaging_product: 'whatsapp',
                  to: customerPhone,
                  type: 'template',
                  template: {
                    name: templateName,
                    language: { code: templateLang },
                    components: [{
                      type: 'body',
                      parameters: [
                        { type: 'text', text: details.guestName || 'Guest' },
                        { type: 'text', text: bookingId },
                        { type: 'text', text: details.room || 'N/A' },
                        { type: 'text', text: details.checkIn || 'N/A' },
                        { type: 'text', text: details.checkOut || 'N/A' },
                        { type: 'text', text: details.nights?.toString() || 'N/A' }
                      ]
                    }]
                  }
                }),
              }
            );
            const data = await response.json();
            if (response.ok) {
              console.log('[WhatsApp] ✅ Template message sent');
              return { success: true };
            } else {
              console.error('[WhatsApp] ❌ Failed:', data);
              return { success: false, error: data };
            }
          } catch (err) {
            console.error('[WhatsApp] ❌ Error:', err.message);
            return { success: false, error: err.message };
          }
        })()
      );
    } else {
      console.log('[WhatsApp] Not configured – skipping');
    }

    // ────────────────────────────────
    // 2. SMS via MNotify – always sends if configured
    // ────────────────────────────────
    const mnotifyKey = process.env.MNOTIFY_API_KEY;
    const mnotifySender = process.env.MNOTIFY_SENDER_ID; // e.g., 'GTECLodge'

    if (mnotifyKey && mnotifySender) {
      const smsMessage = 
      `Hello ${details.guestName}, your booking at GTEC Guest Lodge is confirmed!\n\n` +
      `Booking ID: ${bookingId}\n` +
      `Room: ${details.room}\n` +
      `Check-in: ${details.checkIn}\n` +
      `Check-out: ${details.checkOut}\n` +
      `Nights: ${details.nights}\n\n` +
      `Thank you for choosing GTEC Guest Lodge!`;
      // MNotify expects local format: 024XXXXXXX (without country code)
      // Our customerPhone is already 233XXXXXXXXX
      const localPhone = customerPhone.startsWith('233') 
        ? '0' + customerPhone.slice(3) 
        : customerPhone;

      promises.push(
        (async () => {
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
            if (response.ok && data.code === '2000') {
              console.log('[SMS] ✅ MNotify message sent, campaign ID:', data.summary?._id);
              return { success: true, campaignId: data.summary?._id };
            } else {
              console.error('[SMS] ❌ MNotify error:', data);
              return { success: false, error: data };
            }
          } catch (err) {
            console.error('[SMS] ❌ Error:', err.message);
            return { success: false, error: err.message };
          }
        })()
      );
    } else {
      console.log('[SMS] MNotify not configured – skipping');
    }

    const results = await Promise.allSettled(promises);
    return res.status(200).json({ success: true, message: 'Notifications processed' });

  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}