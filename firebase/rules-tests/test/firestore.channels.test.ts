import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { as, fs, makeEnv, seed } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => seed(env));

const newChannel = (over: Record<string, unknown> = {}) => ({
  name: 'new-room',
  type: 'public',
  memberIds: ['member'],
  createdBy: 'member',
  archived: false,
  topic: '',
  createdAt: serverTimestamp(),
  ...over,
});

describe('reading channels', () => {
  it('public channels are visible to every active user; private only to members', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'outsider')), 'channels/pub')));
    await assertFails(getDoc(doc(fs(as(env, 'outsider')), 'channels/priv')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'member2')), 'channels/priv')));
    await assertFails(getDoc(doc(fs(as(env, 'outsider')), 'channels/dm_member_member2')));
  });

  it('deactivated and signed-out users see nothing', async () => {
    await assertFails(getDoc(doc(fs(as(env, 'gone')), 'channels/pub')));
    await assertFails(getDoc(doc(fs(env.unauthenticatedContext()), 'channels/pub')));
  });

  it('only scoped queries are allowed', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(getDocs(query(collection(db, 'channels'), where('memberIds', 'array-contains', 'member'))));
    await assertSucceeds(getDocs(query(collection(db, 'channels'), where('type', '==', 'public'))));
    await assertFails(getDocs(collection(db, 'channels')));
    await assertFails(getDocs(query(collection(db, 'channels'), where('type', '==', 'private'))));
  });

  it('checking for a DM that does not exist yet is allowed', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'channels/dm_admin_member')));
  });
});

describe('creating channels', () => {
  it('a member creates a public channel with only themselves as member', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'member')), 'channels/c1'), newChannel()));
  });

  it('public channels cannot be created with other members pre-added', async () => {
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'channels/c1'), newChannel({ memberIds: ['member', 'member2'] })));
  });

  it('private channels may start with several members', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'member')), 'channels/c1'), newChannel({ type: 'private', memberIds: ['member', 'member2'] })));
  });

  it('rejects spoofed creators, missing self, pre-archived, bad names and client timestamps', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ createdBy: 'admin' })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ type: 'private', memberIds: ['member2'] })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ archived: true })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ name: 'Bad Name!' })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ createdAt: new Date(0) })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ type: 'secret' })));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ extra: 1 })));
    await assertFails(setDoc(doc(db, 'channels/dm_fake'), newChannel()));
  });

  it('channel ids use a safe alphabet; the last message cannot be spoofed at creation', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'channels/.*'), newChannel()));
    await assertFails(setDoc(doc(db, 'channels/c1'), newChannel({ lastMessageAt: serverTimestamp(), lastMessage: { text: 'fake', authorId: 'admin' } })));
  });

  it('typing keys: valid at creation, then set once by a member', async () => {
    const key = 't_' + 'Zx9'.repeat(8);
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'channels/c1'), newChannel({ typingKey: key })));
    await assertFails(setDoc(doc(db, 'channels/c2'), newChannel({ typingKey: 'short' })));
    // Existing channel without a key: a member adds one, once; outsiders can't.
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/priv'), { typingKey: key }));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member2')), 'channels/dm_member_member2'), { typingKey: key }));
    await assertFails(updateDoc(doc(db, 'channels/dm_member_member2'), { typingKey: 't_' + 'Q'.repeat(24) }));
  });

  it('deactivated users cannot create channels', async () => {
    await assertFails(setDoc(doc(fs(as(env, 'gone')), 'channels/c1'), newChannel({ memberIds: ['gone'], createdBy: 'gone' })));
  });

  it('DM ids must list exactly the sorted members, including me', async () => {
    const dm = (memberIds: string[]) => newChannel({ type: 'dm', name: '', memberIds });
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'channels/dm_admin_member'), dm(['admin', 'member'])));
    await assertSucceeds(setDoc(doc(db, 'channels/dm_member'), dm(['member'])));
    await assertSucceeds(setDoc(doc(db, 'channels/dm_admin_member_outsider'), dm(['admin', 'member', 'outsider'])));
    await assertFails(setDoc(doc(db, 'channels/dm_admin_member2'), dm(['admin', 'member2'])));
    await assertFails(setDoc(doc(db, 'channels/dm_member_admin'), dm(['admin', 'member'])));
    await assertFails(setDoc(doc(db, 'channels/dm_admin_member'), dm(['admin', 'member', 'member2'])));
  });

  it('existing DMs cannot be overwritten', async () => {
    await assertFails(
      setDoc(doc(fs(as(env, 'member')), 'channels/dm_member_member2'), newChannel({ type: 'dm', name: '', memberIds: ['member', 'member2'] })),
    );
  });
});

