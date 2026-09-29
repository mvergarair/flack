/**
 * Search terms for the message index (pure; also imported by scripts/seed-lib.ts and the
 * backfill script). Terms are lowercase, accent-free words (2–30 chars) plus word
 * beginnings (3–10 chars) for prefix matching, minus common Spanish/English filler words,
 * capped per message to stay far below Firestore's per-document index limits.
 */

export const MAX_TERMS = 1500;
const MIN_WORD = 2;
const MAX_WORD = 30;
const MIN_PREFIX = 3;
const MAX_PREFIX = 10;

// Very common words that make poor search terms.
const STOPWORDS = new Set(
  (
    'the a an and or but of to in on at for with is are was were be been it its this that these those i you he she we they me my your our ' +
    'de la el los las un una unos unas y o u que en por para con sin del al lo le les se su sus es son fue era ser mi tu te nos ya no si ' +
    'como pero mas muy hay este esta esto ese esa eso'
  ).split(' '),
);

/** Lowercase, strip accents/diacritics (NFD + remove marks). */
export function normalize(s: string): string {
  return s.normalize('NFD').replace(/\p{M}+/gu, '').toLowerCase();
}

/** Words in text: mention/broadcast tokens and markdown syntax removed, split on non-letters/digits. */
export function words(text: string): string[] {
  const cleaned = normalize(
    text
      .replace(/<@[A-Za-z0-9]+>/g, ' ')
      .replace(/<!(channel|here)>/g, ' $1 ')
      .replace(/\]\((https?:\/\/[^)]+)\)/g, '] $1'),
  );
  return cleaned.split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= MIN_WORD && w.length <= MAX_WORD);
}

/** Index terms for a message (text + attachment file names). */
export function buildTerms(text: string, fileNames: string[] = []): string[] {
  const all = [...words(text), ...fileNames.flatMap((n) => words(n.replace(/\.[^.]+$/, (ext) => ` ${ext.slice(1)}`)))];
  const out = new Set<string>();
  for (const w of all) {
    if (STOPWORDS.has(w)) continue;
    out.add(w);
    if (out.size >= MAX_TERMS) break;
  }
  // Word beginnings after all whole words, so whole words win the cap.
  for (const w of [...out]) {
    for (let n = MIN_PREFIX; n <= Math.min(MAX_PREFIX, w.length - 1); n++) {
      if (out.size >= MAX_TERMS) return [...out];
      out.add(w.slice(0, n));
    }
  }
  return [...out];
}

/**
 * Terms to look up for a query. Each word must match (AND). Words longer than the stored
 * prefix length are truncated to it for the lookup and re-checked on the full word.
 */
export function queryTerms(q: string): { lookup: string[]; words: string[] } {
  const ws = [...new Set(words(q))].filter((w) => w.length >= MIN_PREFIX || !STOPWORDS.has(w));
  const meaningful = ws.filter((w) => !STOPWORDS.has(w));
  const use = meaningful.length ? meaningful : ws;
  return { lookup: use.map((w) => (w.length > MAX_PREFIX ? w.slice(0, MAX_PREFIX) : w)), words: use };
}

/** Plain one-line snippet for search results. */
export function snippet(text: string, names: Map<string, string>, max = 200): string {
  const t = text
    .replace(/<@([A-Za-z0-9]+)>/g, (_, uid: string) => `@${names.get(uid) ?? 'someone'}`)
    .replace(/<!(channel|here)>/g, '@$1')
    .replace(/```[\s\S]*?```/g, (m) => m.replace(/```\w*/g, ' '))
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
