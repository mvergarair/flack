import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { arrayRemove, arrayUnion, collection, deleteDoc, doc, FieldPath, getDoc, getDocs, increment, limit, orderBy, query, serverTimestamp, setDoc, updateDoc, where } from 'firebase/firestore';
import { as, fs, makeEnv, message, seed } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => seed(env));

const post = (authorId: string, extra: Record<string, unknown> = {}) => ({ ...message(authorId), createdAt: serverTimestamp(), ...extra });

describe('reading messages', () => {
  it('members read and page through messages', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(getDoc(doc(db, 'channels/pub/messages/m1')));
    await assertSucceeds(
      getDocs(query(collection(db, 'channels/pub/messages'), where('threadParentId', '==', null), orderBy('createdAt', 'desc'), limit(50))),
    );
  });

  it('non-members cannot read, even in public channels', async () => {
    await assertFails(getDoc(doc(fs(as(env, 'outsider')), 'channels/pub/messages/m1')));
    await assertFails(getDocs(collection(fs(as(env, 'outsider')), 'channels/pub/messages')));
    await assertFails(getDoc(doc(fs(as(env, 'admin')), 'channels/priv/messages/m1')));
    await assertFails(getDocs(collection(fs(as(env, 'admin')), 'channels/dm_member_member2/messages')));
  });

  it('deactivated members are locked out of channels they belong to', async () => {
    await assertFails(getDoc(doc(fs(as(env, 'gone')), 'channels/pub/messages/m1')));
    await assertFails(getDocs(collection(fs(as(env, 'gone')), 'channels/pub/messages')));
  });
});

describe('posting', () => {
  it('members post as themselves with the server time', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'member')), 'channels/pub/messages/new'), post('member')));
    await assertSucceeds(setDoc(doc(fs(as(env, 'member2')), 'channels/dm_member_member2/messages/new'), post('member2')));
  });

  it('rejects non-members, deactivated users and archived channels', async () => {
    await assertFails(setDoc(doc(fs(as(env, 'outsider')), 'channels/pub/messages/new'), post('outsider')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'channels/priv/messages/new'), post('admin')));
    await assertFails(setDoc(doc(fs(as(env, 'gone')), 'channels/pub/messages/new'), post('gone')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'channels/archived/messages/new'), post('member')));
  });

  it('rejects spoofed authors, client timestamps and forged thread stats', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('admin')));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { createdAt: new Date() })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { replyCount: 5 })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { replyUserIds: ['admin'] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { pinned: true })));
  });

  it('rejects empty, oversized and over-attached messages', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { text: '' })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { text: 'x'.repeat(40001) })));
    const att = { name: 'a', size: 1, contentType: 'text/plain', storagePath: 'channels/pub/new/a' };
    await assertSucceeds(setDoc(doc(db, 'channels/pub/messages/new'), post('member', { text: '', attachments: [att] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/new2'), post('member', { attachments: Array(11).fill({ ...att, storagePath: 'channels/pub/new2/a' }) })));
  });

  it('attachments must live in the message’s own Storage folder', async () => {
    const db = fs(as(env, 'member'));
    const att = (storagePath: string, extra: Record<string, unknown> = {}) => ({ name: 'a', size: 1, contentType: 'image/png', storagePath, thumbPath: null, ...extra });
    await assertSucceeds(setDoc(doc(db, 'channels/pub/messages/a1'), post('member', { attachments: [att('channels/pub/a1/x.png', { thumbPath: 'channels/pub/a1/thumb_x.webp' })] })));
    // Another channel's file (e.g. a private one), another message's, or a nested path.
    await assertFails(setDoc(doc(db, 'channels/pub/messages/a2'), post('member', { attachments: [att('channels/priv/m1/secret.pdf')] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/a3'), post('member', { attachments: [att('channels/pub/m1/x.png')] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/a4'), post('member', { attachments: [att('channels/pub/a4/../../priv/m1/x')] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/a5'), post('member', { attachments: [att('channels/pub/a5/x.png', { thumbPath: 'channels/priv/m1/t.webp' })] })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/a6'), post('member', { attachments: [att('channels/pub/a6/x.png', { url: 'https://evil' })] })));
    // Editing can't swap in a foreign path either.
    await assertFails(
      updateDoc(doc(db, 'channels/pub/messages/a1'), { text: 'hello', mentions: [], attachments: [att('channels/priv/m1/secret.pdf')], editedAt: serverTimestamp() }),
    );
  });
});

describe('editing and deleting', () => {
  it('authors edit their own text', async () => {
    await assertSucceeds(
      updateDoc(doc(fs(as(env, 'member')), 'channels/pub/messages/m1'), { text: 'edited', mentions: [], attachments: [], editedAt: serverTimestamp() }),
    );
  });

  it("nobody edits someone else's message or rewrites authorship/time", async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), { text: 'hacked', editedAt: serverTimestamp() }));
    const db = fs(as(env, 'member'));
    await assertFails(updateDoc(doc(db, 'channels/pub/messages/m1'), { authorId: 'admin' }));
    await assertFails(updateDoc(doc(db, 'channels/pub/messages/m1'), { createdAt: new Date(0) }));
    await assertFails(updateDoc(doc(db, 'channels/pub/messages/m1'), { text: 'x', editedAt: new Date() }));
  });

  it('deactivated authors cannot edit their old messages', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'gone')), 'channels/pub/messages/gonemsg'), { text: 'x', editedAt: serverTimestamp() }));
  });

  it('authors and admins delete; other members cannot', async () => {
    await assertFails(deleteDoc(doc(fs(as(env, 'outsider')), 'channels/pub/messages/m1')));
    await assertFails(deleteDoc(doc(fs(as(env, 'member')), 'channels/priv/messages/m1')));
    await assertSucceeds(deleteDoc(doc(fs(as(env, 'member2')), 'channels/priv/messages/m1')));
    await assertSucceeds(deleteDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1')));
    await assertFails(deleteDoc(doc(fs(as(env, 'member')), 'channels/pub/messages/gonemsg')));
  });
});

