// Shared Firebase Admin helper. Reuses an app that another function already initialised.
// Needs the FIREBASE_SERVICE_ACCOUNT env var (raw JSON or base64 JSON) and `npm i firebase-admin`.
import admin from 'firebase-admin';

function init() {
  if (admin.apps.length) return;
  const raw = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT is not set');
  let cred;
  try {
    cred = JSON.parse(raw);
  } catch (_) {
    cred = JSON.parse(Buffer.from(raw, 'base64').toString('utf8'));
  }
  if (cred.private_key) cred.private_key = cred.private_key.replace(/\\n/g, '\n');
  admin.initializeApp({ credential: admin.credential.cert(cred) });
}

let configured = false;
export function getDb() {
  init();
  const db = admin.firestore();
  if (!configured) {
    try { db.settings({ ignoreUndefinedProperties: true }); } catch (_) { /* already configured */ }
    configured = true;
  }
  return db;
}

export const FieldValue = admin.firestore.FieldValue;
export const Timestamp = admin.firestore.Timestamp;