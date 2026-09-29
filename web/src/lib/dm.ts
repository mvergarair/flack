import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { dmId, sortedMembers } from './channels';
import { newTypingKey } from '../data/typing';

/** Opens (creating if needed) the DM / group DM between me and `others`. Returns its id. */
export async function openDm(meId: string, others: string[]): Promise<string> {
  const members = sortedMembers([meId, ...others]);
  if (members.length > 9) throw new Error('Group messages are limited to 9 people.');
  const id = dmId(members);
  const ref = doc(db, 'channels', id);
  const snap = await getDoc(ref);
  if (!snap.exists()) {
    await setDoc(ref, {
      name: '',
      type: 'dm',
      memberIds: members,
      createdBy: meId,
      archived: false,
      typingKey: newTypingKey(),
      createdAt: serverTimestamp(),
    });
  }
  return id;
}
