import { deleteDoc, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import type { Message } from './types';

export async function saveForLater(uid: string, channelId: string, message: Message) {
  await setDoc(doc(db, 'users', uid, 'saved', message.id), {
    channelId,
    messageId: message.id,
    threadParentId: message.threadParentId ?? null,
    savedAt: serverTimestamp(),
  });
}

export async function removeSaved(uid: string, messageId: string) {
  await deleteDoc(doc(db, 'users', uid, 'saved', messageId));
}
