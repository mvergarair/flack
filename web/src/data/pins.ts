import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

export async function pinMessage(channelId: string, messageId: string) {
  await updateDoc(doc(db, 'channels', channelId), { pinnedIds: arrayUnion(messageId) });
}

export async function unpinMessage(channelId: string, messageId: string) {
  await updateDoc(doc(db, 'channels', channelId), { pinnedIds: arrayRemove(messageId) });
}
