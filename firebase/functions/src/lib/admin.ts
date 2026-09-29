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
// Outside us-central1 the URL is https://{project}-default-rtdb.{region}.firebasedatabase.app,
// which Firebase passes in FIREBASE_CONFIG.databaseURL; the emulator gets the us form.
const firebaseConfig = JSON.parse(process.env.FIREBASE_CONFIG ?? '{}') as { projectId?: string; databaseURL?: string };
const project = process.env.GCLOUD_PROJECT ?? firebaseConfig.projectId;
const databaseUrl =
  process.env.FUNCTIONS_EMULATOR !== 'true' && firebaseConfig.databaseURL ? firebaseConfig.databaseURL : `https://${project}-default-rtdb.firebaseio.com`;
export const rtdb = () => getDatabaseWithUrl(databaseUrl, app);
export const projectId = project as string;
export const bucket = () => getStorage(app).bucket();
export const messaging = () => getMessaging(app);
export const isEmulator = process.env.FUNCTIONS_EMULATOR === 'true';
