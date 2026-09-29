import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import { isDndActive } from '../lib/dnd.js';
import { sendPush } from '../lib/push.js';
import type { ChannelDoc, MessageDoc, ScheduledDoc, UserDoc } from '../lib/types.js';
import { notificationBody } from '../notifications/recipients.js';
import { cannotSend } from './checks.js';
import { mentionNames, writeMessage } from '../lib/post.js';
import { expireAt } from '../lib/ttl.js';

/**
 * Every 10 minutes: post due scheduled messages and fire due reminders. The app only offers
 * times on this 10-minute grid (:00, :10, …), and the rules require it.
 */
export const sendscheduled = onSchedule({ schedule: 'every 10 minutes', timeZone: 'UTC', retryCount: 0, timeoutSeconds: 300 }, async () => {
  await runDue(Date.now());
});

/** Items due at or before `now` (plus a minute of slack in case the job fires a hair early). */
export async function runDue(now: number): Promise<{ sent: number; reminded: number; failed: number }> {
  const due = await db
    .collectionGroup('scheduled')
    .where('status', '==', 'pending')
    .where('sendAt', '<=', Timestamp.fromMillis(now + 60_000))
    .orderBy('sendAt')
    .limit(500)
    .get();
  const counts = { sent: 0, reminded: 0, failed: 0 };
  for (const doc of due.docs) {
    const uid = doc.ref.parent.parent?.id;
    if (!uid) continue;
    try {
      const d = doc.data() as ScheduledDoc;
      const outcome = d.kind === 'reminder' ? await fireReminder(uid, doc.ref) : await postMessage(uid, doc.ref);
      if (outcome) counts[outcome]++;
    } catch (err) {
      logger.error('Scheduled item failed', { path: doc.ref.path, err: String(err) });
    }
  }
  if (due.size) logger.info('Scheduled items processed', { due: due.size, ...counts });
  return counts;
}

async function postMessage(uid: string, ref: FirebaseFirestore.DocumentReference): Promise<'sent' | 'failed' | null> {
  // Mention names for the channel preview (read outside the transaction; cosmetic only).
  const pre = (await ref.get()).data() as ScheduledDoc | undefined;
  const names = await mentionNames(pre?.mentions ?? []);

  let failure: { reason: string; d: ScheduledDoc } | null = null;
  const result = await db.runTransaction(async (tx) => {
    failure = null;
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() as ScheduledDoc;
    if (d.status !== 'pending' || !d.channelId) return null;

    const channelRef = db.doc(`channels/${d.channelId}`);
    const parentRef = d.threadParentId ? db.doc(`channels/${d.channelId}/messages/${d.threadParentId}`) : null;
    const [userSnap, channelSnap, parentSnap] = await Promise.all([
      tx.get(db.doc(`users/${uid}`)),
      tx.get(channelRef),
      parentRef ? tx.get(parentRef) : Promise.resolve(null),
    ]);
    const channel = channelSnap.data() as ChannelDoc | undefined;
    const parent = parentSnap?.data() as MessageDoc | undefined;
    const reason = cannotSend({ uid, user: userSnap.data() as UserDoc | undefined, channel, threadParentId: d.threadParentId, parent });
    if (reason) {
      tx.update(ref, { status: 'failed', error: reason });
      failure = { reason, d };
      return 'failed' as const;
    }

    // Same writes as the app's sendMessage(); the message id is this item's id, so a retry
    // can never post it twice (create() fails if it exists).
    writeMessage(tx, {
      uid,
      channelId: d.channelId,
      messageId: ref.id,
      text: d.text,
      mentions: d.mentions ?? [],
      threadParentId: d.threadParentId ?? null,
      parent,
      alsoToChannel: !!d.alsoToChannel,
      names,
    });
    tx.delete(ref);
    return 'sent' as const;
  });

  if (result === 'failed' && failure) {
    const { reason, d } = failure as { reason: string; d: ScheduledDoc };
    // Tell the author (Activity + push); the item stays under Later → Scheduled to retry.
    await db.doc(`users/${uid}/activity/sf_${ref.id}`).set({
      kind: 'schedule-failed',
      channelId: d.channelId,
      messageId: null,
      threadParentId: d.threadParentId ?? null,
      authorId: uid,
      preview: notificationBody(d.text, names, 0, 200),
      error: reason,
      createdAt: FieldValue.serverTimestamp(),
      expireAt: expireAt(),
    });
    await sendPush(uid, { kind: 'schedule-failed', title: 'Scheduled message not sent', body: reason, path: '/later?tab=scheduled', tag: `sf_${ref.id}` });
  }
  return result;
}

async function fireReminder(uid: string, ref: FirebaseFirestore.DocumentReference): Promise<'reminded' | null> {
  const fired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return null;
    const d = snap.data() as ScheduledDoc;
    if (d.status !== 'pending') return null;
    const user = (await tx.get(db.doc(`users/${uid}`))).data() as UserDoc | undefined;
    tx.delete(ref);
    if (user?.status !== 'active') return null;
    tx.set(db.doc(`users/${uid}/activity/r_${ref.id}`), {
      kind: 'reminder',
      channelId: d.channelId ?? null,
      messageId: d.messageId ?? null,
      threadParentId: d.threadParentId ?? null,
      authorId: uid,
      preview: d.text.slice(0, 500),
      createdAt: FieldValue.serverTimestamp(),
      expireAt: expireAt(),
    });
    return { d, user };
  });
  if (!fired) return null;

  const { d, user } = fired;
  const u = user as UserDoc & { dnd?: Parameters<typeof isDndActive>[0]; timeZone?: string };
  if (!isDndActive(u.dnd, u.timeZone)) {
    const path = d.channelId && d.messageId ? (d.threadParentId ? `/c/${d.channelId}/t/${d.threadParentId}` : `/c/${d.channelId}?m=${d.messageId}`) : '/activity';
    await sendPush(uid, { kind: 'reminder', title: '⏰ Reminder', body: d.text.slice(0, 180), path, channelId: d.channelId ?? undefined, tag: `r_${ref.id}` });
  }
  return 'reminded';
}
