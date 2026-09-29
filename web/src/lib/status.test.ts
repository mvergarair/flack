import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { activeStatus, expiryFor, untilLabel } from './status';

const now = new Date(2026, 8, 25, 14, 0).getTime(); // Friday 2pm

describe('custom status', () => {
  it('is active until it expires', () => {
    const s = (ms: number | null) => ({ customStatus: { emoji: '📅', text: 'Meeting', expiresAt: ms == null ? null : Timestamp.fromMillis(ms) } });
    expect(activeStatus(s(null), now)?.text).toBe('Meeting');
    expect(activeStatus(s(now + 1000), now)?.text).toBe('Meeting');
    expect(activeStatus(s(now - 1000), now)).toBeNull();
    expect(activeStatus({ customStatus: null }, now)).toBeNull();
    expect(activeStatus({ customStatus: { emoji: '', text: '', expiresAt: null } }, now)).toBeNull();
    expect(activeStatus(undefined, now)).toBeNull();
  });

  it('computes "clear after" times', () => {
    expect(expiryFor('never', now)).toBeNull();
    expect(expiryFor('30m', now)).toBe(now + 30 * 60_000);
    expect(new Date(expiryFor('today', now)!).getHours()).toBe(23);
    const week = new Date(expiryFor('week', now)!);
    expect(week.getDay()).toBe(0); // Sunday
    expect(week.getDate()).toBe(27);
  });

  it('describes when it clears', () => {
    expect(untilLabel(null, now)).toBe('');
    expect(untilLabel(expiryFor('today', now), now)).toBe('Until end of today');
    expect(untilLabel(new Date(2026, 8, 26, 9, 0).getTime(), now)).toBe('Until tomorrow');
    expect(untilLabel(now + 3_600_000, now)).toMatch(/^Until 3:00/);
  });
});
