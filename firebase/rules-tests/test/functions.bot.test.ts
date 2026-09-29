// Flackbot: the welcome DM (openflackbot), auto-responses and the help reply in its DM, all
// against the Functions + Auth + Firestore emulators.
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';

const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const set = (path: string, data: unknown) => cli('set', path, JSON.stringify(data));
const get = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('get', path)) as T | null;
const query = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('query', path)) as (T & { id: string })[];

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
  return (await r.json()) as { result?: Record<string, unknown>; error?: { status: string } };
}

const post = (channelId: string, id: string, authorId: string, text: string, extra: Record<string, unknown> = {}) =>
  set(`channels/${channelId}/messages/${id}`, {
    text,
    authorId,
    createdAt: { __ts: Date.now() },
    threadParentId: null,
    attachments: [],
    mentions: [],
    replyCount: 0,
    replyUserIds: [],
    ...extra,
  });

const DM = 'dm_flackbot_uMember';

beforeEach(() => {
  cli('seed', '{}');
});

describe('openflackbot', () => {
  it('creates your Flackbot DM with the welcome message, once', async () => {
    set('config/bot', { welcome: 'Welcome to Acme!', responses: [] });
    expect((await call(null, 'openflackbot', {})).error?.status).toBe('UNAUTHENTICATED');

    expect((await call('member@flack.test', 'openflackbot', {})).result).toEqual({ channelId: DM });
    expect(get(`channels/${DM}`)).toMatchObject({ type: 'dm', memberIds: ['flackbot', 'uMember'], createdBy: 'flackbot', archived: false });
    expect(get(`channels/${DM}`)).toMatchObject({ typingKey: expect.stringMatching(/^t_[A-Za-z0-9]{20,40}$/), lastMessage: { authorId: 'flackbot' } });
    expect(get(`channels/${DM}/messages/welcome_uMember`)).toMatchObject({ authorId: 'flackbot', text: 'Welcome to Acme!', botRef: { kind: 'welcome' } });

    // Again: nothing new.
    expect((await call('member@flack.test', 'openflackbot', {})).result).toEqual({ channelId: DM });
    expect(query(`channels/${DM}/messages`)).toHaveLength(1);
  }, 60_000);

  it('uses the built-in welcome when admins have not written one', async () => {
    await call('member2@flack.test', 'openflackbot', {});
    expect(get<{ text: string }>('channels/dm_flackbot_uMember2/messages/welcome_uMember2')?.text).toMatch(/I'm Flackbot/);
  }, 60_000);
});

describe('auto-responses', () => {
  it('answers a matching phrase in the same channel or thread, as Flackbot', async () => {
    set('config/bot', { welcome: '', responses: [{ trigger: 'WiFi password', reply: 'It is on the fridge.' }] });
    post('cGeneral', 'q1', 'uMember', "what's the wifi password?");
    post('cGeneral', 'q2', 'uMember2', 'wifi password please', { threadParentId: 'q1' });
    post('cGeneral', 'q3', 'uMember', 'nothing to see here');

    await expect.poll(() => get('channels/cGeneral/messages/bot_q1'), { timeout: 15_000 }).toMatchObject({ authorId: 'flackbot', text: 'It is on the fridge.', threadParentId: null });
    await expect.poll(() => get('channels/cGeneral/messages/bot_q2'), { timeout: 15_000 }).toMatchObject({ authorId: 'flackbot', threadParentId: 'q1' });
    await new Promise((r) => setTimeout(r, 2000));
    expect(get('channels/cGeneral/messages/bot_q3')).toBeNull();
    // Flackbot never answers itself.
    expect(query('channels/cGeneral/messages').filter((m) => m.id.startsWith('bot_bot_'))).toHaveLength(0);
  }, 60_000);

  it('replies with help in its DM when nothing matches, and notifies like a DM', async () => {
    await call('member@flack.test', 'openflackbot', {});
    set('users/uMember/private/tokens', { tokens: { tok1: true } });
    post(DM, 'hi1', 'uMember', 'hello bot');
    await expect.poll(() => get<{ text: string }>(`channels/${DM}/messages/bot_hi1`)?.text, { timeout: 15_000 }).toMatch(/simple bot/);
    // The help reply is pushed like any DM; the welcome never is.
    await expect.poll(() => query<{ title: string; body: string }>('_debug/pushes/items').filter((p) => p.title === 'Flackbot').map((p) => p.body), { timeout: 15_000 }).toEqual([
      expect.stringMatching(/simple bot/),
    ]);
  }, 60_000);
});

/** The emulators occasionally reset a kept-alive connection; retry once. */
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
