import { useCallback, useEffect, useRef, useState } from 'react';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  increment,
  limit,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  updateDoc,
  where,
  and,
  or,
  writeBatch,
  Timestamp,
  type DocumentSnapshot,
  type QueryDocumentSnapshot,
} from 'firebase/firestore';
import { db } from '../firebase';
import { listenDoc, listenQuery } from '../lib/snapshot';
import { plainPreview } from '../lib/markdown';
import type { Attachment, Channel, Message, UserProfile } from './types';

export const PAGE_SIZE = 50;

/**
 * The channel feed: top-level messages, plus thread replies "also sent to the channel".
 * If the OR query's index isn't available (e.g. still building right after a deploy), fall
 * back to top-level messages only rather than failing the whole channel.
 */
let orFeedUnavailable = false;
const channelFeedFilter = () =>
  orFeedUnavailable ? and(where('threadParentId', '==', null)) : or(where('threadParentId', '==', null), where('alsoToChannel', '==', true));

const toMessage = (d: QueryDocumentSnapshot | DocumentSnapshot): Message => {
  const data = d.data({ serverTimestamps: 'estimate' })!;
  return {
    id: d.id,
    text: data.text ?? '',
    authorId: data.authorId,
    createdAt: data.createdAt ?? null,
    editedAt: data.editedAt ?? null,
    threadParentId: data.threadParentId ?? null,
    attachments: data.attachments ?? [],
    mentions: data.mentions ?? [],
    replyCount: data.replyCount ?? 0,
    lastReplyAt: data.lastReplyAt ?? null,
    replyUserIds: data.replyUserIds ?? [],
    deleted: data.deleted ?? false,
    pending: d.metadata.hasPendingWrites,
    reactions: data.reactions ?? {},
    alsoToChannel: data.alsoToChannel ?? false,
    linkPreviews: data.linkPreviews ?? [],
  };
};

const byTime = (a: Message, b: Message) => (a.createdAt?.toMillis() ?? Infinity) - (b.createdAt?.toMillis() ?? Infinity);

/**
 * Top-level messages of a channel, oldest → newest.
 * The newest PAGE_SIZE are live (one listener); older pages are fetched on demand with
 * cursor queries, so opening a channel costs at most 50 reads no matter how long it is.
 */
export function useChannelMessages(channelId: string, enabled = true) {
  const [live, setLive] = useState<Map<string, Message>>(new Map());
  const [older, setOlder] = useState<Map<string, Message>>(new Map());
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const oldestCursor = useRef<QueryDocumentSnapshot | null>(null);
  const liveOldest = useRef<QueryDocumentSnapshot | null>(null);
  const [retry, setRetry] = useState(0);

  useEffect(() => {
    setLive(new Map());
    setOlder(new Map());
    setLoading(true);
    setHasMore(true);
    setError(null);
    oldestCursor.current = null;
    liveOldest.current = null;
    if (!enabled) return;
    const q = query(
      collection(db, 'channels', channelId, 'messages'),
      channelFeedFilter(),
      orderBy('createdAt', 'desc'),
      limit(PAGE_SIZE),
    );
    return listenQuery(
      q,
      (snap) => {
        setLive((prev) => {
          const next = new Map(prev);
          const docs = snap.docs;
          const oldestLive = docs[docs.length - 1];
          // Include metadata-only changes so "Sending…" clears when the server acknowledges.
          for (const ch of snap.docChanges({ includeMetadataChanges: true })) {
            if (ch.type === 'removed') {
              // Falling out of the live window (a newer message arrived) is not a delete:
              // keep it as an "older" message.
              const m = next.get(ch.doc.id);
              const fellOut = docs.length === PAGE_SIZE && m?.createdAt && oldestLive && m.createdAt.toMillis() <= toMessage(oldestLive).createdAt!.toMillis();
              if (fellOut && m) setOlder((o) => new Map(o).set(m.id, m));
              next.delete(ch.doc.id);
            } else {
              next.set(ch.doc.id, toMessage(ch.doc));
            }
          }
          return next;
        });
        liveOldest.current = snap.docs[snap.docs.length - 1] ?? null;
        if (!oldestCursor.current) oldestCursor.current = liveOldest.current;
        if (snap.docs.length < PAGE_SIZE && !oldestCursor.current) setHasMore(false);
        // A cached result is final when offline; otherwise wait for the server's answer
        // (an empty cached result is only trustworthy once the server confirms it).
        if (!snap.metadata.fromCache || snap.docs.length > 0 || !navigator.onLine) setLoading(false);
        if (!snap.metadata.fromCache && snap.docs.length < PAGE_SIZE) setHasMore(false);
      },
      (err) => {
        if (err.code === 'failed-precondition' && !orFeedUnavailable) {
          orFeedUnavailable = true;
          setRetry((r) => r + 1);
          return;
        }
        setError(err.code === 'permission-denied' ? "You don't have access to this channel." : err.message);
        setLoading(false);
      },
      // Without this, a cached empty result that the server confirms fires no second
      // snapshot (only the fromCache flag changes), and the spinner never stops.
      { includeMetadataChanges: true },
    );
  }, [channelId, enabled, retry]);

  const loadOlder = useCallback(async () => {
    const cursor = oldestCursor.current;
    if (!cursor || loadingOlder || !hasMore) return;
    setLoadingOlder(true);
    try {
      const snap = await getDocs(
        query(
          collection(db, 'channels', channelId, 'messages'),
          channelFeedFilter(),
          orderBy('createdAt', 'desc'),
          startAfter(cursor),
          limit(PAGE_SIZE),
        ),
      );
      setOlder((o) => {
        const next = new Map(o);
        snap.docs.forEach((d) => next.set(d.id, toMessage(d)));
        return next;
      });
      oldestCursor.current = snap.docs[snap.docs.length - 1] ?? cursor;
      if (snap.docs.length < PAGE_SIZE) setHasMore(false);
    } finally {
      setLoadingOlder(false);
    }
  }, [channelId, loadingOlder, hasMore]);

  const all = new Map([...older, ...live]);
  const messages = [...all.values()].sort(byTime);
  return { messages, loading, hasMore, loadOlder, loadingOlder, error, removeLocal: (id: string) => setOlder((o) => (o.delete(id), new Map(o))) };
}