describe('membership changes', () => {
  it('anyone active can join a public channel (adding only themselves)', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub'), { memberIds: arrayUnion('outsider') }));
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub'), { memberIds: arrayUnion('member2') }));
  });

  it('nobody can join a private channel on their own, or join an archived channel', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/priv'), { memberIds: arrayUnion('outsider') }));
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/archived'), { memberIds: arrayUnion('outsider') }));
  });

  it('members can leave; nobody can remove someone else', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/priv'), { memberIds: arrayRemove('member') }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub'), { memberIds: arrayRemove('member') }));
  });

  it('members of a private channel can add people; outsiders cannot', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/priv'), { memberIds: arrayUnion('outsider') }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/priv'), { memberIds: arrayUnion('admin') }));
  });

  it("DM membership can't change", async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/dm_member_member2'), { memberIds: arrayUnion('admin') }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/dm_member_member2'), { memberIds: arrayRemove('member') }));
  });
});

describe('rename / topic / archive', () => {
  const edit = { name: 'renamed', topic: 'new topic', archived: false };

  it('the creator and admins can rename, set topic and archive', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), edit));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'admin')), 'channels/priv'), { ...edit, name: 'priv' }));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { ...edit, archived: true }));
  });

  it('other members, stale admins and deactivated users cannot', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'member2')), 'channels/priv'), edit));
    await assertFails(updateDoc(doc(fs(as(env, 'staleAdmin')), 'channels/pub'), edit));
    await assertFails(updateDoc(doc(fs(as(env, 'gone')), 'channels/pub'), edit));
  });

  it('cannot rename to an invalid name or change type/creator', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(updateDoc(doc(db, 'channels/pub'), { ...edit, name: 'Has Spaces' }));
    await assertFails(updateDoc(doc(db, 'channels/pub'), { type: 'private' }));
    await assertFails(updateDoc(doc(db, 'channels/pub'), { createdBy: 'member2' }));
  });

  it('channels are never deleted from the client', async () => {
    await assertFails(deleteDoc(doc(fs(as(env, 'admin')), 'channels/pub')));
  });
});

describe('last-message bump', () => {
  const bump = (authorId: string) => ({ lastMessageAt: serverTimestamp(), lastMessage: { text: 'hi', authorId } });

  it('members bump lastMessage with the server time as themselves', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), bump('member')));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/dm_member_member2'), bump('member')));
  });

  it('non-members, spoofed authors, client times and archived channels are rejected', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub'), bump('outsider')));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), bump('admin')));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { lastMessageAt: new Date(), lastMessage: { text: 'hi', authorId: 'member' } }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/archived'), bump('member')));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { ...bump('member'), lastMessage: { text: 'x'.repeat(201), authorId: 'member' } }));
  });
});

describe('pins', () => {
  it('members pin and unpin messages', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { pinnedIds: arrayUnion('m1') }));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { pinnedIds: arrayRemove('m1') }));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member2')), 'channels/dm_member_member2'), { pinnedIds: ['x'] }));
  });

  it('non-members, archived channels and oversized lists are rejected', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub'), { pinnedIds: ['m1'] }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/archived'), { pinnedIds: ['m1'] }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { pinnedIds: Array.from({ length: 51 }, (_, i) => `m${i}`) }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/pub'), { pinnedIds: ['m1'], name: 'renamed' }));
  });
});

