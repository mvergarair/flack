import { describe, expect, it } from 'vitest';
import { extractMentions } from './post.js';

describe('extractMentions', () => {
  it('finds people and broadcasts once each', () => {
    expect(extractMentions('hi <@u1> and <@u2>, <@u1> again <!here>')).toEqual(['u1', 'u2', '!here']);
    expect(extractMentions('<!channel> deploy')).toEqual(['!channel']);
    expect(extractMentions('plain @name text')).toEqual([]);
  });
});
