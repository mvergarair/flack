import { describe, expect, it } from 'vitest';
import { highlight, queryWords } from './highlight';

describe('highlight', () => {
  it('marks words starting with a query word, ignoring accents and case', () => {
    expect(highlight('La Reunión de deploy', ['reunion', 'depl'])).toEqual([
      { text: 'La ', hit: false },
      { text: 'Reunión', hit: true },
      { text: ' de ', hit: false },
      { text: 'deploy', hit: true },
    ]);
  });
  it('returns the whole text when there is nothing to mark', () => {
    expect(highlight('hello', [])).toEqual([{ text: 'hello', hit: false }]);
    expect(queryWords('  deploy, v2 a ')).toEqual(['deploy', 'v2']);
  });
});
