import { execFileSync } from 'node:child_process';
import { deflateSync } from 'node:zlib';
import { fileURLToPath } from 'node:url';
import { expect, type Page, type Browser } from '@playwright/test';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
export const PASSWORD = 'password123';

function cli(...args: string[]): string {
  return execFileSync(`${ROOT}/node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], {
    cwd: ROOT,
    encoding: 'utf8',
  });
}

export const emu = {
  seed: (opts: { bootstrapped?: boolean; historyCount?: number; demo?: boolean } = {}) => cli('seed', JSON.stringify(opts)),
  reset: () => cli('reset'),
  set: (path: string, data: unknown) => cli('set', path, JSON.stringify(data)),
  get: <T = Record<string, unknown>>(path: string): T | null => JSON.parse(cli('get', path)),
  query: <T = Record<string, unknown>>(collection: string): T[] => JSON.parse(cli('query', collection)),
  /** Fires the 10-minute scheduled-items sweep now (backdate: make every pending item due). */
  runScheduled: (opts: { backdate?: boolean } = {}) => cli('run-scheduled', JSON.stringify(opts)),
};

export const users = {
  admin: 'admin@flack.test',
  member: 'member@flack.test',
  member2: 'member2@flack.test',
  deactivated: 'gone@flack.test',
  invitee: 'invitee@flack.test',
  outsider: 'outsider@flack.test',
};

/** Opens the app with an in-memory Firestore cache (isolated per context). */
export async function open(page: Page, path = '/') {
  const sep = path.includes('?') ? '&' : '?';
  await page.goto(`${path}${sep}memcache`);
}

export async function signIn(page: Page, email: string, path = '/') {
  await open(page, `/login?next=${encodeURIComponent(path)}`);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByTestId('app-shell')).toBeVisible();
}

/** A second, independent signed-in user (own browser context). */
export async function asUser(browser: Browser, email: string, path = '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await context.newPage();
  await signIn(page, email, path);
  return { context, page };
}

/** Signs in against the Auth emulator over REST and returns an ID token. */
export async function idToken(email: string): Promise<string> {
  const res = await fetchRetry('http://127.0.0.1:9399/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const body = (await res.json()) as { idToken?: string; error?: { message: string } };
  if (!body.idToken) throw new Error(`sign-in failed for ${email}: ${body.error?.message}`);
  return body.idToken;
}

/** Calls a callable function as `email`; returns {status, body}. */
export async function callFunction(email: string, name: string, data: unknown) {
  const token = await idToken(email);
  const res = await fetchRetry(`http://127.0.0.1:5301/demo-flack/us-central1/${name}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ data }),
  });
  return { status: res.status, body: (await res.json()) as { result?: unknown; error?: { status: string; message: string } } };
}

/** Lists objects in the Storage emulator bucket under a prefix. */
export async function storageList(prefix: string): Promise<string[]> {
  const res = await fetchRetry(`http://127.0.0.1:9398/v0/b/demo-flack.appspot.com/o?prefix=${encodeURIComponent(prefix)}`, {
    headers: { Authorization: 'Bearer owner' },
  });
  const body = (await res.json()) as { items?: { name: string }[] };
  return (body.items ?? []).map((i) => i.name);
}

// A valid 40x30 solid-blue PNG, for upload tests.
export const PNG = makePng(40, 30, [31, 95, 196]);

function makePng(w: number, h: number, [r, g, b]: number[]): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const c = Buffer.alloc(4);
    c.writeUInt32BE(crc(td));
    return Buffer.concat([len, td, c]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // RGB
  const row = Buffer.concat([Buffer.from([0]), Buffer.from(Array.from({ length: w }, () => [r, g, b]).flat())]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

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
