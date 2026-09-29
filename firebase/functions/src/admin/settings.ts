import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { db } from '../lib/admin.js';
import type { UserDoc } from '../lib/types.js';

/**
 * Admins choose which public channels new members join (config/app.defaultChannelIds). Only
 * existing, public, non-archived channels are accepted; sign-up also skips any that go stale.
 */
export const setdefaultchannels = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  const me = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (req.auth?.token.role !== 'admin' || me?.role !== 'admin' || me.status !== 'active') {
    throw new HttpsError('permission-denied', 'Admins only.');
  }
  const ids = (req.data as { channelIds?: unknown } | null)?.channelIds;
  if (!Array.isArray(ids) || ids.length > 10 || !ids.every((i) => typeof i === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(i))) {
    throw new HttpsError('invalid-argument', 'Pick up to 10 channels.');
  }
  const unique = [...new Set(ids as string[])];
  const snaps = unique.length ? await db.getAll(...unique.map((id) => db.doc(`channels/${id}`))) : [];
  const bad = snaps.filter((s) => !s.exists || s.get('type') !== 'public' || s.get('archived'));
  if (bad.length) throw new HttpsError('invalid-argument', 'Default channels must be existing public channels that are not archived.');
  await db.doc('config/app').set({ defaultChannelIds: unique }, { merge: true });
  logger.info('Default channels set', { by: uid, count: unique.length });
  return { ok: true };
});
