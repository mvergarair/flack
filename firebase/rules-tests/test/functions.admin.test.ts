// Callable admin functions, exercised against the Functions + Auth + Firestore emulators
// (project demo-flack, seeded with scripts/emu-cli.ts).
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const AUTH = 'http://127.0.0.1:9399';
const FN = 'http://127.0.0.1:5301/demo-flack/us-central1';

const cli = (...args: string[]) =>
  execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const getDoc = <T>(path: string): T => JSON.parse(cli('get', path));

async function token(email: string) {
  const r = await fetchRetry(`${AUTH}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123', returnSecureToken: true }),
  });
  const b = (await r.json()) as { idToken?: string; error?: { message: string } };
  if (!b.idToken) throw new Error(b.error?.message);
  return b.idToken;
}

function claims(idToken: string) {
  return JSON.parse(Buffer.from(idToken.split('.')[1], 'base64url').toString()) as { role?: string; active?: boolean };
}

async function call(email: string | null, name: string, data: unknown) {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (email) headers.Authorization = `Bearer ${await token(email)}`;
  const r = await fetchRetry(`${FN}/${name}`, { method: 'POST', headers, body: JSON.stringify({ data }) });
  return (await r.json()) as { result?: Record<string, unknown>; error?: { status: string; message: string } };
}

const ADMIN = 'admin@flack.test';
const MEMBER = 'member@flack.test';

beforeEach(() => {
  cli('seed', '{}');
});

describe('admin callables', () => {
  it('reject signed-out callers and members', async () => {
    for (const [name, data] of [
      ['createinvite', { email: 'a@b.co', role: 'member' }],
      ['revokeinvite', { inviteId: 'seedInvite' }],
      ['setrole', { uid: 'uMember', role: 'admin' }],
      ['deactivateuser', { uid: 'uMember2' }],
      ['reactivateuser', { uid: 'uGone' }],
    ] as const) {
      expect((await call(null, name, data)).error?.status, `${name} signed out`).toBe('UNAUTHENTICATED');
      expect((await call(MEMBER, name, data)).error?.status, `${name} as member`).toBe('PERMISSION_DENIED');
    }
    expect(getDoc<{ role: string }>('users/uMember').role).toBe('member');
    expect(getDoc<{ status: string }>('invites/seedInvite').status).toBe('pending');
  }, 60_000);

  it('createinvite validates input and refreshes an existing pending invite', async () => {
    expect((await call(ADMIN, 'createinvite', { email: 'not-an-email', role: 'member' })).error?.status).toBe('INVALID_ARGUMENT');
    expect((await call(ADMIN, 'createinvite', { email: 'x@y.co', role: 'owner' })).error?.status).toBe('INVALID_ARGUMENT');
    expect((await call(ADMIN, 'createinvite', { email: MEMBER, role: 'member' })).error?.status).toBe('ALREADY_EXISTS');
    expect((await call(ADMIN, 'createinvite', { email: 'gone@flack.test', role: 'member' })).error?.message).toMatch(/Reactivate/);

    const again = await call(ADMIN, 'createinvite', { email: 'INVITEE@flack.test', role: 'admin' });
    expect(again.result).toMatchObject({ id: 'seedInvite', refreshed: true, token: 'seed-invite-token-0001' });
    expect(getDoc<{ role: string }>('invites/seedInvite').role).toBe('admin');

    const fresh = await call(ADMIN, 'createinvite', { email: 'new@flack.test', role: 'member' });
    expect(fresh.result?.token).toMatch(/^[\w-]{24}$/);
  });

  it('lookupinvite is public and reveals only the invite summary', async () => {
    const ok = await call(null, 'lookupinvite', { token: 'seed-invite-token-0001' });
    expect(ok.result).toMatchObject({ status: 'pending', email: 'invitee@flack.test', role: 'member', invitedByName: 'Ada Admin' });
    expect(Object.keys(ok.result!).sort()).toEqual(['email', 'expiresAt', 'invitedByName', 'role', 'status']);
    expect((await call(null, 'lookupinvite', { token: 'nope' })).result).toEqual({ status: 'invalid' });
  });

  it('setrole updates the doc and the custom claim', async () => {
    await call(ADMIN, 'setrole', { uid: 'uMember', role: 'admin' });
    expect(getDoc<{ role: string }>('users/uMember').role).toBe('admin');
    expect(claims(await token(MEMBER)).role).toBe('admin');
  });

  it('the last active admin cannot be demoted', async () => {
    const res = await call(ADMIN, 'setrole', { uid: 'uAdmin', role: 'member' });
    expect(res.error?.status).toBe('FAILED_PRECONDITION');
    expect(getDoc<{ role: string }>('users/uAdmin').role).toBe('admin');

    // With a second admin, demoting yourself is fine.
    await call(ADMIN, 'setrole', { uid: 'uMember', role: 'admin' });
    expect((await call(ADMIN, 'setrole', { uid: 'uAdmin', role: 'member' })).result).toEqual({ ok: true });
  });

  it('admins cannot deactivate themselves', async () => {
    expect((await call(ADMIN, 'deactivateuser', { uid: 'uAdmin' })).error?.status).toBe('FAILED_PRECONDITION');
  });

  it('deactivateuser disables the account and flips the active claim; reactivate restores it', async () => {
    expect((await call(ADMIN, 'deactivateuser', { uid: 'uMember' })).result).toEqual({ ok: true });
    expect(getDoc<{ status: string }>('users/uMember').status).toBe('deactivated');
    await expect(token(MEMBER)).rejects.toThrow(/USER_DISABLED/);

    expect((await call(ADMIN, 'reactivateuser', { uid: 'uMember' })).result).toEqual({ ok: true });
    const c = claims(await token(MEMBER));
    expect(c).toMatchObject({ active: true, role: 'member' });
  });

  it('revokeinvite only works on pending invites', async () => {
    expect((await call(ADMIN, 'revokeinvite', { inviteId: 'seedInvite' })).result).toEqual({ ok: true });
    expect((await call(ADMIN, 'revokeinvite', { inviteId: 'seedInvite' })).error?.status).toBe('FAILED_PRECONDITION');
    expect((await call(ADMIN, 'revokeinvite', { inviteId: 'missing' })).error?.status).toBe('NOT_FOUND');
  });
});

/** fetch that retries once when a pooled keep-alive socket was already closed by the emulator. */
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
