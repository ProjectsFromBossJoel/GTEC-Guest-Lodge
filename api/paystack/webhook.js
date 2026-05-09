// api/paystack/webhook.js
import crypto from 'crypto';
import admin from 'firebase-admin';

// ── Firebase Admin (with error logging) ────────────────────────────
let db;
try {
  if (!admin.apps.length) {
    const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
    if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is empty');
    const serviceAccount = JSON.parse(raw);
    admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
  }
  db = admin.firestore();
} catch (err) {
  console.error('[Webhook] Firebase init failed:', err.message);
}

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

// ── Handler ────────────────────────────────────────────────────────
export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // If Firebase is not ready, return an error
  if (!db) {
    console.error('[Webhook] Firebase not initialised');
    return res.status(500).json({ error: 'Firebase not initialised' });
  }

  // Verify webhook signature
  const signature = req.headers['x-paystack-signature'];
  const hash = crypto
    .createHmac('sha512', PAYSTACK_SECRET)
    .update(JSON.stringify(req.body))
    .digest('hex');

  if (hash !== signature) {
    console.warn('[Webhook] Invalid signature');
    return res.status(401).send('Unauthorized');
  }

  const event = req.body;
  console.log(`[Webhook] Event: ${event.event}`);

  if (event.event === 'charge.success') {
    const data = event.data;
    const metadata = data.metadata || {};
    const bookingId = metadata.bookingId;   // e.g. 'GH-12345'
    const roomId = metadata.roomId;

    if (!bookingId || !roomId) {
      console.error('[Webhook] Missing bookingId or roomId in metadata');
      return res.status(400).send('Bad request: missing metadata');
    }

    try {
      const batch = db.batch();

      // 🔁 FIX: guest doc is stored with 'idNumber' field, not as doc ID
      const guestQuery = await db.collection('guests')
        .where('idNumber', '==', bookingId)
        .limit(1)
        .get();

      if (!guestQuery.empty) {
        batch.update(guestQuery.docs[0].ref, {
          paymentStatus: 'paid',
          paymentRef: data.reference,
        });
      } else {
        console.warn(`[Webhook] No guest found with idNumber=${bookingId}`);
      }

      // Update invoice (same logic, already uses guestId field)
      const invoicesSnapshot = await db.collection('invoices')
        .where('guestId', '==', bookingId)
        .limit(1)
        .get();
      if (!invoicesSnapshot.empty) {
        batch.update(invoicesSnapshot.docs[0].ref, {
          paymentStatus: 'paid',
          subtotal: data.amount / 100,
          paymentMethod: 'momo',
        });
      }

      // Transaction record
      batch.set(db.collection('transactions').doc(bookingId), {
        reference: data.reference,
        status: 'success',
        bookingId,
        roomId,
        amount: data.amount / 100,
        paidAt: admin.firestore.FieldValue.serverTimestamp(),
      }, { merge: true });

      await batch.commit();
      console.log(`✅ Booking ${bookingId} marked as paid.`);
    } catch (err) {
      console.error('[Webhook] Firestore update failed:', err);
      return res.status(500).send('Error updating booking');
    }
  }

  res.status(200).send('OK');
}