import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Channel, NotifyLevel } from './types';

export const defaultLevel = (channel: Channel): NotifyLevel => (channel.type === 'dm' ? 'all' : 'mentions');

/** Saves my notification setting for a channel. Choosing the default removes the doc. */
export async function setNotifyLevel(uid: string, channel: Channel, level: NotifyLevel) {
  const ref = doc(db, 'users', uid, 'channelPrefs', channel.id);
  if (level === defaultLevel(channel)) await deleteDoc(ref);
  else await setDoc(ref, { level, channelId: channel.id, updatedAt: serverTimestamp() });
}
