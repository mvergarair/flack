import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';

/** Daily: flips pending invites past their expiry to `expired`. */
export const expireinvites = onSchedule({ schedule: 'every day 03:00', timeZone: 'UTC' }, async () => {
  const snap = await db
    .collection('invites')
    .where('status', '==', 'pending')
    .where('expiresAt', '<=', Timestamp.now())
    .limit(500)
    .get();
  const batch = db.batch();
  snap.docs.forEach((d) => batch.update(d.ref, { status: 'expired' }));
  if (!snap.empty) await batch.commit();
  logger.info('Expired invites', { count: snap.size });
});
