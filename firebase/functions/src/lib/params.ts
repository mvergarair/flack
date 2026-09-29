import { defineString } from 'firebase-functions/params';

/** The first account with this email to sign in (before bootstrap) becomes the first admin. */
export const FIRST_ADMIN_EMAIL = defineString('FIRST_ADMIN_EMAIL');
/** Public URL of the PWA, used in invite links and notification click targets. */
export const APP_URL = defineString('APP_URL');

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_CHANNELS = [
  { id: 'general', name: 'general', topic: 'Company-wide announcements and chat' },
  { id: 'random', name: 'random', topic: 'Anything goes' },
];
