import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, getAuth } from 'firebase/auth';

const REQUIRED = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const missing = Object.entries(REQUIRED)
  .filter(([, v]) => !v)
  .map(([k]) => `VITE_FIREBASE_${k.replace(/([A-Z])/g, '_$1').toUpperCase()}`);
if (missing.length > 0) {
  throw new Error(`Missing Firebase env vars: ${missing.join(', ')}. Add them to .env.`);
}

const firebaseConfig = REQUIRED;

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();

// hd narrows the Google account picker UI — it does NOT enforce domain access.
// Server-side enforcement is in server/index.js (Firebase Admin verifyIdToken + email check).
googleProvider.setCustomParameters({ hd: 'pintel.ai' });
