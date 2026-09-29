import { describe, expect, it } from 'vitest';
import { MAX_TERMS, buildTerms, normalize, queryTerms, snippet, words } from './terms.js';

describe('search terms', () => {
  it('normalizes case and accents', () => {
    expect(normalize('Reunión ÑANDÚ')).toBe('reunion nandu');
    expect(words('Deploy: v2.1 — ¡Mañana a las 9!')).toEqual(['deploy', 'v2', 'manana', 'las']);
  });

  it('indexes whole words and 3–10 char prefixes, dropping filler words', () => {
    const t = buildTerms('The deployment is ready');
    expect(t).toEqual(expect.arrayContaining(['deployment', 'ready', 'dep', 'depl', 'deploymen', 'rea']));
    expect(t).not.toContain('the');
    expect(t).not.toContain('is');
    expect(t).not.toContain('de'); // prefixes start at 3 chars
  });

  it('includes attachment names and their extensions', () => {
    expect(buildTerms('see file', ['Budget_Q3.xlsx'])).toEqual(expect.arrayContaining(['budget', 'q3', 'xlsx']));
  });

  it('ignores mention tokens but keeps @channel words', () => {
    const t = buildTerms('<@uAbc123> <!channel> standup');
    expect(t).not.toContain('uabc123');
    expect(t).toEqual(expect.arrayContaining(['channel', 'standup']));
  });

  it('caps very long messages', () => {
    const long = Array.from({ length: 6000 }, (_, i) => `word${i}x`).join(' ');
    const t = buildTerms(long);
    expect(t.length).toBe(MAX_TERMS);
    expect(t.slice(0, 10)).toEqual(Array.from({ length: 10 }, (_, i) => `word${i}x`)); // whole words first
  });

  it('builds query lookups (AND of words, long words truncated to prefix length)', () => {
    expect(queryTerms('Deploy on Friday')).toEqual({ lookup: ['deploy', 'friday'], words: ['deploy', 'friday'] });
    expect(queryTerms('internationalization')).toEqual({ lookup: ['internatio'], words: ['internationalization'] });
    expect(queryTerms('de la')).toEqual({ lookup: [], words: [] });
    expect(queryTerms('  ')).toEqual({ lookup: [], words: [] });
  });

  it('makes plain snippets', () => {
    expect(snippet('**Ship** <@u1> `x` [docs](https://d.co)', new Map([['u1', 'Ana']]))).toBe('Ship @Ana x docs');
  });
});
