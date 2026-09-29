/** Pure helpers for link previews (unit-tested in og.test.ts). */

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

/** http(s) URLs in a message, ignoring code, deduped, at most `max`. */
export function extractUrls(text: string, max = 3): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  const found = withoutCode.match(/https?:\/\/[^\s<>"'`)\]]+/gi) ?? [];
  const out: string[] = [];
  for (const raw of found) {
    const url = raw.replace(/[.,!?;:*_~]+$/, '');
    try {
      const u = new URL(url);
      if ((u.protocol === 'http:' || u.protocol === 'https:') && !out.includes(u.href)) out.push(u.href);
    } catch {
      // not a URL
    }
    if (out.length >= max) break;
  }
  return out;
}

const decode = (s: string) =>
  s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&#x27;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();

/** Reads Open Graph / Twitter / <title> metadata from an HTML document. */
export function parseOg(html: string, pageUrl: string): Omit<LinkPreview, 'url'> {
  const head = html.slice(0, 200_000);
  const metas = [...head.matchAll(/<meta\s[^>]*>/gi)].map((m) => m[0]);
  const attr = (tag: string, name: string) => new RegExp(`${name}\\s*=\\s*(["'])(.*?)\\1`, 'i').exec(tag)?.[2];
  const meta = (...keys: string[]) => {
    for (const k of keys) {
      const tag = metas.find((t) => (attr(t, 'property') ?? attr(t, 'name'))?.toLowerCase() === k);
      const v = tag && attr(tag, 'content');
      if (v) return decode(v);
    }
    return '';
  };
  const title = meta('og:title', 'twitter:title') || decode(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1] ?? '');
  const description = meta('og:description', 'twitter:description', 'description');
  const rawImage = meta('og:image:secure_url', 'og:image', 'twitter:image');
  let image: string | null = null;
  if (rawImage) {
    try {
      const u = new URL(rawImage, pageUrl);
      if (u.protocol === 'https:' || u.protocol === 'http:') image = u.href;
    } catch {
      image = null;
    }
  }
  const siteName = meta('og:site_name') || new URL(pageUrl).hostname.replace(/^www\./, '');
  return { title: title.slice(0, 200), description: description.slice(0, 300), image, siteName: siteName.slice(0, 80) };
}

/** True for loopback, private, link-local, CGNAT and other non-public addresses (SSRF guard). */
export function isPrivateAddress(ip: string): boolean {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(v4);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return (
      a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224
    );
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
}
