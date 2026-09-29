/** Splits text into segments, marking words that start with any query word (accent/case-insensitive). */
export function highlight(text: string, queryWords: string[]): { text: string; hit: boolean }[] {
  const norm = (s: string) => s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
  const qs = queryWords.map(norm).filter(Boolean);
  if (!qs.length) return [{ text, hit: false }];
  const parts = text.split(/([\p{L}\p{N}]+)/u);
  const out: { text: string; hit: boolean }[] = [];
  for (const p of parts) {
    if (!p) continue;
    const hit = /[\p{L}\p{N}]/u.test(p) && qs.some((q) => norm(p).startsWith(q));
    const last = out[out.length - 1];
    if (last && last.hit === hit) last.text += p;
    else out.push({ text: p, hit });
  }
  return out;
}

/** The words a user typed, for highlighting. */
export const queryWords = (q: string) => q.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 2);
