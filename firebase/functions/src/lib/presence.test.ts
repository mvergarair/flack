import { describe, expect, it } from 'vitest';
import { aggregatePresence, withViewing } from './presence.js';

describe('aggregatePresence', () => {
  it('active on any device wins, then away, then offline', () => {
    expect(
      aggregatePresence({
        phone: { state: 'away', lastChanged: 100 },
        laptop: { state: 'online', lastChanged: 50, activeChannel: 'c1' },
      }),
    ).toEqual({ state: 'online', lastChanged: 100, activeChannels: ['c1'], activeChannel: 'c1' });
    expect(aggregatePresence({ a: { state: 'offline', lastChanged: 10 }, b: { state: 'away', lastChanged: 5 } })?.state).toBe('away');
  });

  it('offline everywhere reports the latest change', () => {
    expect(aggregatePresence({ a: { state: 'offline', lastChanged: 10 }, b: { state: 'offline', lastChanged: 30 } })).toMatchObject({
      state: 'offline',
      lastChanged: 30,
      activeChannels: [],
    });
  });

  it('only active devices count for "looking at this channel"', () => {
    const p = aggregatePresence({ phone: { state: 'away', lastChanged: 1, activeChannel: 'c2' }, laptop: { state: 'online', lastChanged: 1, activeChannel: 'c1' } });
    expect(p?.activeChannels).toEqual(['c1']);
  });

  it('understands the legacy single-entry shape and ignores junk', () => {
    expect(aggregatePresence({ state: 'online', lastChanged: 5, activeChannel: 'x' })?.state).toBe('online');
    expect(aggregatePresence({ weird: 'value', n: 3 })).toBeUndefined();
    expect(aggregatePresence(null)).toBeUndefined();
  });

  it('takes the channel on screen from the private viewing/ node', () => {
    const status = { laptop: { state: 'online', lastChanged: 1 }, phone: { state: 'online', lastChanged: 1 } };
    expect(aggregatePresence(withViewing(status, { laptop: 'c9' }))?.activeChannels).toEqual(['c9']);
    expect(aggregatePresence(withViewing(status, null))?.activeChannels).toEqual([]);
  });
});
