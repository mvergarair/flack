import {
  onSnapshot,
  type DocumentReference,
  type DocumentSnapshot,
  type FirestoreError,
  type Query,
  type QuerySnapshot,
  type SnapshotListenOptions,
  type Unsubscribe,
} from 'firebase/firestore';
import { auth } from '../firebase';

type Target = DocumentReference | Query;

/**
 * onSnapshot that survives transient permission-denied errors (e.g. a listener attached
 * while a fresh ID token is still propagating). On permission-denied it force-refreshes the
 * token and re-subscribes with backoff; if the refresh itself fails (disabled / revoked
 * account) or retries run out, `onError` is called.
 */
function listen(target: Target, next: (snap: never) => void, onError?: (err: FirestoreError) => void, options: SnapshotListenOptions = {}): Unsubscribe {
  let unsub: Unsubscribe = () => undefined;
  let attempts = 0;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const start = () => {
    unsub = onSnapshot(
      target as Query,
      options,
      (snap) => {
        attempts = 0;
        next(snap as never);
      },
      async (err) => {
        if (stopped) return;
        if (err.code === 'permission-denied' && attempts < 3 && auth.currentUser) {
          attempts++;
          try {
            await auth.currentUser.getIdToken(true);
          } catch {
            onError?.(err);
            return;
          }
          timer = setTimeout(() => !stopped && start(), 300 * attempts * attempts);
          return;
        }
        onError?.(err);
      },
    );
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(timer);
    unsub();
  };
}

export const listenDoc = (ref: DocumentReference, next: (snap: DocumentSnapshot) => void, onError?: (err: FirestoreError) => void) =>
  listen(ref, next as (snap: never) => void, onError);

export const listenQuery = (
  q: Query,
  next: (snap: QuerySnapshot) => void,
  onError?: (err: FirestoreError) => void,
  options?: SnapshotListenOptions,
) => listen(q, next as (snap: never) => void, onError, options);
