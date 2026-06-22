// middleware/appCheck.js
import { initializeApp, cert } from 'firebase-admin/app';
import { getAppCheck } from 'firebase-admin/app-check';

// Initialize Firebase Admin SDK
const firebaseApp = initializeApp({
  credential: cert({
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  }),
});

export const verifyAppCheckToken = async (req, res, next) => {
  // 1. Get token from request header
  const appCheckToken = req.header('X-Firebase-AppCheck');
  
  if (!appCheckToken) {
    console.warn('Missing App Check token');
    return res.status(401).json({ error: 'Unauthorized: Missing App Check token' });
  }

  try {
    // 2. Verify the token using Admin SDK
    const appCheckClaims = await getAppCheck().verifyToken(appCheckToken);
    
    // 3. If verification succeeds, token is valid
    console.log('App Check token verified successfully');
    req.appCheckClaims = appCheckClaims;
    
    return next();
  } catch (error) {
    console.error('App Check verification failed:', error);
    return res.status(401).json({ error: 'Unauthorized: Invalid App Check token' });
  }
};