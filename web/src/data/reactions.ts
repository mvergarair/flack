import { arrayRemove, arrayUnion, doc, FieldPath, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';

/** Adds or removes my reaction (my own entry in reactions.{uid}). */
export async function toggleReaction(channelId: string, messageId: string, uid: string, emoji: string, on: boolean) {
  await updateDoc(doc(db, 'channels', channelId, 'messages', messageId), new FieldPath('reactions', uid), on ? arrayUnion(emoji) : arrayRemove(emoji));
}
