import { describe, expect, it } from 'vitest';
import { isDndActive, minutesInZone } from './dnd.js';

const at = (iso: string) => Date.parse(iso);
const ts = (ms: number) => ({ toMillis: () => ms });

describe('Do Not Disturb', () => {
  it('pauses until a time', () => {
    const now = at('2026-09-26T12:00:00Z');
    expect(isDndActive({ until: ts(now + 60_000) }, 'UTC', now)).toBe(true);
    expect(isDndActive({ until: ts(now - 60_000) }, 'UTC', now)).toBe(false);
    expect(isDndActive(null, 'UTC', now)).toBe(false);
  });

  it('applies an overnight schedule in the user time zone', () => {
    const night = { schedule: { enabled: true, start: '22:00', end: '08:00' } };
    // 23:30 in Santiago (UTC-3 in late September 2026)
    expect(isDndActive(night, 'America/Santiago', at('2026-09-27T02:30:00Z'))).toBe(true);
    // 07:59 Santiago
    expect(isDndActive(night, 'America/Santiago', at('2026-09-27T10:59:00Z'))).toBe(true);
    // 08:00 Santiago → off
    expect(isDndActive(night, 'America/Santiago', at('2026-09-27T11:00:00Z'))).toBe(false);
    // 23:00 UTC is 20:00 in Santiago: on for a UTC user, off for a Santiago user.
    expect(isDndActive(night, 'UTC', at('2026-09-26T23:00:00Z'))).toBe(true);
    expect(isDndActive(night, 'America/Santiago', at('2026-09-26T23:00:00Z'))).toBe(false);
  });

  it('handles same-day windows, disabled schedules and bad zones', () => {
    const lunch = { schedule: { enabled: true, start: '12:00', end: '13:00' } };
    expect(isDndActive(lunch, 'UTC', at('2026-09-26T12:30:00Z'))).toBe(true);
    expect(isDndActive(lunch, 'UTC', at('2026-09-26T13:00:00Z'))).toBe(false);
    expect(isDndActive({ schedule: { ...lunch.schedule, enabled: false } }, 'UTC', at('2026-09-26T12:30:00Z'))).toBe(false);
    expect(minutesInZone(at('2026-09-26T12:30:00Z'), 'Not/AZone')).toBe(12 * 60 + 30);
  });
});
