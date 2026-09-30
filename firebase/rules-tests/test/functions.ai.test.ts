// Ask Flackbot (askflackbot) against the emulators. The functions use a scripted stand-in for
// Claude there (ai/model.ts → fakeModel): it searches for the question's last two long words,
// then answers by quoting what it found with [ref] citations. That exercises the whole loop,
// and above all that the tools only see what the asker can see.
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';
const RTDB = 'http://127.0.0.1:9300';

const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const set = (path: string, data: unknown) => cli('set', path, JSON.stringify(data));
const get = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('get', path)) as T | null;

async function call(email: string | null, name: string, data: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) {
    const r = await fetchRetry(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
    });
    headers.Authorization = `Bearer ${((await r.json()) as { idToken: string }).idToken}`;
  }
  const r = await fetchRetry(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } };
}

const post = (channelId: string, id: string, authorId: string, text: string) =>
  set(`channels/${channelId}/messages/${id}`, { text, authorId, createdAt: { __ts: Date.now() }, threadParentId: null, attachments: [], mentions: [], replyCount: 0, replyUserIds: [] });

const MEMBER = 'member@flack.test';
const ADMIN = 'admin@flack.test';
const CONV = 'conv_test_0001';
const month = new Date().toISOString().slice(0, 7);

type Answer = { authorId: string; text: string; ai: { conversationId: string; questionId: string }; botRef: { kind: string; sources: { n: number; channelId: string; messageId: string; label: string }[] } };

async function ask(email: string, uid: string, id: string, question: string, conversationId = CONV) {
  const dm = `dm_flackbot_${uid}`;
  if (!get(`channels/${dm}`)) await call(email, 'openflackbot', {});
  post(dm, id, uid, question);
  const res = await call(email, 'askflackbot', { messageId: id, conversationId });
  return { res, answer: get<Answer>(`channels/${dm}/messages/ai_${id}`) };
}

beforeEach(() => {
  cli('seed', JSON.stringify({ demo: true }));
  set('config/ai', { enabled: true, model: 'claude-sonnet-5-5', dailyLimit: 30, monthlyBudgetUsd: 20 });
});

