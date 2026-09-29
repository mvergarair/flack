import { collection, deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { validSlot } from '../lib/schedule';
import { sendMessage } from './messages';
import type { Channel, Message, ScheduledItem, UserProfile } from './types';

const col = (uid: string) => collection(db, 'users', uid, 'scheduled');

function checkSlot(at: number) {
  if (!validSlot(at)) throw new Error('Pick a time in the future (times go in 10-minute steps).');
}

/** Schedules a text message; the 10-minute sweep posts it as me at `at`. Returns its id. */
export async function scheduleMessage(
  uid: string,
  p: { channelId: string; threadParentId: string | null; text: string; mentions: string[]; alsoToChannel?: boolean; at: number },
): Promise<string> {
  checkSlot(p.at);
  const ref = doc(col(uid));
  await setDoc(ref, {
    kind: 'message',
    sendAt: Timestamp.fromMillis(p.at),
    status: 'pending',
    createdAt: serverTimestamp(),
    text: p.text,
    channelId: p.channelId,
    threadParentId: p.threadParentId,
    mentions: p.mentions,
    ...(p.threadParentId && p.alsoToChannel ? { alsoToChannel: true } : {}),
  });
  return ref.id;
}

/** A reminder: free text ("/remind"), optionally about a message. */
export async function scheduleReminder(
  uid: string,
  p: { text: string; at: number; channelId?: string | null; messageId?: string | null; threadParentId?: string | null },
): Promise<string> {
  checkSlot(p.at);
  const ref = doc(col(uid));
  await setDoc(ref, {
    kind: 'reminder',
    sendAt: Timestamp.fromMillis(p.at),
    status: 'pending',
    createdAt: serverTimestamp(),
    text: p.text.slice(0, 500),
    channelId: p.channelId ?? null,
    threadParentId: p.threadParentId ?? null,
    messageId: p.messageId ?? null,
  });
  return ref.id;
}

/** New time (also retries a failed item). */
export async function reschedule(uid: string, id: string, at: number) {
  checkSlot(at);
  await updateDoc(doc(col(uid), id), { sendAt: Timestamp.fromMillis(at), status: 'pending', error: deleteField() });
}

export async function editScheduledText(uid: string, id: string, text: string, mentions: string[]) {
  await updateDoc(doc(col(uid), id), { text, mentions });
}

export async function cancelScheduled(uid: string, id: string) {
  await deleteDoc(doc(col(uid), id));
}

/** Posts a scheduled message right away (same message id the sweep would use). */
export async function sendScheduledNow(uid: string, item: ScheduledItem, channel: Channel, users: Map<string, UserProfile>) {
  if (item.kind !== 'message' || !item.channelId) return;
  let thread: Message | null = null;
  if (item.threadParentId) {
    const parent = await getDoc(doc(db, 'channels', item.channelId, 'messages', item.threadParentId));
    if (!parent.exists()) throw new Error('The thread no longer exists.');
    thread = { id: parent.id, ...parent.data() } as Message;
  }
  await sendMessage({
    channel,
    me: uid,
    text: item.text,
    mentions: item.mentions ?? [],
    thread,
    messageId: item.id,
    users,
    alsoToChannel: !!item.alsoToChannel,
  });
  await cancelScheduled(uid, item.id);
}
