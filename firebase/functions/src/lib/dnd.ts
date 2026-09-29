// Do Not Disturb evaluation. Mirrored in web/src/lib/dnd.ts (display) — keep both in sync;
// both copies are unit-tested.

export interface DndSettings {
  until?: { toMillis(): number } | null;
  schedule?: { enabled: boolean; start: string; end: string } | null;
}

const toMinutes = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/** Minutes since local midnight in `timeZone` (falls back to UTC for unknown zones). */
export function minutesInZone(now: number, timeZone: string | undefined): number {
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }).formatToParts(new Date(now));
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = fmt(timeZone || 'UTC');
  } catch {
    parts = fmt('UTC');
  }
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return (get('hour') % 24) * 60 + get('minute');
}

/** True while notifications are paused ("until") or inside the nightly schedule. */
export function isDndActive(dnd: DndSettings | null | undefined, timeZone: string | undefined, now = Date.now()): boolean {
  if (!dnd) return false;
  if (dnd.until && dnd.until.toMillis() > now) return true;
  const s = dnd.schedule;
  if (!s?.enabled) return false;
  const a = toMinutes(s.start);
  const b = toMinutes(s.end);
  if (a === b) return false;
  const m = minutesInZone(now, timeZone);
  return a < b ? m >= a && m < b : m >= a || m < b; // overnight windows wrap midnight
}
