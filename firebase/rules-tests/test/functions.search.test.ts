// searchmessages callable + the search index maintained by the message triggers.
import { beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';
const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });

async function fetchRetry(url: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch {
    await new Promise((r) => setTimeout(r, 200));
    return fetch(url, init);
  }
}

const tokens = new Map<string, string>();
async function token(email: string) {
  if (!tokens.has(email)) {
    const r = await fetchRetry(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
    });
    tokens.set(email, ((await r.json()) as { idToken: string }).idToken);
  }
  return tokens.get(email)!;
}

type Result = { messageId: string; channelId: string; snippet: string; authorId: string; hasFile: boolean };
async function search(email: string | null, data: Record<string, unknown>) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) headers.Authorization = `Bearer ${await token(email)}`;
  const r = await fetchRetry(`${FN}/searchmessages`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return (await r.json()) as { result?: { results: Result[]; nextBefore: number | null }; error?: { status: string } };
}
const ids = async (email: string, data: Record<string, unknown>) => ((await search(email, data)).result?.results ?? []).map((r) => r.messageId);

const msg = (text: string, authorId: string, extra: Record<string, unknown> = {}) =>
  JSON.stringify({ text, authorId, createdAt: { __ts: Date.now() }, threadParentId: null, attachments: [], mentions: [], replyCount: 0, replyUserIds: [], ...extra });

async function until(check: () => Promise<boolean>, ms = 20_000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('timed out waiting for the search index');
}

const ADMIN = 'admin@flack.test';
const MEMBER2 = 'member2@flack.test';

beforeAll(async () => {
  cli('seed', JSON.stringify({ demo: true }));
  // Written through the Admin SDK → real triggers index them (not flagged as seed data).
  cli('set', 'channels/cSecret/messages/s1', msg('Quarterly budget is confidential', 'uAdmin'));
  cli('set', 'channels/cEngineering/messages/x1', msg('Reunión mañana sobre el despliegue', 'uMember2'));
  cli('set', 'channels/cEngineering/messages/x2', msg('see attached', 'uAdmin', { attachments: [{ name: 'Budget_Q3.xlsx', size: 1, contentType: 'x', storagePath: 'p' }] }));
  await until(async () => (await ids(ADMIN, { q: 'confidential' })).length === 1 && (await ids(ADMIN, { q: 'xlsx' })).length === 1);
}, 60_000);

describe('searchmessages', () => {
  it('finds seeded and new messages by word, prefix and without accents', async () => {
    expect(await ids(MEMBER2, { q: 'upload' })).toEqual(expect.arrayContaining(['eng0']));
    expect(await ids(MEMBER2, { q: 'stor' })).toEqual(expect.arrayContaining(['eng0', 'eng1']));
    expect(await ids(MEMBER2, { q: 'reunion manana' })).toEqual(['x1']);
    expect(await ids(MEMBER2, { q: 'DESPLIEGUE' })).toEqual(['x1']);
  });

  it('requires every word to match', async () => {
    expect(await ids(MEMBER2, { q: 'upload storage' })).toEqual(['eng0']);
    expect(await ids(MEMBER2, { q: 'upload pizza' })).toEqual([]);
  });

  it('never returns messages from channels you are not in', async () => {
    expect(await ids(ADMIN, { q: 'budget' })).toEqual(expect.arrayContaining(['s1']));
    expect(await ids(MEMBER2, { q: 'budget' })).toEqual(['x2']); // file name only, not the private channel
    expect((await search(MEMBER2, { q: 'budget', channelId: 'cSecret' })).error?.status).toBe('PERMISSION_DENIED');
  });

  it('filters by person, channel and "has a file"', async () => {
    expect(await ids(MEMBER2, { q: 'budget', hasFile: true })).toEqual(['x2']);
    // Unset filters may arrive as null from callables; they must not filter anything out.
    expect(await ids(MEMBER2, { q: 'upload', hasFile: null, authorId: null, channelId: null, after: null })).toEqual(expect.arrayContaining(['eng0']));
    expect(await ids(ADMIN, { q: 'budget', hasFile: true })).toEqual(['x2']);
    expect(await ids(MEMBER2, { q: 'stor', authorId: 'uMember' })).toEqual(['eng0']);
    expect(await ids(ADMIN, { q: 'budget', channelId: 'cSecret' })).toEqual(['s1']);
  });

  it('rejects signed-out callers and empty queries', async () => {
    expect((await search(null, { q: 'upload' })).error?.status).toBe('UNAUTHENTICATED');
    expect((await search(MEMBER2, { q: 'de la' })).error?.status).toBe('INVALID_ARGUMENT');
  });

  it('keeps the index in sync with edits and deletes', async () => {
    cli('set', 'channels/cEngineering/messages/x1', JSON.stringify({ text: 'Retro moved to Friday' }));
    await until(async () => (await ids(MEMBER2, { q: 'friday' })).includes('x1'));
    expect(await ids(MEMBER2, { q: 'despliegue' })).toEqual([]);

    cli('set', 'channels/cEngineering/messages/x1', JSON.stringify({ deleted: true, text: '' }));
    await until(async () => !(await ids(MEMBER2, { q: 'friday' })).includes('x1'));
  }, 60_000);
});
