import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { FieldPath, Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import type { UserDoc } from '../lib/types.js';
import { queryTerms, words } from './terms.js';
import type { SearchDoc } from './index.js';

const PAGE = 20;
const BATCH = 100;
const MAX_SCAN = 600;

export interface SearchInput {
  q?: string;
  channelId?: string;
  authorId?: string;
  hasFile?: boolean;
  after?: number; // ms
  before?: number; // ms (also the pagination cursor)
}

const chunk = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

/**
 * Message search. Access control lives here: results only come from channels the caller
 * is a member of (the search collection itself is closed to clients). Looks up the most
 * selective query word via the index, then checks the remaining words and filters.
 */
export const searchmessages = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid || req.auth?.token.active !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  const me = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (me?.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  return searchAs(uid, (req.data ?? {}) as SearchInput);
});

/** Search as `uid` (an active user): the app's callable and the HTTP API both use this. */
export async function searchAs(uid: string, input: SearchInput) {
  const { lookup, words: qWords } = queryTerms(String(input.q ?? '').slice(0, 200));
  if (!lookup.length) throw new HttpsError('invalid-argument', 'Type at least one word to search for.');

  const mine = (await db.collection('channels').where('memberIds', 'array-contains', uid).select().get()).docs.map((d) => d.id);
  let channelIds = mine;
  if (input.channelId) {
    if (!mine.includes(input.channelId)) throw new HttpsError('permission-denied', "You're not a member of that channel.");
    channelIds = [input.channelId];
  }
  if (!channelIds.length) return { results: [], nextBefore: null };

  // Most selective lookup first: the longest word.
  const primary = [...lookup].sort((a, b) => b.length - a.length)[0];
  const matches = (d: SearchDoc) =>
    qWords.every((w) => d.terms.includes(w) || (w.length > 10 && d.terms.includes(w.slice(0, 10)) && words(d.snippet).some((x) => x.startsWith(w)))) &&
    (!input.authorId || d.authorId === input.authorId) &&
    (input.hasFile !== true || d.hasFile) &&
    (!input.after || d.createdAt.toMillis() >= input.after);

  const results: SearchDoc[] = [];
  let before = input.before ? Timestamp.fromMillis(input.before) : null;
  let scanned = 0;
  let exhausted = false;
  while (results.length < PAGE && scanned < MAX_SCAN && !exhausted) {
    // One query per 30 channels (Firestore `in` limit), merged newest-first.
    const batches = await Promise.all(
      chunk(channelIds, 30).map((ids) => {
        let q = db
          .collection('search')
          .where('channelId', 'in', ids)
          .where('terms', 'array-contains', primary)
          .orderBy('createdAt', 'desc')
          .orderBy(FieldPath.documentId(), 'desc');
        if (before) q = q.where('createdAt', '<', before);
        return q.limit(BATCH).get();
      }),
    );
    const docs = batches
      .flatMap((b) => b.docs.map((d) => d.data() as SearchDoc))
      .sort((a, b) => b.createdAt.toMillis() - a.createdAt.toMillis())
      .slice(0, BATCH);
    if (docs.length < BATCH) exhausted = true;
    if (!docs.length) break;
    scanned += docs.length;
    for (const d of docs) {
      if (results.length >= PAGE) break;
      if (matches(d)) results.push(d);
      before = d.createdAt;
    }
  }

  return {
    results: results.map((d) => ({
      messageId: d.messageId,
      channelId: d.channelId,
      threadParentId: d.threadParentId,
      authorId: d.authorId,
      createdAt: d.createdAt.toMillis(),
      snippet: d.snippet,
      hasFile: d.hasFile,
    })),
    // More may exist if we stopped early; the client passes this back as `before`.
    nextBefore: exhausted && results.length < PAGE ? null : (before?.toMillis() ?? null),
  };
}
