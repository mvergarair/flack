import { lookup } from 'node:dns/promises';
import { logger } from 'firebase-functions/v2';
import { isPrivateAddress, parseOg, type LinkPreview } from './og.js';

const TIMEOUT_MS = 4000;
const MAX_BYTES = 512 * 1024;
const MAX_REDIRECTS = 3;

async function assertPublicHost(url: URL, allowLocal: boolean) {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('bad protocol');
  if (allowLocal) return;
  if (url.port && url.port !== '80' && url.port !== '443') throw new Error('non-standard port');
  const addrs = await lookup(url.hostname, { all: true });
  if (addrs.length === 0 || addrs.some((a) => isPrivateAddress(a.address))) throw new Error('private address');
}

async function readCapped(res: Response): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    total += value.length;
    if (total >= MAX_BYTES) {
      await reader.cancel();
      break;
    }
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * Fetches one URL's preview. Guards against SSRF: only http(s) on standard ports, every hop's
 * host must resolve to public addresses (re-checked on each redirect), 4 s timeout, 512 KB cap.
 * `allowLocal` is only set in the emulator (tests serve pages from localhost).
 */
export async function fetchPreview(rawUrl: string, allowLocal = false): Promise<LinkPreview | null> {
  let url = new URL(rawUrl);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url, allowLocal);
      const res = await fetch(url, {
        redirect: 'manual',
        signal: ctl.signal,
        headers: { 'User-Agent': 'FlackBot/1.0 (+link previews)', Accept: 'text/html,application/xhtml+xml,image/*;q=0.8' },
      });
      if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
        url = new URL(res.headers.get('location')!, url);
        continue;
      }
      if (!res.ok) return null;
      const type = res.headers.get('content-type') ?? '';
      if (type.startsWith('image/')) {
        return { url: rawUrl, title: '', description: '', image: url.href, siteName: url.hostname.replace(/^www\./, '') };
      }
      if (!type.includes('html')) return null;
      const meta = parseOg(await readCapped(res), url.href);
      if (!meta.title && !meta.description && !meta.image) return null;
      return { url: rawUrl, ...meta };
    }
    return null;
  } catch (err) {
    logger.info('Link preview skipped', { url: rawUrl, reason: String(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