describe('thread summary', () => {
  const bump = (uid: string, n = 1) => ({ replyCount: increment(n), lastReplyAt: serverTimestamp(), replyUserIds: [uid] });

  it('members bump reply count by one with themselves as a replier', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), bump('admin')));
  });

  it('rejects jumps, fake repliers, non-members and bumps on replies', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), bump('admin', 2)));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), bump('member')));
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub/messages/m1'), bump('outsider')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(fs(ctx), 'channels/pub/messages/reply'), { ...message('member', { threadParentId: 'm1' }), createdAt: new Date() });
    });
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/reply'), bump('admin')));
  });
});

describe('reactions', () => {
  it('members add and remove their own reactions', async () => {
    const ref = doc(fs(as(env, 'admin')), 'channels/pub/messages/m1');
    await assertSucceeds(updateDoc(ref, new FieldPath('reactions', 'admin'), arrayUnion('👍')));
    await assertSucceeds(updateDoc(ref, new FieldPath('reactions', 'admin'), arrayUnion('🎉')));
    await assertSucceeds(updateDoc(ref, new FieldPath('reactions', 'admin'), arrayRemove('👍')));
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'member'), arrayUnion('👍')));
  });

  it("cannot react as someone else, or touch other people's reactions", async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'member'), arrayUnion('👎')));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(fs(ctx), 'channels/pub/messages/m1'), { reactions: { member: ['👍'] } });
    });
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), { reactions: {} }));
  });

  it('non-members and deactivated users cannot react; reactions cannot smuggle other edits', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'outsider')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'outsider'), arrayUnion('👍')));
    await assertFails(updateDoc(doc(fs(as(env, 'gone')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'gone'), arrayUnion('👍')));
    await assertFails(
      updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'admin'), arrayUnion('👍'), 'text', 'hacked'),
    );
  });

  it('caps reactions per person', async () => {
    const many = Array.from({ length: 21 }, (_, i) => `e${i}`);
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), new FieldPath('reactions', 'admin'), many));
  });
});

describe('also send to channel and link previews', () => {
  it('only thread replies can be also sent to the channel', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'channels/pub/messages/r1'), post('member', { threadParentId: 'm1', alsoToChannel: true })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/r2'), post('member', { alsoToChannel: true })));
    await assertFails(setDoc(doc(db, 'channels/pub/messages/r3'), post('member', { threadParentId: 'm1', alsoToChannel: 'yes' })));
  });

  it('clients never write previews; authors may only clear them', async () => {
    const db = fs(as(env, 'member'));
    const preview = [{ url: 'https://x.co', title: 'X', description: '', image: null, siteName: 'x.co' }];
    await assertFails(setDoc(doc(db, 'channels/pub/messages/n1'), post('member', { linkPreviews: preview })));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(fs(ctx), 'channels/pub/messages/m1'), { linkPreviews: preview });
    });
    await assertFails(updateDoc(doc(db, 'channels/pub/messages/m1'), { linkPreviews: [{ ...preview[0], title: 'Phish' }] }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'channels/pub/messages/m1'), { linkPreviews: [] }));
    await assertSucceeds(updateDoc(doc(db, 'channels/pub/messages/m1'), { linkPreviews: [] }));
  });
});

