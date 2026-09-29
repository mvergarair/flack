import { initializeApp } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import { getDatabaseWithUrl } from 'firebase-admin/database';
import { getStorage } from 'firebase-admin/storage';
import { getMessaging } from 'firebase-admin/messaging';
import { setGlobalOptions } from 'firebase-functions/v2';

setGlobalOptions({ region: 'us-central1', maxInstances: 5 });

export const app = initializeApp();
export const db = getFirestore(app);
export const auth = getAuth(app);
// Name the default RTDB instance explicitly ({project}-default-rtdb): the emulator's injected
// config otherwise points the Admin SDK at a different namespace than the web client uses.
const project = process.env.GCLOUD_PROJECT ?? JSON.parse(process.env.FIREBASE_CONFIG ?? '{}').projectId;
export const rtdb = () => getDatabaseWithUrl(`https://${project}-default-rtdb.firebaseio.com`, app);
export const bucket = () => getStorage(app).bucket();
export const messaging = () => getMessaging(app);
export const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
