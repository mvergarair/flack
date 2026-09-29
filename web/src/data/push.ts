import { useCallback, useEffect, useState } from 'react';
import { deleteField, doc, FieldPath, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { deleteToken, getMessaging, getToken, isSupported, onMessage } from 'firebase/messaging';
import { app, db, USE_EMULATORS } from '../firebase';
import { registerServiceWorker } from '../lib/sw-register';
import { pushSupport, type PushData, type PushSupport } from '../lib/push-routing';

const TOKEN_KEY = 'flack:pushToken';

function currentSupport(): PushSupport {
  const nav = navigator as Navigator & { standalone?: boolean };
  return pushSupport({
    hasNotification: 'Notification' in window,
    hasServiceWorker: 'serviceWorker' in navigator,
    hasPushManager: 'PushManager' in window,
    permission: 'Notification' in window ? Notification.permission : undefined,
    userAgent: navigator.userAgent,
    standalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
    maxTouchPoints: navigator.maxTouchPoints,
  });
}

const storedToken = () => {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
};
const storeToken = (t: string | null) => {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, t);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    // ignore
  }
};

/**
 * Gets this device's FCM token (the service worker receives the pushes). Against the
 * emulators there is no FCM, so a fake token is used; the notifications function records
 * pushes in _debug/pushes instead of sending them.
 */
async function fetchToken(): Promise<string> {
  if (USE_EMULATORS) return storedToken() ?? `emulator-${crypto.randomUUID()}`;
  if (!(await isSupported())) throw new Error('Push notifications are not supported in this browser.');
  const registration = await registerServiceWorker();
  if (!registration) throw new Error('Service worker unavailable.');
  // No vapidKey: the SDK falls back to Firebase's default web push key.
  return getToken(getMessaging(app), { serviceWorkerRegistration: registration });
}

async function saveToken(uid: string, token: string) {
  await setDoc(
    doc(db, 'users', uid, 'private', 'tokens'),
    { tokens: { [token]: { createdAt: serverTimestamp(), ua: navigator.userAgent.slice(0, 200) } } },
    { merge: true },
  );
  storeToken(token);
}

export async function enablePush(uid: string): Promise<PushSupport> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'default';
  await saveToken(uid, await fetchToken());
  return 'granted';
}

export async function disablePush(uid: string) {
  const token = storedToken();
  if (token) {
    await updateDoc(doc(db, 'users', uid, 'private', 'tokens'), new FieldPath('tokens', token), deleteField()).catch(() => undefined);
    if (!USE_EMULATORS) await deleteToken(getMessaging(app)).catch(() => undefined);
  }
  storeToken(null);
}

export function usePushState(uid: string | undefined) {
  const [support, setSupport] = useState<PushSupport>(() => currentSupport());
  const [enabled, setEnabled] = useState(() => !!storedToken() && currentSupport() === 'granted');

  const enable = useCallback(async () => {
    if (!uid) return;
    const s = await enablePush(uid);
    setSupport(s);
    setEnabled(s === 'granted');
  }, [uid]);

  const disable = useCallback(async () => {
    if (!uid) return;
    await disablePush(uid);
    setEnabled(false);
  }, [uid]);

  return { support, enabled, enable, disable };
}

/**
 * While signed in: keep this device's token fresh (tokens rotate) and surface pushes that
 * arrive while the app is in the foreground as an in-app toast.
 */
export function usePushSync(uid: string | undefined, onForeground: (data: PushData) => void) {
  useEffect(() => {
    if (!uid || currentSupport() !== 'granted' || !storedToken()) return;
    let unsub: (() => void) | undefined;
    (async () => {
      try {
        const token = await fetchToken();
        await saveToken(uid, token); // also refreshes createdAt for this device
        if (!USE_EMULATORS && (await isSupported())) {
          unsub = onMessage(getMessaging(app), (payload) => onForeground((payload.data ?? {}) as PushData));
        }
      } catch {
        // Not fatal: pushes just won't arrive on this device.
      }
    })();
    return () => unsub?.();
  }, [uid, onForeground]);
}
