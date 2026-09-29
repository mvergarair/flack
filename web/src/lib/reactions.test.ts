import { describe, expect, it } from 'vitest';
import { hasReacted, reactorNames, summarizeReactions } from './reactions';
import { lastOnlineLabel } from './time';

describe('reactions', () => {
  it('summarizes per-person reactions into chips, most used first', () => {
    const chips = summarizeReactions({ a: ['👍', '🎉'], b: ['🎉'], c: ['🎉', '👀'] });
    expect(chips).toEqual([
      { emoji: '🎉', uids: ['a', 'b', 'c'] },
      { emoji: '👍', uids: ['a'] },
      { emoji: '👀', uids: ['c'] },
    ]);
    expect(summarizeReactions(undefined)).toEqual([]);
    expect(summarizeReactions({ a: [] })).toEqual([]);
  });

  it('knows whether I reacted', () => {
    expect(hasReacted({ me: ['👍'] }, 'me', '👍')).toBe(true);
    expect(hasReacted({ me: ['👍'] }, 'me', '🎉')).toBe(false);
    expect(hasReacted(undefined, 'me', '👍')).toBe(false);
  });

  it('names reactors for tooltips', () => {
    const name = (u: string) => u.toUpperCase();
    expect(reactorNames(['me'], name, 'me')).toBe('You');
    expect(reactorNames(['a', 'me'], name, 'me')).toBe('A and You');
    expect(reactorNames(['a', 'b', 'c', 'd', 'e'], name, 'me')).toBe('A, B and 3 others');
  });
});

describe('lastOnlineLabel', () => {
  const now = new Date(2026, 8, 25, 12, 0).getTime();
  it('describes presence', () => {
    expect(lastOnlineLabel(undefined, now)).toBe('');
    expect(lastOnlineLabel({ state: 'online', lastChanged: now - 1e7 }, now)).toBe('Active now');
    expect(lastOnlineLabel({ state: 'away', lastChanged: now - 1e7 }, now)).toBe('Away');
    expect(lastOnlineLabel({ state: 'offline', lastChanged: now - 20_000 }, now)).toBe('Last online just now');
    expect(lastOnlineLabel({ state: 'offline', lastChanged: now - 5 * 60_000 }, now)).toBe('Last online 5 min ago');
    expect(lastOnlineLabel({ state: 'offline', lastChanged: now - 3 * 3_600_000 }, now)).toBe('Last online 3 hr ago');
    expect(lastOnlineLabel({ state: 'offline', lastChanged: now - 30 * 3_600_000 }, now)).toBe('Last online yesterday');
    expect(lastOnlineLabel({ state: 'offline', lastChanged: now - 10 * 86_400_000 }, now)).toMatch(/^Last online Sep 15$/);
  });
});
