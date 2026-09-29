import { defineString } from 'firebase-functions/params';

/** The first account with this email to sign in (before bootstrap) becomes the first admin. */
export const FIRST_ADMIN_EMAIL = defineString('FIRST_ADMIN_EMAIL');
/** Public URL of the PWA, used in invite links and notification click targets. */
export const APP_URL = defineString('APP_URL');
// Optional settings read from the environment (firebase/functions/.env.<project>). Plain
// variables with defaults rather than defined params, so installs that don't set them (e.g.
// updated from an older version) deploy without prompting.

/** Anonymous usage statistics (TELEMETRY.md): on unless FLACK_TELEMETRY=off. */
export const telemetryOff = () => (process.env.FLACK_TELEMETRY ?? 'on').trim().toLowerCase() === 'off';
/** Where the daily anonymous report goes. */
export const telemetryUrl = () => process.env.TELEMETRY_URL || 'https://flack-telemetry-mv.web.app/v1/report';
/** The install's region (written by the installer), reported with the statistics. */
export const flackRegion = () => process.env.FLACK_REGION || 'unknown';

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const DEFAULT_CHANNELS = [
  { id: 'general', name: 'general', topic: 'Company-wide announcements and chat' },
  { id: 'random', name: 'random', topic: 'Anything goes' },
];
