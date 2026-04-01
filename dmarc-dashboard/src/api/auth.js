import { signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, googleProvider } from '../firebase';

export async function signInWithGoogle() {
  const result = await signInWithPopup(auth, googleProvider);
  if (!result.user.email.endsWith('@pintel.ai')) {
    await firebaseSignOut(auth);
    throw new Error('Only @pintel.ai accounts are allowed.');
  }
  return result.user;
}

export async function logout() {
  await firebaseSignOut(auth);
}

export function onAuthChange(callback) {
  return auth.onAuthStateChanged(callback);
}

export async function getIdToken() {
  const user = auth.currentUser;
  if (!user) return null;
  return user.getIdToken();
}
