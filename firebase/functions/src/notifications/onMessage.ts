import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db, isEmulator, rtdb } from '../lib/admin.js';
import { sendPush } from '../lib/push.js';
import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';
import { unfurlMessage } from '../unfurl/unfurl.js';
import { indexMessage } from '../search/index.js';
import { isDndActive } from '../lib/dnd.js';
import { aggregatePresence, withViewing, type AggregatedPresence } from '../lib/presence.js';
import { isActivityKind, notificationBody, notificationTargets, notificationTitle, pushRecipients, type NotifyKind } from './recipients.js';

type Presence = AggregatedPresence;

/**
 * On every new message: work out who should hear about it (DM members, @mentioned people,
 * thread participants), write their Activity items, and send web pushes to those not
 * already looking at the channel.
 */
export const onmessagecreated = onDocumentCreated({ document: 'channels/{channelId}/messages/{messageId}', retry: false }, async (event) => {
  const snap = event.data;
  if (!snap) return;
  const msg = snap.data() as MessageDoc;
  if (isEmulator && msg.seeded) return; // emulator seed data
  const { channelId, messageId } = event.params;

  // Link previews run alongside notifications (independent; failures only skip previews).
  const unfurl = Promise.all([
    unfurlMessage(snap.ref, msg.text ?? '', undefined).catch(() => undefined),
    indexMessage(channelId, messageId, msg).catch((err) => logger.error('Search indexing failed', { messageId, err: String(err) })),
  ]);

  const channelSnap = await db.doc(`channels/${channelId}`).get();
  if (!channelSnap.exists) return void (await unfurl);
  const channel = channelSnap.data() as ChannelDoc;

  let thread: { parentAuthorId: string; replyUserIds: string[] } | null = null;
  if (msg.threadParentId) {
    const parent = await db.doc(`channels/${channelId}/messages/${msg.threadParentId}`).get();
    if (parent.exists) {
      const p = parent.data() as MessageDoc;
      thread = { parentAuthorId: p.authorId, replyUserIds: p.replyUserIds ?? [] };
    }
  }

  const mentions = msg.mentions ?? [];
  const broadcast = channel.type !== 'dm' && (mentions.includes('!channel') || mentions.includes('!here'));

  // Candidate users (members of the channel only), fetched in one round trip.
  const candidateIds = [
    ...new Set([
      ...(channel.type === 'dm' || broadcast ? channel.memberIds : []),
      ...mentions.filter((m) => !m.startsWith('!')),
      ...(thread ? [thread.parentAuthorId, ...thread.replyUserIds] : []),
      msg.authorId,
    ]),
  ].filter((id) => channel.memberIds.includes(id));
  const userSnaps = candidateIds.length ? await db.getAll(...candidateIds.map((id) => db.doc(`users/${id}`))) : [];
  const users = new Map(userSnaps.filter((s) => s.exists).map((s) => [s.id, s.data() as UserDoc]));
  const inactive = new Set(candidateIds.filter((id) => users.get(id)?.status !== 'active'));

  // Presence (RTDB): who is online, and who is looking at this channel right now.
  const [raw, viewing] = await Promise.all([
    rtdb().ref('status').get().then((s) => (s.val() ?? {}) as Record<string, unknown>),
    rtdb().ref('viewing').get().then((s) => (s.val() ?? {}) as Record<string, unknown>),
  ]);
  const presence: Record<string, Presence> = {};
  for (const [id, node] of Object.entries(raw)) {
    const p = aggregatePresence(withViewing(node, viewing[id]));
    if (p) presence[id] = p;
  }
  const online = new Set(Object.entries(presence).filter(([, p]) => p?.state === 'online').map(([uid]) => uid));

  // Per-channel settings: who wants every message, and who muted the channel.
  const allSubscribers: string[] = [];
  const muted = new Set<string>();
  // If this fails (e.g. the index is still building), fall back to default settings rather
  // than dropping everyone's notifications.
  const prefs = await db
    .collectionGroup('channelPrefs')
    .where('channelId', '==', channelId)
    .where('level', 'in', ['all', 'none'])
    .get()
    .catch((err) => {
      logger.warn('channelPrefs query failed; using defaults', { channelId, err: String(err) });
      return { docs: [] as FirebaseFirestore.QueryDocumentSnapshot[] };
    });
  for (const d of prefs.docs) {
    const uid = d.ref.parent.parent?.id;
    if (!uid) continue;
    if (d.get('level') === 'all') allSubscribers.push(uid);
    else muted.add(uid);
  }
  // Newly targeted "all" subscribers need their profile (active check).
  const extraIds = allSubscribers.filter((id) => !users.has(id) && channel.memberIds.includes(id));
  if (extraIds.length) {
    const extra = await db.getAll(...extraIds.map((id) => db.doc(`users/${id}`)));
    extra.forEach((snap) => snap.exists && users.set(snap.id, snap.data() as UserDoc));
    extraIds.filter((id) => users.get(id)?.status !== 'active').forEach((id) => inactive.add(id));
  }

  const targets = notificationTargets({
    channelType: channel.type,
    memberIds: channel.memberIds,
    authorId: msg.authorId,
    mentions,
    thread,
    inactive,
    online,
    allSubscribers,
  });
  if (targets.size === 0) return void (await unfurl);

  const author = users.get(msg.authorId)?.displayName ?? 'Someone';
  const names = new Map([...users].map(([id, u]) => [id, u.displayName]));
  // Mention names for people outside the candidate set are resolved lazily.
  const missing = mentions.filter((id) => !id.startsWith('!') && !names.has(id));
  if (missing.length) {
    const extra = await db.getAll(...missing.map((id) => db.doc(`users/${id}`)));
    extra.forEach((s) => s.exists && names.set(s.id, (s.data() as UserDoc).displayName));
  }
  const body = notificationBody(msg.text ?? '', names, msg.attachments?.length ?? 0);

  // Activity feed (mentions + thread replies; DMs already have the DM list).
  const batch = db.batch();
  for (const [uid, kind] of targets) {
    if (!isActivityKind(kind)) continue;
    batch.set(db.doc(`users/${uid}/activity/${messageId}`), {
      kind,
      channelId,
      messageId,
      threadParentId: msg.threadParentId ?? null,
      authorId: msg.authorId,
      preview: body.slice(0, 200),
      createdAt: msg.createdAt ?? Timestamp.now(),
    });
  }
  await batch.commit();

  // Do Not Disturb: no pushes (Activity above still records mentions/replies).
  for (const [uid] of targets) {
    const u = users.get(uid) as (UserDoc & { dnd?: Parameters<typeof isDndActive>[0]; timeZone?: string }) | undefined;
    if (u && isDndActive(u.dnd, u.timeZone)) muted.add(uid);
  }
  await sendPushes({ targets: new Map(pushRecipients(targets, muted)), channelId, messageId, threadParentId: msg.threadParentId ?? null, channel, author, body, presence });
  await unfurl;
});

async function sendPushes(p: {
  targets: Map<string, NotifyKind>;
  channelId: string;
  messageId: string;
  threadParentId: string | null;
  channel: ChannelDoc;
  author: string;
  body: string;
  presence: Record<string, Presence>;
}) {
  // Skip people who are looking at this channel right now.
  const presence = p.presence;
  const recipients = [...p.targets].filter(([uid]) => !(presence[uid]?.state === 'online' && !!presence[uid]?.activeChannels.includes(p.channelId)));
  if (!recipients.length) return;

  const label = p.channel.type === 'dm' ? 'a direct message' : `#${p.channel.name}`;
  const path = p.threadParentId ? `/c/${p.channelId}/t/${p.threadParentId}` : `/c/${p.channelId}?m=${p.messageId}`;
  for (const [uid, kind] of recipients) {
    await sendPush(uid, { kind, title: notificationTitle(kind, p.author, label), body: p.body, path, channelId: p.channelId, tag: p.threadParentId ?? p.channelId });
  }
}
