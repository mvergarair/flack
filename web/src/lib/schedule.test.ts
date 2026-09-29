import { describe, expect, it } from 'vitest';
import { activeCommand, ceilSlot, daySlots, formatWhen, fromDateAndSlot, messagePresets, parseRemind, parseSchedule, parseWhen, reminderPresets, slashMatches, SLOT_MS, validSlot } from './schedule';

// Wednesday 2026-10-07 14:33:20 local time.
const NOW = new Date(2026, 9, 7, 14, 33, 20).getTime();
const local = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();

describe('slots', () => {
  it('rounds up to the next 10-minute slot, strictly after now', () => {
    expect(ceilSlot(NOW)).toBe(local(7, 14, 40));
    expect(ceilSlot(local(7, 14, 40))).toBe(local(7, 14, 40));
    expect(ceilSlot(local(7, 14, 40), local(7, 14, 40))).toBe(local(7, 14, 50));
  });

  it('offers only slots, all in the future', () => {
    for (const p of [...reminderPresets(NOW), ...messagePresets(NOW)]) {
      expect(p.at % SLOT_MS).toBe(0);
      expect(p.at).toBeGreaterThan(NOW);
    }
    expect(reminderPresets(NOW).map((p) => p.at)).toEqual([local(7, 15, 0), local(7, 15, 40), local(7, 17, 40), local(8, 9), local(12, 9)]);
    expect(daySlots()).toHaveLength(144);
    expect(daySlots()[1]).toBe('00:10');
  });

  it('builds a slot from the custom date + time picker', () => {
    expect(fromDateAndSlot('2026-10-09', '16:20')).toBe(local(9, 16, 20));
    expect(fromDateAndSlot('nope', '16:20')).toBeNull();
  });

  it('validates slot, future and horizon', () => {
    expect(validSlot(local(7, 15), NOW)).toBe(true);
    expect(validSlot(local(7, 15, 5), NOW)).toBe(false);
    expect(validSlot(local(7, 14, 30), NOW)).toBe(false);
    expect(validSlot(NOW + 400 * 86_400_000, NOW)).toBe(false);
  });

  it('formats relative days', () => {
    expect(formatWhen(local(7, 15), NOW)).toMatch(/^Today at 3:00/);
    expect(formatWhen(local(8, 9), NOW)).toMatch(/^Tomorrow at 9:00/);
    expect(formatWhen(local(12, 9), NOW)).toMatch(/Mon.*Oct 12.* at 9:00/);
  });
});

describe('parseWhen', () => {
  const at = (s: string) => parseWhen(s, NOW)?.at;
  it('understands relative times, rounded up to a slot', () => {
    expect(at('in 1h')).toBe(local(7, 15, 40));
    expect(at('in 20 min')).toBe(local(7, 15, 0));
    expect(at('in an hour')).toBe(local(7, 15, 40));
    expect(at('in 2 days')).toBe(ceilSlot(NOW + 2 * 86_400_000));
  });
  it('understands days and clock times', () => {
    expect(at('tomorrow')).toBe(local(8, 9));
    expect(at('tomorrow at 9am')).toBe(local(8, 9));
    expect(at('tomorrow 3:30pm')).toBe(local(8, 15, 30));
    expect(at('friday 15:00')).toBe(local(9, 15));
    expect(at('wed')).toBe(local(14, 9)); // next Wednesday, never today
    expect(at('next monday')).toBe(local(12, 9));
    expect(at('at 5pm')).toBe(local(7, 17));
    expect(at('at 9')).toBe(local(8, 9)); // 9:00 already passed today
    expect(at('today at noon')).toBeUndefined(); // in the past
    expect(at('tonight 8')).toBe(local(7, 20));
    expect(at('at 3:07pm')).toBe(local(7, 15, 10));
  });
  it('rejects nonsense', () => {
    expect(at('at 25:00')).toBeUndefined();
    expect(at('at 13pm')).toBeUndefined();
    expect(at('soonish')).toBeUndefined();
  });
});

describe('parseRemind', () => {
  const p = (s: string) => parseRemind(s, NOW);
  it('ignores other text', () => {
    expect(p('hello')).toBeNull();
    expect(p('/reminder')).toBeNull();
  });
  it('parses <when> then <what>', () => {
    expect(p('/remind me in 1h to call Ana')).toEqual({ ok: true, at: local(7, 15, 40), text: 'call Ana' });
    expect(p('/remind tomorrow at 9am check the deploy')).toEqual({ ok: true, at: local(8, 9), text: 'check the deploy' });
  });
  it('parses <what> then <when>', () => {
    expect(p('/remind me to call Ana in 1h')).toEqual({ ok: true, at: local(7, 15, 40), text: 'call Ana' });
    expect(p('/remind me to review the PR in the morning tomorrow')).toEqual({ ok: true, at: local(8, 9), text: 'review the PR in the morning' });
  });
  it('explains what went wrong', () => {
    expect(p('/remind')).toMatchObject({ ok: false });
    expect(p('/remind me in 1h')).toMatchObject({ ok: false, error: expect.stringMatching(/What should I remind you about/) });
    expect(p('/remind me to call Ana sometime')).toMatchObject({ ok: false, error: expect.stringMatching(/couldn't tell when/) });
  });
});

describe('parseSchedule and the / menu', () => {
  it('parses <when> <message>', () => {
    expect(parseSchedule('/schedule tomorrow 9am Standup notes', NOW)).toEqual({ ok: true, at: local(8, 9), text: 'Standup notes' });
    expect(parseSchedule('/schedule in 2h Deploy is done\nsecond line', NOW)).toEqual({ ok: true, at: ceilSlot(NOW + 7_200_000), text: 'Deploy is done\nsecond line' });
    expect(parseSchedule('hello', NOW)).toBeNull();
  });
  it('hands back the message when the time is missing', () => {
    expect(parseSchedule('/schedule Standup notes', NOW)).toMatchObject({ ok: false, text: 'Standup notes' });
    expect(parseSchedule('/schedule tomorrow', NOW)).toMatchObject({ ok: false, error: expect.stringMatching(/What should the message say/) });
    expect(parseSchedule('/schedule', NOW)).toMatchObject({ ok: false });
  });
  it('offers commands only while typing a command name', () => {
    expect(slashMatches('/').map((c) => c.name)).toEqual(['remind', 'schedule']);
    expect(slashMatches('/sch').map((c) => c.name)).toEqual(['schedule']);
    expect(slashMatches('/x')).toEqual([]);
    expect(slashMatches('/remind ')).toEqual([]);
    expect(slashMatches('a /')).toEqual([]);
    expect(activeCommand('/schedule tom')?.name).toBe('schedule');
    expect(activeCommand('/schedule')).toBeNull();
  });
});
