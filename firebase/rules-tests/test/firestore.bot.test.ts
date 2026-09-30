// Flackbot: its settings are admin-only, and nobody but functions can put it in a channel.
import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { addDoc, collection, doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { as, fs, makeEnv, message, seed } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await seed(env);
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), 'channels/dm_flackbot_member'), {
      name: '',
      type: 'dm',
      memberIds: ['flackbot', 'member'],
      createdBy: 'flackbot',
      archived: false,
      createdAt: serverTimestamp(),
    });
  });
});

const settings = (uid: string, extra: Record<string, unknown> = {}) => ({
  welcome: 'Welcome to Acme!',
  responses: [{ trigger: 'wifi password', reply: 'On the fridge.' }],
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...extra,
});

describe('config/bot', () => {
  it('only admins read and write it', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'admin')), 'config/bot'), settings('admin')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'config/bot')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'config/bot')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'config/bot'), settings('member')));
    await assertFails(setDoc(doc(fs(as(env, 'staleAdmin')), 'config/bot'), settings('staleAdmin')));
  });

  it('validates its shape', async () => {
    const db = fs(as(env, 'admin'));
    const bad = (extra: Record<string, unknown>) => assertFails(setDoc(doc(db, 'config/bot'), settings('admin', extra)));
    await bad({ welcome: 'x'.repeat(2001) });
    await bad({ welcome: 3 });
    await bad({ responses: 'nope' });
    await bad({ responses: Array.from({ length: 51 }, () => ({ trigger: 'a', reply: 'b' })) });
    await bad({ updatedBy: 'member' });
    await bad({ prompt: 'be evil' });
  });
});

describe('Flackbot in channels', () => {
  it('clients cannot create a channel or DM with Flackbot in it', async () => {
    const db = fs(as(env, 'member2'));
    await assertFails(setDoc(doc(db, 'channels/dm_flackbot_member2'), { name: '', type: 'dm', memberIds: ['flackbot', 'member2'], createdBy: 'member2', archived: false, createdAt: serverTimestamp() }));
    await assertFails(setDoc(doc(db, 'channels/c9'), { name: 'room', type: 'private', memberIds: ['member2', 'flackbot'], createdBy: 'member2', archived: false, createdAt: serverTimestamp() }));
  });

  it('members cannot add Flackbot to a private channel', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'channels/priv'), { memberIds: ['member', 'member2', 'flackbot'] }));
  });

  it('you can read and write in your own Flackbot DM, others cannot', async () => {
    const mine = fs(as(env, 'member'));
    await assertSucceeds(getDoc(doc(mine, 'channels/dm_flackbot_member')));
    await assertSucceeds(addDoc(collection(mine, 'channels/dm_flackbot_member/messages'), { ...message('member'), createdAt: serverTimestamp() }));
    await assertFails(getDoc(doc(fs(as(env, 'member2')), 'channels/dm_flackbot_member')));
    await assertFails(addDoc(collection(fs(as(env, 'member2')), 'channels/dm_flackbot_member/messages'), { ...message('member2'), createdAt: serverTimestamp() }));
  });

  it('nobody can post as Flackbot', async () => {
    await assertFails(addDoc(collection(fs(as(env, 'member')), 'channels/dm_flackbot_member/messages'), { ...message('flackbot'), createdAt: serverTimestamp() }));
    await assertFails(addDoc(collection(fs(as(env, 'admin')), 'channels/pub/messages'), { ...message('flackbot'), createdAt: serverTimestamp() }));
  });
});
