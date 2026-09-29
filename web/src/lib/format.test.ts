import { describe, expect, it } from 'vitest';
import { codeBlock, link, mentionQuery, prefixLines, wrap } from './format';
import { dmId, normalizeChannelName, isValidChannelName } from './channels';
import { safeFileName, validateFile } from './files';
import { isCompact } from './grouping';
import type { Message } from '../data/types';
import { Timestamp } from 'firebase/firestore';

const sel = (text: string, a: number, b = a) => ({ text, selStart: a, selEnd: b });

describe('composer formatting', () => {
  it('wraps a selection and toggles it back off', () => {
    const on = wrap(sel('make bold', 5, 9), '**');
    expect(on).toEqual({ text: 'make **bold**', selStart: 7, selEnd: 11 });
    expect(wrap(on, '**')).toEqual({ text: 'make bold', selStart: 5, selEnd: 9 });
  });

  it('inserts a selected placeholder when nothing is selected', () => {
    expect(wrap(sel('', 0), '_')).toEqual({ text: '_text_', selStart: 1, selEnd: 5 });
  });

  it('prefixes and un-prefixes list lines', () => {
    const r = prefixLines(sel('a\nb', 0, 3), '- ');
    expect(r.text).toBe('- a\n- b');
    expect(prefixLines(r, '- ').text).toBe('a\nb');
    expect(prefixLines(sel('a\nb', 0, 3), (i) => `${i + 1}. `).text).toBe('1. a\n2. b');
  });

  it('makes code blocks on their own lines', () => {
    expect(codeBlock(sel('see x', 4, 5)).text).toBe('see \n```\nx\n```\n');
  });

  it('builds links around selections or pasted URLs', () => {
    expect(link(sel('docs', 0, 4)).text).toBe('[docs](https://)');
    expect(link(sel('https://x.co', 0, 12)).text).toBe('[link](https://x.co)');
  });

  it('detects an @mention being typed', () => {
    expect(mentionQuery('hi @an', 6)).toEqual({ start: 3, query: 'an' });
    expect(mentionQuery('hi @Ana Ma', 10)).toEqual({ start: 3, query: 'Ana Ma' });
    expect(mentionQuery('mail a@b', 8)).toBeNull();
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
  });
});

describe('channels', () => {
  it('builds deterministic DM ids', () => {
    expect(dmId(['b', 'a', 'b'])).toBe('dm_a_b');
  });

  it('normalizes channel names', () => {
    expect(normalizeChannelName('  #My Cool Room! ')).toBe('my-cool-room');
    expect(isValidChannelName('ok-name_1')).toBe(true);
    expect(isValidChannelName('-bad')).toBe(false);
  });
});

describe('attachments', () => {
  const file = (name: string, size: number) => new File([new Uint8Array(Math.min(size, 10))], name, {}) as File & { size: number };

  it('rejects oversized, empty and executable files', () => {
    const big = file('a.bin', 1);
    Object.defineProperty(big, 'size', { value: 51 * 1024 * 1024 });
    expect(validateFile(big)).toMatch(/50 MB/);
    expect(validateFile(new File([], 'empty.txt'))).toMatch(/empty/);
    expect(validateFile(file('setup.EXE', 10))).toMatch(/executable/);
    expect(validateFile(file('notes.pdf', 10))).toBeNull();
  });

  it('makes storage-safe file names', () => {
    expect(safeFileName('a/b\\c?.png')).toBe('a_b_c_.png');
    expect(safeFileName('..hidden')).toBe('_hidden');
    expect(safeFileName('x'.repeat(300) + '.pdf')).toHaveLength(150);
    expect(safeFileName('x'.repeat(300) + '.pdf').endsWith('.pdf')).toBe(true);
  });
});

describe('message grouping', () => {
  const m = (authorId: string, ms: number): Message => ({
    id: `${authorId}${ms}`,
    text: '',
    authorId,
    createdAt: Timestamp.fromMillis(ms),
    threadParentId: null,
    attachments: [],
    mentions: [],
    replyCount: 0,
    replyUserIds: [],
  });

  it('groups same-author messages within 5 minutes', () => {
    const base = new Date(2026, 0, 1, 12).getTime();
    expect(isCompact(m('a', base), m('a', base + 60_000))).toBe(true);
    expect(isCompact(m('a', base), m('a', base + 6 * 60_000))).toBe(false);
    expect(isCompact(m('a', base), m('b', base + 1000))).toBe(false);
    expect(isCompact(undefined, m('a', base))).toBe(false);
  });
});
