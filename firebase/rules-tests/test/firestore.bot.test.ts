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

const ai = (uid: string, extra: Record<string, unknown> = {}) => ({
  enabled: true,
  model: 'claude-sonnet-5-5',
  dailyLimit: 30,
  monthlyBudgetUsd: 20,
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...extra,
});

describe('Ask Flackbot settings and usage', () => {
  it('everyone reads whether it is on; only admins change it', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'admin')), 'config/ai'), ai('admin')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'config/ai')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'config/ai'), ai('member')));
    await assertFails(setDoc(doc(fs(as(env, 'staleAdmin')), 'config/ai'), ai('staleAdmin')));
  });

  it('validates the model and limits', async () => {
    const db = fs(as(env, 'admin'));
    const bad = (extra: Record<string, unknown>) => assertFails(setDoc(doc(db, 'config/ai'), ai('admin', extra)));
    await bad({ model: 'gpt-5' });
    await bad({ dailyLimit: 0 });
    await bad({ dailyLimit: 501 });
    await bad({ dailyLimit: 2.5 });
    await bad({ monthlyBudgetUsd: -1 });
    await bad({ enabled: 'yes' });
    await bad({ apiKey: 'sk-...' });
    await assertSucceeds(setDoc(doc(db, 'config/ai'), ai('admin', { model: 'claude-haiku-4-5', monthlyBudgetUsd: 0 })));
  });

  it('usage and connection problems are for admins only, and written by functions', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'aiUsage/2026-09'), { questions: 3, costUsd: 0.1 });
      await setDoc(doc(ctx.firestore(), 'aiUsage/2026-09/people/member'), { dayCount: 3 });
      await setDoc(doc(ctx.firestore(), 'config/aiStatus'), { error: 'x' });
    });
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'aiUsage/2026-09')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'config/aiStatus')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'aiUsage/2026-09')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'aiUsage/2026-09/people/member')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'config/aiStatus')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'aiUsage/2026-09'), { questions: 0, costUsd: 0 }));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'config/aiStatus'), { error: null }));
  });

  it('clients cannot mark messages as Ask Flackbot questions or answers', async () => {
    const mine = fs(as(env, 'member'));
    await assertFails(setDoc(doc(mine, 'channels/dm_flackbot_member/messages/q1'), { ...message('member'), createdAt: serverTimestamp(), ai: { conversationId: 'c' } }));
    await assertSucceeds(setDoc(doc(mine, 'channels/dm_flackbot_member/messages/q1'), { ...message('member'), createdAt: serverTimestamp() }));
    await assertFails(updateDoc(doc(mine, 'channels/dm_flackbot_member/messages/q1'), { ai: { conversationId: 'c' } }));
  });
});
