// dailystats (health snapshot + anonymous report) and recordvitals, against the emulators. A
// local HTTP server stands in for the maintainers' collector (TELEMETRY_URL in .env.demo-flack).
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';
const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const get = <T = Record<string, any>>(path: string) => JSON.parse(cli('get', path)) as T | null;
const set = (path: string, data: unknown) => cli('set', path, JSON.stringify(data));
// Async on purpose: the stand-in receiver lives in this process and must keep answering.
const runDaily = () => promisify(execFile)(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', 'run-daily'], { cwd: ROOT });

let received: unknown[] = [];
let server: Server;
beforeAll(async () => {
  server = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      received.push(JSON.parse(body));
      res.writeHead(204).end();
    });
  });
  await new Promise<void>((r) => server.listen(5397, '127.0.0.1', r));
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));
beforeEach(() => {
  received = [];
  cli('seed', JSON.stringify({ demo: true }));
});

async function vitals(email: string, lcp: unknown) {
  const t = await fetch(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const { idToken } = (await t.json()) as { idToken: string };
  const r = await fetch(`${FN}/recordvitals`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ data: { lcp } }),
  });
  return (await r.json()) as { result?: unknown; error?: { status: string } };
}

describe('daily stats', () => {
  it('records a snapshot for admins and sends an anonymous report', async () => {
    expect((await vitals('member@flack.test', 800)).result).toEqual({ ok: true });
    expect((await vitals('member@flack.test', 3000)).result).toEqual({ ok: true });
    expect((await vitals('member@flack.test', 'fast')).error?.status).toBe('INVALID_ARGUMENT');

    await runDaily();
    const date = new Date().toISOString().slice(0, 10);
    const snap = get(`stats/${date}`)!;
    expect(snap).toMatchObject({ date, members: { total: 3 }, customized: false, pageLoad: { lt1s: 1, lt4s: 1 } });
    expect(snap.channels).toBeGreaterThanOrEqual(4);

    expect(received).toHaveLength(1);
    const report = received[0] as Record<string, any>;
    const t = get('config/telemetry')!;
    expect(t.installId).toMatch(/^[0-9a-f-]{36}$/);
    expect(report).toEqual(t.lastReport);
    expect(report).toMatchObject({ schema: 1, installId: t.installId, date, region: 'us-central1', size: { members: '1-10' } });
    // Nothing from the workspace itself: no names, emails, channel names or message text.
    const text = JSON.stringify(report);
    for (const secret of ['Ada', 'Mia', 'Tomás', 'flack.test', 'engineering', 'general', 'upload', 'cGeneral', 'uAdmin']) expect(text).not.toContain(secret);
  }, 60_000);

  it('sends nothing once an admin turns it off (the snapshot is still kept)', async () => {
    set('config/telemetry', { installId: '00000000-0000-4000-8000-000000000000', enabled: false });
    await runDaily();
    expect(received).toHaveLength(0);
    expect(get('config/telemetry')).toMatchObject({ enabled: false, lastReport: null, disabledBy: 'admin' });
    expect(get(`stats/${new Date().toISOString().slice(0, 10)}`)).not.toBeNull();
  }, 60_000);

  it('keeps the same install id across days', async () => {
    await runDaily();
    await runDaily();
    const ids = (received as Array<{ installId: string }>).map((r) => r.installId);
    expect(new Set(ids).size).toBe(1);
  }, 60_000);
});
