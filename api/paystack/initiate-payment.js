// api/paystack/initiate-payment.js
export default async function handler(req, res) {
  // CORS (allow your booking site)
  const ALLOWED_ORIGINS = [
    'https://gtecguestlodge.web.app',
    'https://gtecguesthouse.web.app',
    'http://localhost:5000', // for local testing
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

  const { email, amount, phone, network, bookingId, roomId } = req.body;
  if (!email || !amount || !phone || !network || !bookingId || !roomId) {
    return res.status(400).json({ error: 'Missing fields' });
  }

  const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;
  if (!PAYSTACK_SECRET) {
    return res.status(500).json({ error: 'Server configuration error' });
  }

  // amount should be in cedis; convert to pesewas for Paystack
  const amountInPesewas = Math.round(parseFloat(amount) * 100);

  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email,
        amount: amountInPesewas,
        currency: 'GHS',
        channels: ['mobile_money'],
        mobile_money: {
          phone: phone,       // 233XXXXXXXXX
          provider: network,  // 'mtn', 'vod', 'tigo'
        },
        metadata: {
          bookingId,
          roomId,
        },
      }),
    });

    const json = await response.json();
    if (json.status) {
      return res.status(200).json({
        authorization_url: json.data.authorization_url,
        reference: json.data.reference,
      });
    } else {
      return res.status(500).json({ error: json.message });
    }
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
}