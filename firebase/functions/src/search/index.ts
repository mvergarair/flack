import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import type { MessageDoc, UserDoc } from '../lib/types.js';
import { buildTerms, snippet } from './terms.js';

/** search/{messageId}: the searchable copy of a message (written only by functions). */
export interface SearchDoc {
  channelId: string;
  messageId: string;
  threadParentId: string | null;
  authorId: string;
  createdAt: Timestamp;
  terms: string[];
  snippet: string;
  hasFile: boolean;
}

export const searchRef = (messageId: string) => db.doc(`search/${messageId}`);

async function mentionNames(text: string): Promise<Map<string, string>> {
  const ids = [...new Set([...text.matchAll(/<@([A-Za-z0-9]+)>/g)].map((m) => m[1]))];
  if (!ids.length) return new Map();
  const snaps = await db.getAll(...ids.map((id) => db.doc(`users/${id}`)));
  return new Map(snaps.filter((s) => s.exists).map((s) => [s.id, (s.data() as UserDoc).displayName]));
}

export async function toSearchDoc(channelId: string, messageId: string, msg: MessageDoc): Promise<SearchDoc> {
  const files = (msg.attachments ?? []).map((a) => a.name);
  return {
    channelId,
    messageId,
    threadParentId: msg.threadParentId ?? null,
    authorId: msg.authorId,
    createdAt: msg.createdAt ?? Timestamp.now(),
    terms: buildTerms(msg.text ?? '', files),
    snippet: snippet(msg.text ?? '', await mentionNames(msg.text ?? '')) || (files.length ? `📎 ${files.join(', ')}` : ''),
    hasFile: files.length > 0,
  };
}

/** Creates/updates the index doc, or removes it for deleted/empty messages. */
export async function indexMessage(channelId: string, messageId: string, msg: MessageDoc | undefined) {
  if (!msg || msg.deleted || (!msg.text && !msg.attachments?.length)) {
    await searchRef(messageId).delete();
    return;
  }
  await searchRef(messageId).set(await toSearchDoc(channelId, messageId, msg));
}
