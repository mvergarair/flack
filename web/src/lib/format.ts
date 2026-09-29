/** Pure text transforms for the composer's markdown toolbar. */

export interface Edit {
  text: string;
  selStart: number;
  selEnd: number;
}

/** Wraps the selection with `before`/`after`; with no selection inserts a placeholder. */
export function wrap(e: Edit, before: string, after = before, placeholder = 'text'): Edit {
  const sel = e.text.slice(e.selStart, e.selEnd);
  // Toggle off when the selection is already wrapped.
  if (e.text.slice(e.selStart - before.length, e.selStart) === before && e.text.slice(e.selEnd, e.selEnd + after.length) === after) {
    const text = e.text.slice(0, e.selStart - before.length) + sel + e.text.slice(e.selEnd + after.length);
    return { text, selStart: e.selStart - before.length, selEnd: e.selEnd - before.length };
  }
  const inner = sel || placeholder;
  const text = e.text.slice(0, e.selStart) + before + inner + after + e.text.slice(e.selEnd);
  const start = e.selStart + before.length;
  return { text, selStart: start, selEnd: start + inner.length };
}

/** Prefixes every selected line (or the current line) with `prefix`, e.g. "- ". */
export function prefixLines(e: Edit, prefix: string | ((i: number) => string)): Edit {
  const lineStart = e.text.lastIndexOf('\n', e.selStart - 1) + 1;
  const nl = e.text.indexOf('\n', e.selEnd);
  const lineEnd = nl === -1 ? e.text.length : nl;
  const lines = e.text.slice(lineStart, lineEnd).split('\n');
  const p = (i: number) => (typeof prefix === 'string' ? prefix : prefix(i));
  const allPrefixed = lines.every((l, i) => l.startsWith(p(i)));
  const next = lines.map((l, i) => (allPrefixed ? l.slice(p(i).length) : p(i) + l)).join('\n');
  const text = e.text.slice(0, lineStart) + next + e.text.slice(lineEnd);
  return { text, selStart: lineStart, selEnd: lineStart + next.length };
}

export function codeBlock(e: Edit): Edit {
  const sel = e.text.slice(e.selStart, e.selEnd);
  const needsLeadingNl = e.selStart > 0 && e.text[e.selStart - 1] !== '\n';
  const before = (needsLeadingNl ? '\n' : '') + '```\n';
  const after = '\n```\n';
  const inner = sel || 'code';
  const text = e.text.slice(0, e.selStart) + before + inner + after + e.text.slice(e.selEnd);
  const start = e.selStart + before.length;
  return { text, selStart: start, selEnd: start + inner.length };
}

export function link(e: Edit, url = 'https://'): Edit {
  const sel = e.text.slice(e.selStart, e.selEnd);
  if (/^https?:\/\/\S+$/.test(sel)) {
    const text = e.text.slice(0, e.selStart) + `[link](${sel})` + e.text.slice(e.selEnd);
    return { text, selStart: e.selStart + 1, selEnd: e.selStart + 5 };
  }
  const label = sel || 'link text';
  const insert = `[${label}](${url})`;
  const text = e.text.slice(0, e.selStart) + insert + e.text.slice(e.selEnd);
  const urlStart = e.selStart + label.length + 3;
  return { text, selStart: urlStart, selEnd: urlStart + url.length };
}

/** The "@query" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { start: number; query: string } | null {
  const upto = text.slice(0, caret);
  const m = /(^|[\s(])@([\p{L}\p{N}._-]{0,30}(?: [\p{L}\p{N}._-]{0,30})?)$/u.exec(upto);
  if (!m) return null;
  return { start: caret - m[2].length - 1, query: m[2] };
}
