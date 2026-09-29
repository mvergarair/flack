// The HTTP API (api function) and its token callables, against the emulators. Tokens are
// created through createapitoken exactly as the app does, then used like an integration would.
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';
const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const get = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('get', path)) as T | null;
const set = (path: string, data: unknown) => cli('set', path, JSON.stringify(data));

async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 200));
    return fetch(url, init);
  }
}

async function idToken(email: string) {
  const r = await fetchRetry(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  return ((await r.json()) as { idToken: string }).idToken;
}

async function callable(email: string, name: string, data: unknown) {
  const r = await fetchRetry(`${FN}/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${await idToken(email)}` },
    body: JSON.stringify({ data }),
  });
  return (await r.json()) as { result?: { id: string; token: string; scopes: string[] }; error?: { status: string; message: string } };
}

async function newToken(email: string, scopes: string[] = ['read', 'write']) {
  const r = await callable(email, 'createapitoken', { name: 'test', scopes });
  if (!r.result) throw new Error(r.error?.message);
  return r.result;
}

async function api(token: string | null, method: string, path: string, body?: unknown, headers: Record<string, string> = {}) {
  const r = await fetchRetry(`${FN}/api${path}`, {
    method,
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: r.status, body: (await r.json()) as Record<string, any> };
}

const ADMIN = 'admin@flack.test';
const MEMBER = 'member@flack.test';
const MEMBER2 = 'member2@flack.test';

beforeEach(() => {
  cli('seed', JSON.stringify({ demo: true }));
});

describe('API tokens', () => {
  it('are created once in plain text and stored only as a hash', async () => {
    const { id, token, scopes } = await newToken(MEMBER, ['write']);
    expect(token).toMatch(/^flk_[A-Za-z0-9_-]{43}$/);
    expect(scopes).toEqual(['read', 'write']);
    const doc = get<Record<string, unknown>>(`apiTokens/${id}`)!;
    expect(doc).toMatchObject({ uid: 'uMember', name: 'test', scopes: ['read', 'write'], prefix: token.slice(0, 10) });
    expect(JSON.stringify(doc)).not.toContain(token);
  });

  it('validate input, and only owners or admins revoke', async () => {
    expect((await callable(MEMBER, 'createapitoken', { name: '', scopes: ['read'] })).error?.status).toBe('INVALID_ARGUMENT');
    expect((await callable(MEMBER, 'createapitoken', { name: 'x', scopes: ['admin'] })).error?.status).toBe('INVALID_ARGUMENT');
    const { id } = await newToken(MEMBER);
    expect((await callable(MEMBER2, 'revokeapitoken', { id })).error?.status).toBe('PERMISSION_DENIED');
    expect((await callable(ADMIN, 'revokeapitoken', { id })).result).toEqual({ ok: true });
    expect(get(`apiTokens/${id}`)).toBeNull();
  });
});

describe('API authentication', () => {
  it('rejects missing, malformed, unknown and revoked tokens', async () => {
    expect((await api(null, 'GET', '/v1/me')).status).toBe(401);
    expect((await api('nope', 'GET', '/v1/me')).status).toBe(401);
    expect((await api(`flk_${'A'.repeat(43)}`, 'GET', '/v1/me')).status).toBe(401);
    const { id, token } = await newToken(MEMBER);
    expect((await api(token, 'GET', '/v1/me')).body.user).toMatchObject({ id: 'uMember', name: 'Mia Member' });
    await callable(MEMBER, 'revokeapitoken', { id });
    expect((await api(token, 'GET', '/v1/me')).status).toBe(401);
  });

  it('stops working when the owner is deactivated', async () => {
    const { token } = await newToken(MEMBER);
    set('users/uMember', { status: 'deactivated' });
    const r = await api(token, 'GET', '/v1/me');
    expect(r.status).toBe(403);
  });

  it('enforces scopes', async () => {
    const { token } = await newToken(MEMBER, ['read']);
    expect((await api(token, 'GET', '/v1/channels')).status).toBe(200);
    const r = await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: 'hi' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('insufficient_scope');
  });

  it('404s unknown endpoints with a JSON error', async () => {
    const { token } = await newToken(MEMBER);
    const r = await api(token, 'GET', '/v1/nope');
    expect(r).toMatchObject({ status: 404, body: { error: { code: 'not_found' } } });
  });
});

describe('API reads', () => {
  it('lists only my channels and never leaks private ones', async () => {
    const { token } = await newToken(MEMBER);
    const ids = (await api(token, 'GET', '/v1/channels')).body.channels.map((c: { id: string }) => c.id);
    expect(ids).toEqual(expect.arrayContaining(['cGeneral', 'cRandom']));
    expect(ids).not.toContain('cSecret');
    expect((await api(token, 'GET', '/v1/channels/cSecret')).status).toBe(404);
    expect((await api(token, 'GET', '/v1/channels/cSecret/messages')).status).toBe(404);
  });

  it('pages through messages newest first, with thread replies separately', async () => {
    const { token } = await newToken(MEMBER2);
    const page1 = await api(token, 'GET', '/v1/channels/cEngineering/messages?limit=2');
    expect(page1.status).toBe(200);
    expect(page1.body.messages).toHaveLength(2);
    expect(page1.body.messages[0].createdAt).toBeGreaterThan(page1.body.messages[1].createdAt);
    const page2 = await api(token, 'GET', `/v1/channels/cEngineering/messages?limit=2&before=${page1.body.nextBefore}`);
    expect(page2.body.messages[0].createdAt).toBeLessThan(page1.body.messages[1].createdAt);

    const replies = await api(token, 'GET', '/v1/channels/cEngineering/messages/eng1/replies');
    expect(replies.body.replies.length).toBeGreaterThan(0);
    expect(replies.body.replies.every((r: { threadId: string }) => r.threadId === 'eng1')).toBe(true);
    expect((await api(token, 'GET', '/v1/channels/cEngineering/messages/eng0')).body.message).toMatchObject({ id: 'eng0', authorId: 'uMember' });
  });

  it('lists active people', async () => {
    const { token } = await newToken(MEMBER);
    const users = (await api(token, 'GET', '/v1/users')).body.users as Array<{ id: string; status: string }>;
    expect(users.map((u) => u.id)).toEqual(expect.arrayContaining(['uAdmin', 'uMember', 'uMember2']));
    expect(users.every((u) => u.status === 'active')).toBe(true);
  });
});

describe('API writes', () => {
  it('posts messages as the token owner through the normal pipeline', async () => {
    const { token } = await newToken(MEMBER);
    const r = await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: 'Build passed <@uAdmin>' });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ authorId: 'uMember', text: 'Build passed <@uAdmin>', mentions: ['uAdmin'] });
    const id = r.body.message.id as string;
    expect(get(`channels/cGeneral`)).toMatchObject({ lastMessage: { text: 'Build passed @Ada Admin', authorId: 'uMember' } });
    // Notifications run like any message: the mentioned admin gets an Activity item.
    await expect.poll(() => get(`users/uAdmin/activity/${id}`), { timeout: 10_000 }).toMatchObject({ kind: 'mention' });
  });

  it('replies in threads (optionally also to the channel)', async () => {
    const { token } = await newToken(MEMBER2);
    const before = get<{ replyCount: number }>('channels/cEngineering/messages/eng1')!.replyCount;
    const r = await api(token, 'POST', '/v1/channels/cEngineering/messages', { text: 'on it', threadId: 'eng1', alsoToChannel: true });
    expect(r.status).toBe(201);
    expect(r.body.message).toMatchObject({ threadId: 'eng1', alsoToChannel: true });
    expect(get<{ replyCount: number }>('channels/cEngineering/messages/eng1')!.replyCount).toBe(before + 1);
  });

  it('refuses channels I am not in, archived channels and missing threads', async () => {
    const { token } = await newToken(MEMBER);
    expect((await api(token, 'POST', '/v1/channels/cSecret/messages', { text: 'hi' })).status).toBe(404);
    set('channels/cRandom', { archived: true });
    expect((await api(token, 'POST', '/v1/channels/cRandom/messages', { text: 'hi' })).status).toBe(409);
    expect((await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: 'hi', threadId: 'nope' })).status).toBe(409);
    expect((await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: '' })).status).toBe(400);
  });

  it('posts once per Idempotency-Key', async () => {
    const { token } = await newToken(MEMBER);
    const a = await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: 'deploy #42 done' }, { 'Idempotency-Key': 'deploy-42' });
    const b = await api(token, 'POST', '/v1/channels/cGeneral/messages', { text: 'deploy #42 done' }, { 'Idempotency-Key': 'deploy-42' });
    expect([a.status, b.status]).toEqual([201, 200]);
    expect(b.body.message.id).toBe(a.body.message.id);
  });

  it('opens a DM (created once) and posts to it', async () => {
    const { token } = await newToken(MEMBER);
    const a = await api(token, 'POST', '/v1/dms', { userIds: ['uAdmin'] });
    expect(a.status).toBe(201);
    expect(a.body.channel).toMatchObject({ id: 'dm_uAdmin_uMember', type: 'dm', memberIds: ['uAdmin', 'uMember'] });
    expect(get<{ typingKey: string }>('channels/dm_uAdmin_uMember')!.typingKey).toMatch(/^t_[A-Za-z0-9]{24}$/);
    expect((await api(token, 'POST', '/v1/dms', { userIds: ['uAdmin'] })).status).toBe(200);
    expect((await api(token, 'POST', '/v1/dms', { userIds: ['uGone'] })).status).toBe(400);
    expect((await api(token, 'POST', '/v1/channels/dm_uAdmin_uMember/messages', { text: 'hello from a script' })).status).toBe(201);
  });
});

describe('API search', () => {
  it('finds messages in my channels only', async () => {
    const { token } = await newToken(MEMBER2);
    const r = await api(token, 'GET', '/v1/search?q=upload');
    expect(r.status).toBe(200);
    expect(r.body.results.map((x: { messageId: string }) => x.messageId)).toEqual(expect.arrayContaining(['eng0']));
    expect((await api(token, 'GET', '/v1/search?q=')).status).toBe(400);
  });
});
