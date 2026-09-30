import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { db, isEmulator } from '../lib/admin.js';
import { writeMessage } from '../lib/post.js';
import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';
import { BOT_ID, HELP_REPLY, botDmId, matchResponse, sanitizeConfig, type BotConfig } from './rules.js';

/**
 * Flackbot: a built-in author (not a user account) that sends reminders and notices to each
 * person's Flackbot DM, welcomes new members, and answers admin-defined phrases.
 */

// Admin edits apply within this long in production; tests see them at once.
const CACHE_MS = isEmulator ? 0 : 5 * 60_000;
let cached: { at: number; config: BotConfig } | null = null;

/** config/bot, cached per instance for a few minutes so ordinary messages cost no reads. */
export async function botConfig(now = Date.now()): Promise<BotConfig> {
  if (cached && now - cached.at < CACHE_MS) return cached.config;
  const config = sanitizeConfig((await db.doc('config/bot').get()).data());
  cached = { at: now, config };
  return config;
}

const typingKey = () => 't_' + randomBytes(24).toString('base64').replace(/[^A-Za-z0-9]/g, '').slice(0, 30).padEnd(24, 'x');

export interface BotPost {
  channelId: string;
  text: string;
  threadParentId?: string | null;
  /** Makes the post idempotent (create() fails if the id exists). Random when omitted. */
  messageId?: string;
  /** Extra fields for the app to render, e.g. a link to the message a reminder is about. */
  extra?: Record<string, unknown>;
}

/**
 * Posts as Flackbot inside `tx` (reads first, then writes). Creates the person's Flackbot DM
 * when `dmFor` is given and it doesn't exist yet. Returns false if the channel is gone.
 */
async function postInTx(tx: FirebaseFirestore.Transaction, p: BotPost, dmFor?: string): Promise<boolean> {
  const channelRef = db.doc(`channels/${p.channelId}`);
  const parentRef = p.threadParentId ? db.doc(`channels/${p.channelId}/messages/${p.threadParentId}`) : null;
  const [channelSnap, parentSnap] = await Promise.all([tx.get(channelRef), parentRef ? tx.get(parentRef) : Promise.resolve(null)]);
  const welcomeId = dmFor ? `welcome_${dmFor}` : null;
  if (!channelSnap.exists) {
    if (!dmFor) return false;
    // Not a transactional read: the settings are cached, and only the welcome text comes from them.
    const { welcome } = await botConfig();
    tx.create(channelRef, {
      name: '',
      type: 'dm',
      memberIds: [dmFor, BOT_ID].sort(),
      createdBy: BOT_ID,
      archived: false,
      typingKey: typingKey(),
      createdAt: FieldValue.serverTimestamp(),
    });
    // Whatever opens the DM first (the app, or a reminder), the welcome comes first.
    if (p.messageId !== welcomeId) {
      tx.create(db.doc(`channels/${p.channelId}/messages/${welcomeId}`), {
        ...WELCOME_FIELDS,
        text: welcome,
        createdAt: Timestamp.fromMillis(Date.now() - 1000),
      });
    }
  }
  // The channel preview update in writeMessage needs the channel to exist within this commit:
  // a set() on a doc created above in the same transaction is fine.
  const messageId = p.messageId ?? db.collection('_').doc().id;
  writeMessage(tx, {
    uid: BOT_ID,
    channelId: p.channelId,
    messageId,
    text: p.text,
    mentions: [],
    threadParentId: p.threadParentId ?? null,
    parent: parentSnap?.data() as MessageDoc | undefined,
    alsoToChannel: false,
    names: new Map(),
  });
  if (p.extra) tx.set(db.doc(`channels/${p.channelId}/messages/${messageId}`), p.extra, { merge: true });
  return true;
}

/** A welcome message: no push for it (botRef.kind 'welcome'; see onmessagecreated). */
const WELCOME_FIELDS = {
  authorId: BOT_ID,
  threadParentId: null,
  attachments: [],
  mentions: [],
  replyCount: 0,
  replyUserIds: [],
  botRef: { kind: 'welcome' },
};

/** Posts in a channel or thread as Flackbot. */
export async function postAsBot(p: BotPost): Promise<boolean> {
  return db.runTransaction((tx) => postInTx(tx, p));
}

/** Posts in `uid`'s Flackbot DM, creating it (with nothing else) if needed. */
export async function dmFromBot(uid: string, p: Omit<BotPost, 'channelId'>): Promise<string> {
  const channelId = botDmId(uid);
  await db.runTransaction((tx) => postInTx(tx, { ...p, channelId }, uid));
  return channelId;
}

/** Same as dmFromBot, for use inside a caller's transaction (after its reads). */
export function dmFromBotInTx(tx: FirebaseFirestore.Transaction, uid: string, p: Omit<BotPost, 'channelId'>): Promise<boolean> {
  return postInTx(tx, { ...p, channelId: botDmId(uid) }, uid);
}

/**
 * Called for every new message (from onmessagecreated): auto-responses anywhere, and a short
 * help reply when someone writes in their Flackbot DM and nothing matches. Costs no reads for
 * ordinary messages (the settings are cached) and one write when Flackbot answers.
 */
export async function answerMessage(channelId: string, messageId: string, msg: MessageDoc, channel: ChannelDoc): Promise<void> {
  if (msg.authorId === BOT_ID || msg.deleted || !msg.text?.trim()) return;
  const inBotDm = channel.type === 'dm' && channel.memberIds.includes(BOT_ID);
  const { responses } = await botConfig();
  const hit = responses.length ? matchResponse(msg.text, responses) : null;
  if (!hit && !inBotDm) return;
  const text = hit?.reply ?? HELP_REPLY;
  // Replies go where the question was: the same thread, or the channel. The id is derived from
  // the question so a retried trigger can't answer twice.
  await postAsBot({ channelId, text, threadParentId: msg.threadParentId ?? null, messageId: `bot_${messageId}` }).catch((err) => {
    if (String(err).includes('ALREADY_EXISTS')) return;
    throw err;
  });
  logger.info('Flackbot answered', { channelId, kind: hit ? 'auto-response' : 'help' });
}

/**
 * Opens the caller's Flackbot DM, creating it with the welcome message the first time. The app
 * calls this once for people who don't have one yet (new members, and everyone after updating).
 */
export const openflackbot = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid || req.auth?.token.active !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  const me = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (me?.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  const channelId = botDmId(uid);
  if ((await db.doc(`channels/${channelId}`).get()).exists) return { channelId };
  const { welcome } = await botConfig();
  await dmFromBot(uid, { text: welcome, messageId: `welcome_${uid}`, extra: { botRef: { kind: 'welcome' } } }).catch((err) => {
    if (String(err).includes('ALREADY_EXISTS')) return; // two tabs raced; the other one won
    throw err;
  });
  return { channelId };
});
