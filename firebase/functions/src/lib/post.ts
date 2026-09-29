import { FieldValue } from 'firebase-admin/firestore';
import { db } from './admin.js';
import type { MessageDoc } from './types.js';
import { notificationBody } from '../notifications/recipients.js';

/** `<@uid>` / `<!channel>` / `<!here>` tokens in stored text → the `mentions` array (max 50). */
export function extractMentions(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/<@([A-Za-z0-9_-]{1,128})>/g)) out.add(m[1]);
  for (const m of text.matchAll(/<!(channel|here)>/g)) out.add(`!${m[1]}`);
  return [...out].slice(0, 50);
}

/** Display names for the people mentioned in `mentions` (for the channel preview). */
export async function mentionNames(mentions: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  const ids = mentions.filter((m) => !m.startsWith('!')).slice(0, 50);
  if (ids.length) (await db.getAll(...ids.map((id) => db.doc(`users/${id}`)))).forEach((s) => s.exists && names.set(s.id, s.get('displayName')));
  return names;
}

/**
 * The writes the app's sendMessage() makes, inside a transaction: the message itself, the
 * thread summary on the parent, and the channel's last-message preview. Callers do their own
 * checks first (membership, archive, thread; see scheduled/checks.ts → cannotSend).
 */
export function writeMessage(
  tx: FirebaseFirestore.Transaction,
  p: {
    uid: string;
    channelId: string;
    messageId: string;
    text: string;
    mentions: string[];
    threadParentId: string | null;
    parent: MessageDoc | undefined;
    alsoToChannel: boolean;
    names: Map<string, string>;
  },
): void {
  const alsoToChannel = !!(p.threadParentId && p.alsoToChannel);
  tx.create(db.doc(`channels/${p.channelId}/messages/${p.messageId}`), {
    text: p.text,
    authorId: p.uid,
    createdAt: FieldValue.serverTimestamp(),
    threadParentId: p.threadParentId,
    attachments: [],
    mentions: p.mentions,
    replyCount: 0,
    replyUserIds: [],
    ...(alsoToChannel ? { alsoToChannel: true } : {}),
  });
  if (p.threadParentId && p.parent) {
    tx.update(db.doc(`channels/${p.channelId}/messages/${p.threadParentId}`), {
      replyCount: FieldValue.increment(1),
      lastReplyAt: FieldValue.serverTimestamp(),
      replyUserIds: [...(p.parent.replyUserIds ?? []).filter((u) => u !== p.uid), p.uid].slice(-5),
    });
  }
  if (!p.threadParentId || alsoToChannel) {
    tx.update(db.doc(`channels/${p.channelId}`), {
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessage: { text: notificationBody(p.text, p.names, 0, 200), authorId: p.uid },
    });
  }
}
