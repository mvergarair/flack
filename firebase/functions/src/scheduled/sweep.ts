import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import { dmFromBot, dmFromBotInTx } from '../bot/bot.js';
import type { ChannelDoc, MessageDoc, ScheduledDoc, UserDoc } from '../lib/types.js';
import { notificationBody } from '../notifications/recipients.js';
import { cannotSend } from './checks.js';
import { mentionNames, writeMessage } from '../lib/post.js';

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
    // Tell the author in their Flackbot DM; the item stays under Later → Scheduled to retry.
    const where = await describeChannel(d.channelId);
    await dmFromBot(uid, {
      text: `⚠️ Your scheduled message ${where} couldn't be sent: ${reason}\n\n> ${notificationBody(d.text, names, 0, 300)}\n\nIt's saved under Later → Scheduled, where you can edit it or send it again.`,
      extra: { botRef: { kind: 'schedule-failed' } },
    });
  }
  return result;
}

async function fireReminder(uid: string, ref: FirebaseFirestore.DocumentReference): Promise<'reminded' | null> {
  // The reminder arrives as a message in the person's Flackbot DM; the normal message pipeline
  // then notifies them (and respects Do Not Disturb). The message id is derived from this
  // item's id, so a retry can't remind twice.
  const fired = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return false;
    const d = snap.data() as ScheduledDoc;
    if (d.status !== 'pending') return false;
    const user = (await tx.get(db.doc(`users/${uid}`))).data() as UserDoc | undefined;
    if (user?.status === 'active') {
      const about = d.channelId && d.messageId ? { channelId: d.channelId, messageId: d.messageId, threadParentId: d.threadParentId ?? null } : null;
      await dmFromBotInTx(tx, uid, {
        text: `⏰ Reminder: ${d.text.slice(0, 1000)}`,
        messageId: `r_${ref.id}`,
        extra: { botRef: { kind: 'reminder', text: d.text.slice(0, 500), ...(about ?? {}) } },
      });
    }
    tx.delete(ref);
    return user?.status === 'active';
  });
  return fired ? 'reminded' : null;
}

/** "in #general", "in a direct message", or "" when the channel is gone. */
async function describeChannel(channelId: string | null): Promise<string> {
  if (!channelId) return '';
  const c = (await db.doc(`channels/${channelId}`).get()).data() as ChannelDoc | undefined;
  if (!c) return '';
  return c.type === 'dm' ? 'in a direct message' : `in #${c.name}`;
}
