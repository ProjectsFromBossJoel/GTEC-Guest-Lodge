// api/paystack/webhook.js
import crypto from 'crypto';
import admin from 'firebase-admin';

// Initialize Firebase Admin (only once per cold start)
if (!admin.apps.length) {
  const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });
}

const db = admin.firestore();
const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

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
    const bookingId = metadata.bookingId;
    const roomId = metadata.roomId;

    if (!bookingId || !roomId) {
      console.error('[Webhook] Missing bookingId or roomId in metadata');
      return res.status(400).send('Bad request: missing metadata');
    }

    try {
      const batch = db.batch();

      // Update guest booking
      const guestRef = db.collection('guests').doc(bookingId);
      batch.update(guestRef, {
        paymentStatus: 'paid',
        paymentRef: data.reference,
      });

      // Update invoice (if there's one matching the guestId)
      const invoicesSnapshot = await db.collection('invoices')
        .where('guestId', '==', bookingId)
        .limit(1)
        .get();
      if (!invoicesSnapshot.empty) {
        const invoiceRef = invoicesSnapshot.docs[0].ref;
        batch.update(invoiceRef, {
          paymentStatus: 'paid',
          subtotal: data.amount / 100,
          paymentMethod: 'momo',
        });
      }

      // Optionally create a transaction record
      const transactionRef = db.collection('transactions').doc(bookingId);
      batch.set(transactionRef, {
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