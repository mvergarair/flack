import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { useLocation } from 'react-router';
import { get, onDisconnect, onValue, ref, remove, serverTimestamp, set, update } from 'firebase/database';
import { rtdb, USE_EMULATORS } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { useDocumentVisible } from '../lib/hooks';

const IDLE_MS = 10 * 60_000;
const DEVICE_KEY = 'flack:deviceId';
const STALE_DEVICE_MS = 30 * 86_400_000;

/** Stable random id for this browser/app install (presence is tracked per device). */
function deviceId(): string {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = Array.from(crypto.getRandomValues(new Uint8Array(9)), (b) => 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36]).join('');
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return 'nostorage';
  }
}
const MANUAL_AWAY_KEY = 'flack:manualAway';

/** Idle threshold; the emulator build lets tests shorten it via localStorage. */
function idleMs(): number {
  if (USE_EMULATORS) {
    try {
      const v = Number(localStorage.getItem('flack:idleMs'));
      if (v > 0) return v;
    } catch {
      // ignore
    }
  }
  return IDLE_MS;
}

// ---- manual "Set yourself away" (per device) ----
const listeners = new Set<() => void>();
function readManualAway(): boolean {
  try {
    return localStorage.getItem(MANUAL_AWAY_KEY) === '1';
  } catch {
    return false;
  }
}
export function setManualAway(on: boolean) {
  try {
    if (on) localStorage.setItem(MANUAL_AWAY_KEY, '1');
    else localStorage.removeItem(MANUAL_AWAY_KEY);
  } catch {
    // ignore
  }
  listeners.forEach((l) => l());
}
export function useManualAway(): boolean {
  return useSyncExternalStore(
    (cb) => (listeners.add(cb), () => listeners.delete(cb)),
    readManualAway,
  );
}

/** True after `ms` without input (or while the page has been hidden that long). */
function useIdle(ms: number): boolean {
  const [idle, setIdle] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => {
    const arm = () => {
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setIdle(true), ms);
    };
    const activity = () => {
      if (document.visibilityState !== 'visible') return;
      setIdle(false);
      arm();
    };
    const events = ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'focus'] as const;
    events.forEach((e) => window.addEventListener(e, activity, { passive: true }));
    document.addEventListener('visibilitychange', activity);
    arm();
    return () => {
      clearTimeout(timer.current);
      events.forEach((e) => window.removeEventListener(e, activity));
      document.removeEventListener('visibilitychange', activity);
    };
  }, [ms]);
  return idle;
}

/** The channel on screen (write-only for me; only the notifications function reads it). */
function setViewing(r: ReturnType<typeof ref>, channelId: string) {
  return channelId ? set(r, channelId) : remove(r);
}

/**
 * Presence in RTDB (not Firestore, to keep writes free): status/{uid}/{deviceId} =
 * {state, lastChanged}, combined per person by aggregatePresence(). state is online / away
 * (idle 10 min, or set manually) / offline (socket dropped, via onDisconnect). The channel on
 * screen goes to viewing/{uid}/{deviceId}, which only the notifications function can read
 * (it skips pushing to people looking at the channel); status/ is readable by every member.
 */
export function usePresence() {
  const { user } = useAuth();
  const uid = user?.uid;
  const visible = useDocumentVisible();
  const idle = useIdle(idleMs());
  const manualAway = useManualAway();
  const { pathname } = useLocation();
  const state = idle || manualAway ? 'away' : 'online';
  const activeChannel = visible ? (pathname.match(/^\/c\/([^/]+)/)?.[1] ?? '') : '';
  const [connected, setConnected] = useState(false);
  const latest = useRef({ activeChannel, state });
  latest.current = { activeChannel, state };

  const device = useRef(deviceId()).current;

  useEffect(() => {
    if (!uid) return;
    const userRef = ref(rtdb, `status/${uid}`);
    const deviceRef = ref(rtdb, `status/${uid}/${device}`);
    const viewingRef = ref(rtdb, `viewing/${uid}/${device}`);
    return onValue(ref(rtdb, '.info/connected'), async (snap) => {
      const on = snap.val() === true;
      setConnected(on);
      if (!on) return;
      try {
        await onDisconnect(deviceRef).set({ state: 'offline', lastChanged: serverTimestamp() });
        await onDisconnect(viewingRef).remove();
        await set(deviceRef, { state: latest.current.state, lastChanged: serverTimestamp() });
        await setViewing(viewingRef, latest.current.activeChannel);
        // Housekeeping: drop the old single-entry fields and devices unseen for 30 days.
        const mine = ((await get(userRef)).val() ?? {}) as Record<string, { state?: string; lastChanged?: number } | string | number>;
        const cleanup: Record<string, null> = {};
        for (const [key, v] of Object.entries(mine)) {
          if (typeof v !== 'object' || v === null) cleanup[key] = null;
          else if (key !== device && v.state === 'offline' && (v.lastChanged ?? 0) < Date.now() - STALE_DEVICE_MS) cleanup[key] = null;
        }
        if (Object.keys(cleanup).length) await update(userRef, cleanup);
      } catch {
        // Permission errors after deactivation are expected; the auth listener signs out.
      }
    });
  }, [uid, device]);

  useEffect(() => {
    if (!uid || !connected) return;
    set(ref(rtdb, `status/${uid}/${device}`), { state, lastChanged: serverTimestamp() }).catch(() => undefined);
  }, [uid, device, connected, state]);

  useEffect(() => {
    if (!uid || !connected) return;
    setViewing(ref(rtdb, `viewing/${uid}/${device}`), activeChannel).catch(() => undefined);
  }, [uid, device, connected, activeChannel]);
}