/** A thread: the parent message plus its replies (oldest → newest), both live. */
export function useThread(channelId: string, parentId: string | undefined) {
  const [parent, setParent] = useState<Message | null | undefined>(undefined);
  const [replies, setReplies] = useState<Message[]>([]);
  useEffect(() => {
    setParent(undefined);
    setReplies([]);
    if (!parentId) return;
    const a = listenDoc(
      doc(db, 'channels', channelId, 'messages', parentId),
      (d) => setParent(d.exists() ? toMessage(d) : null),
      () => setParent(null),
    );
    const b = listenQuery(
      query(collection(db, 'channels', channelId, 'messages'), where('threadParentId', '==', parentId), orderBy('createdAt', 'asc'), limit(500)),
      (snap) => setReplies(snap.docs.map(toMessage)),
    );
    return () => {
      a();
      b();
    };
  }, [channelId, parentId]);
  return { parent, replies };
}

export function newMessageId(channelId: string): string {
  return doc(collection(db, 'channels', channelId, 'messages')).id;
}

interface SendOpts {
  channel: Channel;
  me: string;
  text: string;
  mentions: string[];
  attachments?: Attachment[];
  thread?: Message | null;
  messageId?: string;
  users: Map<string, UserProfile>;
  /** Thread reply that should also appear in the channel. */
  alsoToChannel?: boolean;
}

/**
 * Posts a message in one batch with the denormalized bits the sidebar and threads need:
 * channel.lastMessageAt/lastMessage for top-level posts, parent reply summary for replies.
 */
export async function sendMessage({ channel, me, text, mentions, attachments = [], thread, messageId, users, alsoToChannel }: SendOpts) {
  const id = messageId ?? newMessageId(channel.id);
  const batch = writeBatch(db);
  batch.set(doc(db, 'channels', channel.id, 'messages', id), {
    text,
    authorId: me,
    createdAt: serverTimestamp(),
    threadParentId: thread?.id ?? null,
    attachments,
    mentions,
    replyCount: 0,
    replyUserIds: [],
    ...(thread && alsoToChannel ? { alsoToChannel: true } : {}),
  });
  if (thread) {
    batch.update(doc(db, 'channels', channel.id, 'messages', thread.id), {
      replyCount: increment(1),
      lastReplyAt: serverTimestamp(),
      replyUserIds: [...thread.replyUserIds.filter((u) => u !== me), me].slice(-5),
    });
  }
  if (!thread || alsoToChannel) {
    const preview = text ? plainPreview(text, users, 200) : attachments.length ? `📎 ${attachments[0].name}` : '';
    batch.update(doc(db, 'channels', channel.id), {
      lastMessageAt: serverTimestamp(),
      lastMessage: { text: preview.slice(0, 200), authorId: me },
    });
  }
  await batch.commit();
  return id;
}

export async function editMessage(channelId: string, message: Message, text: string, mentions: string[]) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', message.id), {
    text,
    mentions,
    attachments: message.attachments,
    editedAt: serverTimestamp(),
  });
}

/**
 * Deletes a message. Messages with replies are soft-deleted (the thread stays readable);
 * others are removed, and a Cloud Function deletes their files.
 */
export async function deleteMessage(channelId: string, message: Message, me: string) {
  const ref = doc(db, 'channels', channelId, 'messages', message.id);
  // Only the author can soft-delete (rules); admins removing someone else's message hard-delete.
  if (message.replyCount > 0 && message.authorId === me) {
    await updateDoc(ref, { text: '', mentions: [], attachments: [], deleted: true, editedAt: serverTimestamp() });
  } else {
    await deleteDoc(ref);
  }
}

export async function markRead(me: string, channelId: string) {
  await setDoc(doc(db, 'users', me, 'reads', channelId), { lastReadAt: serverTimestamp() });
}

/** Channels the user explicitly marked unread; auto-read is paused for them until they leave. */
export const manualUnread = new Set<string>();
export const MARKED_UNREAD_EVENT = 'flack:marked-unread';

/** "Mark unread": moves my read marker to just before this message. */
export async function markUnreadFrom(me: string, channelId: string, message: Message) {
  const at = message.createdAt?.toMillis();
  if (at == null) return;
  manualUnread.add(channelId);
  window.dispatchEvent(new CustomEvent(MARKED_UNREAD_EVENT, { detail: { channelId, ms: at - 1 } }));
  await setDoc(doc(db, 'users', me, 'reads', channelId), { lastReadAt: Timestamp.fromMillis(at - 1), manual: true });
}

/** The author hides the link previews on their message. */
export async function removeLinkPreviews(channelId: string, messageId: string) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', messageId), { linkPreviews: [] });
}
