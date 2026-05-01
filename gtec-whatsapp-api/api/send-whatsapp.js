// gtec-whatsapp-api/api/send-whatsapp.js
// This is the Vercel serverless function that sends WhatsApp messages
// It will be called by your frontend (roomsui.js)

export default async function handler(req, res) {
  // ── CORS: allow only your Firebase domain + local testing ──
  const ALLOWED_ORIGINS = [
    'https://gtecguesthouse.web.app',
    'http://localhost:5000',
    'http://localhost:3000',
  ];
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  } else if (origin) {
    // If an unknown origin, we can still set '*' or just not set it (safer not to)
    // For security, we’ll only respond if it's an allowed origin
    return res.status(403).json({ error: 'Origin not allowed' });
  }
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-api-key');

  // Handle preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // Only POST accepted
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // ── OPTIONAL: simple API key check (recommended) ──
  const API_SECRET = process.env.API_SECRET;
  if (API_SECRET && req.headers['x-api-key'] !== API_SECRET) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // ── Main logic ──
  try {
    const { customerPhone, bookingId, bookingDetails } = req.body;
    if (!customerPhone || !bookingId) {
      return res.status(400).json({ error: 'Missing customerPhone or bookingId' });
    }

    const accessToken = process.env.WHATSAPP_TOKEN;
    const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
    if (!accessToken || !phoneNumberId) {
      return res.status(500).json({ error: 'Server missing WhatsApp credentials' });
    }

    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

    const messageBody = `🎉 Your booking is confirmed!\n\n` +
      `Booking ID: ${bookingId}\n` +
      `${bookingDetails}\n\n` +
      `Thank you for choosing GTEC Guest Lodge!`;

    const fbRes = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: customerPhone,   // e.g. "233241234567"
        type: 'text',
        text: { body: messageBody },
      }),
    });

    const data = await fbRes.json();

    if (fbRes.ok) {
      return res.status(200).json({ success: true, data });
    } else {
      console.error('WhatsApp API error:', data);
      return res.status(fbRes.status).json({ success: false, error: data });
    }
  } catch (err) {
    console.error('Server error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}