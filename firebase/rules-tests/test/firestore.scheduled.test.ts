import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteDoc, deleteField, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { as, fs, makeEnv, seed, ts } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => seed(env));

const SLOT = 600_000;
const slot = (minutesAhead = 30) => ts(Math.ceil((Date.now() + minutesAhead * 60_000) / SLOT) * SLOT);
const message = (extra: Record<string, unknown> = {}) => ({
  kind: 'message',
  sendAt: slot(),
  status: 'pending',
  createdAt: serverTimestamp(),
  text: 'good morning',
  channelId: 'pub',
  threadParentId: null,
  mentions: [],
  ...extra,
});
const reminder = (extra: Record<string, unknown> = {}) => ({
  kind: 'reminder',
  sendAt: slot(),
  status: 'pending',
  createdAt: serverTimestamp(),
  text: 'call Ana',
  channelId: null,
  threadParentId: null,
  messageId: null,
  ...extra,
});

describe('scheduled messages and reminders', () => {
  it('owners schedule, read, reschedule and cancel; nobody else can see them', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'users/member/scheduled/s1'), message()));
    await assertSucceeds(setDoc(doc(db, 'users/member/scheduled/r1'), reminder({ channelId: 'pub', messageId: 'm1' })));
    await assertSucceeds(getDoc(doc(db, 'users/member/scheduled/s1')));
    await assertSucceeds(updateDoc(doc(db, 'users/member/scheduled/s1'), { sendAt: slot(120), text: 'edited' }));
    await assertSucceeds(deleteDoc(doc(db, 'users/member/scheduled/s1')));
    await assertFails(getDoc(doc(fs(as(env, 'admin')), 'users/member/scheduled/r1')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'users/member/scheduled/x'), reminder()));
    await assertFails(setDoc(doc(fs(as(env, 'gone')), 'users/gone/scheduled/x'), reminder()));
  });

  it('send times must be on the 10-minute grid, in the future, within a year', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'users/member/scheduled/a'), reminder({ sendAt: ts(slot().toMillis() + 60_000) })));
    await assertFails(setDoc(doc(db, 'users/member/scheduled/b'), reminder({ sendAt: slot(-30) })));
    await assertFails(setDoc(doc(db, 'users/member/scheduled/c'), reminder({ sendAt: slot(60 * 24 * 370) })));
    await assertFails(setDoc(doc(db, 'users/member/scheduled/d'), reminder({ sendAt: 'tomorrow' })));
  });

  it('messages only go to conversations you are in, with a valid shape', async () => {
    const db = fs(as(env, 'outsider'));
    await assertFails(setDoc(doc(db, 'users/outsider/scheduled/a'), message({ channelId: 'priv' })));
    const m = fs(as(env, 'member'));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/b'), message({ text: '' })));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/c'), message({ attachments: [] })));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/d'), message({ alsoToChannel: true }))); // not a thread reply
    await assertSucceeds(setDoc(doc(m, 'users/member/scheduled/e'), message({ threadParentId: 'm1', alsoToChannel: true })));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/f'), message({ status: 'failed' })));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/g'), reminder({ text: 'x'.repeat(501) })));
    await assertFails(setDoc(doc(m, 'users/member/scheduled/h'), reminder({ mentions: [] })));
  });

  it('kind, target and status set by the sweep cannot be forged; failed items can be retried', async () => {
    const m = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(m, 'users/member/scheduled/s1'), message()));
    await assertFails(updateDoc(doc(m, 'users/member/scheduled/s1'), { kind: 'reminder' }));
    await assertFails(updateDoc(doc(m, 'users/member/scheduled/s1'), { channelId: 'priv' }));
    await assertFails(updateDoc(doc(m, 'users/member/scheduled/s1'), { status: 'failed', error: 'x' }));
    await env.withSecurityRulesDisabled(async (ctx) => {
      await updateDoc(doc(ctx.firestore(), 'users/member/scheduled/s1'), { status: 'failed', error: 'The channel was archived.' });
    });
    await assertSucceeds(updateDoc(doc(m, 'users/member/scheduled/s1'), { status: 'pending', error: deleteField(), sendAt: slot(60) }));
  });
});
