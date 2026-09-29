import { initializeApp } from 'firebase/app';
import { connectAuthEmulator, getAuth } from 'firebase/auth';
import {
  connectFirestoreEmulator,
  initializeFirestore,
  persistentLocalCache,
  persistentMultipleTabManager,
  memoryLocalCache,
  waitForPendingWrites,
} from 'firebase/firestore';
import { connectDatabaseEmulator, getDatabase } from 'firebase/database';
import { connectStorageEmulator, getStorage } from 'firebase/storage';
import { connectFunctionsEmulator, getFunctions } from 'firebase/functions';

import { USE_EMULATORS, firebaseConfig } from './firebase-config';

export { USE_EMULATORS };
export const app = initializeApp(firebaseConfig);

export const auth = getAuth(app);

// Offline persistence keeps reloads cheap (reads served from cache). Playwright/e2e uses
// memory cache so parallel contexts never fight over IndexedDB.
const useMemoryCache = USE_EMULATORS && new URLSearchParams(location.search).has('memcache');
export const db = initializeFirestore(app, {
  localCache: useMemoryCache
    ? memoryLocalCache()
    : persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
});
export const rtdb = getDatabase(app);
export const storage = getStorage(app);
export const functions = getFunctions(app, 'us-central1');

if (USE_EMULATORS) {
  const host = '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9399`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8380);
  connectDatabaseEmulator(rtdb, host, 9300);
  connectStorageEmulator(storage, host, 9398);
  connectFunctionsEmulator(functions, host, 5301);
}

// Start the Firestore client at boot so it subscribes to auth changes before any listener is
// attached. Otherwise, right after sign-in, the first listeners can race Firestore's own
// credential switch and be evaluated as signed-out (permission-denied).
void waitForPendingWrites(db).catch(() => undefined);
