// Shared by the app and the service worker (no SDK side effects here).
/** True when the app talks to the local Emulator Suite (dev + e2e). Compiled out of prod builds. */
export const USE_EMULATORS = import.meta.env.VITE_USE_EMULATORS === 'true';

const emulatorConfig = {
  apiKey: 'demo-key',
  authDomain: 'demo-flack.firebaseapp.com',
  projectId: 'demo-flack',
  storageBucket: 'demo-flack.appspot.com',
  databaseURL: 'https://demo-flack-default-rtdb.firebaseio.com',
  appId: '1:000000000000:web:0000000000000000',
  messagingSenderId: '000000000000',
};

const prodConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  databaseURL: import.meta.env.VITE_FIREBASE_DATABASE_URL,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
};

export const firebaseConfig = USE_EMULATORS ? emulatorConfig : prodConfig;
