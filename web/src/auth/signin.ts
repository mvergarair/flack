import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithRedirect,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  signOut as fbSignOut,
} from 'firebase/auth';
import { ref, set } from 'firebase/database';
import { auth, rtdb, USE_EMULATORS } from '../firebase';

export async function signInWithGoogle(loginHint?: string) {
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account', ...(loginHint ? { login_hint: loginHint } : {}) });
  try {
    await signInWithPopup(auth, provider);
  } catch (err) {
    // Installed iOS PWAs sometimes can't open popups; fall back to a full-page redirect.
    if ((err as { code?: string }).code === 'auth/popup-blocked') {
      await signInWithRedirect(auth, provider);
      return;
    }
    throw err;
  }
}

/** Emulator-only email/password sign-in (the form is compiled out of production builds). */
export async function signInWithPassword(email: string, password: string, create: boolean) {
  if (!USE_EMULATORS) throw new Error('Password sign-in is only available against the emulators.');
  if (create) await createUserWithEmailAndPassword(auth, email, password);
  else await signInWithEmailAndPassword(auth, email, password);
}

let manualSignOut = false;
/** True once if the last sign-out was requested by the user (vs. ended by the server). */
export function consumeManualSignOut(): boolean {
  const v = manualSignOut;
  manualSignOut = false;
  return v;
}

export async function signOut() {
  manualSignOut = true;
  const uid = auth.currentUser?.uid;
  if (uid) {
    try {
      const device = localStorage.getItem('flack:deviceId');
      if (device) await set(ref(rtdb, `status/${uid}/${device}`), { state: 'offline', lastChanged: Date.now() });
    } catch {
      // Best effort.
    }
  }
  await fbSignOut(auth);
}