describe('askflackbot', () => {
  it('answers from the asker’s channels, with sources, and records the cost', async () => {
    const { res, answer } = await ask(MEMBER, 'uMember', 'q1', 'anything new about the upload flow?');
    expect(res.result).toEqual({ ok: true });
    expect(answer).toMatchObject({ authorId: 'flackbot', ai: { conversationId: CONV, questionId: 'q1' }, botRef: { kind: 'ai' } });
    expect(answer!.text).toMatch(/finish the upload flow.*\[1\]/);
    expect(answer!.botRef.sources[0]).toMatchObject({ n: 1, channelId: 'cEngineering', messageId: 'eng0', label: '#engineering · Mia Member' });
    // The question is tagged with its conversation, and the Flackbot DM got no help reply.
    expect(get('channels/dm_flackbot_uMember/messages/q1')).toMatchObject({ ai: { conversationId: CONV } });
    expect(get('channels/dm_flackbot_uMember/messages/bot_q1')).toBeNull();
    // Usage for the month and the person; the live draft is cleaned up.
    expect(get<{ questions: number; costUsd: number }>(`aiUsage/${month}`)).toMatchObject({ questions: 1, costUsd: expect.any(Number) });
    expect(get<{ costUsd: number }>(`aiUsage/${month}`)!.costUsd).toBeGreaterThan(0);
    expect(get(`aiUsage/${month}/people/uMember`)).toMatchObject({ dayCount: 1, questions: 1 });
    const draft = await fetch(`${RTDB}/botDrafts/uMember.json?ns=demo-flack-default-rtdb`, { headers: { Authorization: 'Bearer owner' } });
    expect(await draft.json()).toBeNull();
  }, 60_000);

  it('never sees private channels the asker is not in', async () => {
    post('cSecret', 'sec1', 'uAdmin', 'The confidential merger closes Friday');
    await expect.poll(() => get('search/sec1'), { timeout: 15_000 }).not.toBeNull();

    const member = await ask(MEMBER, 'uMember', 'q2', 'what about the confidential merger?');
    expect(member.answer!.text).toMatch(/couldn't find/);
    expect(member.answer!.botRef.sources).toEqual([]);

    const admin = await ask(ADMIN, 'uAdmin', 'q3', 'what about the confidential merger?');
    expect(admin.answer!.text).toMatch(/merger closes Friday/);
    expect(admin.answer!.botRef.sources[0]).toMatchObject({ channelId: 'cSecret', label: '#leadership · Ada Admin' });
  }, 60_000);

  it('answers each question once, only for its author, and only when on', async () => {
    await ask(MEMBER, 'uMember', 'q4', 'upload flow?');
    expect((await call(MEMBER, 'askflackbot', { messageId: 'q4', conversationId: CONV })).error?.status).toBe('ALREADY_EXISTS');
    // Someone else can't ask about my question (it isn't in their DM).
    expect((await call('member2@flack.test', 'askflackbot', { messageId: 'q4', conversationId: CONV })).error?.status).toBe('NOT_FOUND');
    expect((await call(null, 'askflackbot', { messageId: 'q4', conversationId: CONV })).error?.status).toBe('UNAUTHENTICATED');
    expect((await call(MEMBER, 'askflackbot', { messageId: 'q4', conversationId: 'bad id!' })).error?.status).toBe('INVALID_ARGUMENT');

    set('config/ai', { enabled: false });
    post('dm_flackbot_uMember', 'q5', 'uMember', 'hello?');
    expect((await call(MEMBER, 'askflackbot', { messageId: 'q5', conversationId: CONV })).error?.status).toBe('FAILED_PRECONDITION');
    // With it off, the DM gets the usual help reply instead.
    await expect.poll(() => get<{ text: string }>('channels/dm_flackbot_uMember/messages/bot_q5')?.text, { timeout: 15_000 }).toMatch(/simple bot/);
  }, 60_000);

  it('enforces the daily limit and the monthly budget', async () => {
    set('config/ai', { dailyLimit: 1 });
    expect((await ask(MEMBER, 'uMember', 'q6', 'upload flow?')).res.result).toEqual({ ok: true });
    const second = await ask(MEMBER, 'uMember', 'q7', 'upload flow again?');
    expect(second.res.error).toMatchObject({ status: 'RESOURCE_EXHAUSTED', message: expect.stringMatching(/1 questions today/) });
    expect(second.answer).toBeNull();

    set('config/ai', { dailyLimit: 30, monthlyBudgetUsd: 1 });
    set(`aiUsage/${month}`, { costUsd: 1.5 });
    expect((await ask(MEMBER, 'uMember', 'q8', 'upload flow?')).res.error).toMatchObject({ status: 'RESOURCE_EXHAUSTED', message: expect.stringMatching(/budget/) });
  }, 60_000);

  it('keeps each conversation separate', async () => {
    await ask(MEMBER, 'uMember', 'c1', 'upload flow?', 'conv_aaaaaaaa');
    await ask(MEMBER, 'uMember', 'c2', 'no tools please', 'conv_bbbbbbbb');
    expect(get('channels/dm_flackbot_uMember/messages/ai_c2')).toMatchObject({ text: 'Hello from the fake model.', ai: { conversationId: 'conv_bbbbbbbb' } });
  }, 60_000);
});

describe('testflackbotai', () => {
  it('is for admins, and reports that the model answers', async () => {
    expect((await call(MEMBER, 'testflackbotai', {})).error?.status).toBe('PERMISSION_DENIED');
    expect((await call(ADMIN, 'testflackbotai', {})).result).toMatchObject({ ok: true, model: 'claude-sonnet-5-5' });
    expect(get('config/aiStatus')).toMatchObject({ error: null });
  }, 60_000);
});

async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const code = (err as { cause?: { code?: string } }).cause?.code;
    if (code !== 'ECONNRESET' && code !== 'UND_ERR_SOCKET' && code !== 'EPIPE') throw err;
    await new Promise((r) => setTimeout(r, 200));
    return fetch(url, init);
  }
}
