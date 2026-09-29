// Scheduled messages and reminders go out on a 10-minute clock (:00, :10, :20 …): the
// server checks for due items once every 10 minutes, so every time offered here is a slot.

export const SLOT_MS = 10 * 60_000;
/** How far ahead something can be scheduled (the rules allow 366 days). */
export const MAX_AHEAD_MS = 365 * 86_400_000;

/** The first slot at or after `ms` (strictly after `now` when given). */
export function ceilSlot(ms: number, now?: number): number {
  let slot = Math.ceil(ms / SLOT_MS) * SLOT_MS;
  if (now != null && slot <= now) slot += SLOT_MS;
  return slot;
}

/** A local wall-clock time on the day `daysAhead` from `now`. */
function atLocal(now: number, daysAhead: number, hour: number, minute = 0): number {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAhead);
  d.setHours(hour, minute, 0, 0);
  return d.getTime();
}

export interface Preset {
  label: string;
  at: number;
}

/** Quick choices for "remind me" / snooze (relative ones round up to the next slot). */
export function reminderPresets(now = Date.now()): Preset[] {
  return [
    { label: 'In 20 minutes', at: ceilSlot(now + 20 * 60_000, now) },
    { label: 'In 1 hour', at: ceilSlot(now + 60 * 60_000, now) },
    { label: 'In 3 hours', at: ceilSlot(now + 3 * 60 * 60_000, now) },
    { label: 'Tomorrow', at: ceilSlot(atLocal(now, 1, 9), now) },
    { label: 'Next Monday', at: ceilSlot(atLocal(now, daysUntil(now, 1), 9), now) },
  ];
}

/** Quick choices for scheduling a message. */
export function messagePresets(now = Date.now()): Preset[] {
  return [
    { label: 'Tomorrow', at: ceilSlot(atLocal(now, 1, 9), now) },
    { label: 'Next Monday', at: ceilSlot(atLocal(now, daysUntil(now, 1), 9), now) },
  ];
}

/** Days from `now` to the next `weekday` (0 = Sunday), 1–7 (never today). */
function daysUntil(now: number, weekday: number): number {
  const diff = (weekday - new Date(now).getDay() + 7) % 7;
  return diff === 0 ? 7 : diff;
}

/** The 144 slot times of a day, as "HH:MM" (for the custom time picker). */
export function daySlots(): string[] {
  const out: string[] = [];
  for (let m = 0; m < 24 * 60; m += 10) out.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return out;
}

/** "YYYY-MM-DD" + "HH:MM" in local time → epoch ms (null if invalid). */
export function fromDateAndSlot(date: string, slot: string): number | null {
  const d = date.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const t = slot.match(/^(\d{2}):(\d{2})$/);
  if (!d || !t) return null;
  const ms = new Date(Number(d[1]), Number(d[2]) - 1, Number(d[3]), Number(t[1]), Number(t[2])).getTime();
  return Number.isNaN(ms) ? null : ceilSlot(ms);
}

export function toDateInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function toSlotInput(ms: number): string {
  const d = new Date(ceilSlot(ms));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Whether `at` can be scheduled: a slot, in the future, within a year. */
export function validSlot(at: number, now = Date.now()): boolean {
  return at % SLOT_MS === 0 && at > now && at - now <= MAX_AHEAD_MS;
}

/** "Today at 3:40 PM", "Tomorrow at 9:00 AM", "Mon, Oct 6 at 9:00 AM". */
export function formatWhen(at: number, now = Date.now()): string {
  const time = new Date(at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  const day = Math.round((startOfDay(at) - startOfDay(now)) / 86_400_000);
  if (day === 0) return `Today at ${time}`;
  if (day === 1) return `Tomorrow at ${time}`;
  const date = new Date(at).toLocaleDateString([], {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    ...(new Date(at).getFullYear() !== new Date(now).getFullYear() ? { year: 'numeric' } : {}),
  });
  return `${date} at ${time}`;
}

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

// ---------------------------------------------------------------------------------------------
// "/remind me in 1h to call Ana"
// ---------------------------------------------------------------------------------------------

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const UNITS: Record<string, number> = { m: 1, min: 1, mins: 1, minute: 1, minutes: 1, h: 60, hr: 60, hrs: 60, hour: 60, hours: 60, d: 1440, day: 1440, days: 1440, w: 10080, week: 10080, weeks: 10080 };

const TIME = String.raw`(?:(noon|midnight)|(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)`;
const DAY = String.raw`(today|tonight|tomorrow|tmrw|(?:next\s+)?(?:${WEEKDAYS.join('|')}|${WEEKDAYS.map((w) => w.slice(0, 3)).join('|')}))`;
const WHEN_PATTERNS: RegExp[] = [
  // in 20 min / in 1h / in 2 days / in an hour
  new RegExp(String.raw`^in\s+(an?|\d+(?:\.\d+)?)\s*(${Object.keys(UNITS).join('|')})\b`, 'i'),
  // tomorrow at 9am / friday 3pm / next monday / today at noon
  new RegExp(String.raw`^${DAY}(?:\s+(?:at\s+)?${TIME})?(?=\s|$)`, 'i'),
  // at 3pm / at 15:30 (today, or tomorrow if that time has passed)
  new RegExp(String.raw`^at\s+${TIME}(?=\s|$)`, 'i'),
];

function hourMinute(word: string | undefined, h: string | undefined, m: string | undefined, ampm: string | undefined): [number, number] | null {
  if (word) return word.toLowerCase() === 'noon' ? [12, 0] : [0, 0];
  if (h == null) return null;
  let hour = Number(h);
  const minute = m ? Number(m) : 0;
  if (minute > 59) return null;
  if (ampm) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (ampm.toLowerCase() === 'pm' ? 12 : 0);
  } else if (hour > 23) return null;
  return [hour, minute];
}

/** Parses a time phrase at the start of `s`. Returns the time (a slot) and the phrase length. */
export function parseWhen(s: string, now = Date.now()): { at: number; length: number } | null {
  const str = s.trimStart();
  const lead = s.length - str.length;
  for (const [i, re] of WHEN_PATTERNS.entries()) {
    const m = str.match(re);
    if (!m) continue;
    let at: number | null = null;
    if (i === 0) {
      const n = /^an?$/i.test(m[1]) ? 1 : Number(m[1]);
      at = now + n * UNITS[m[2].toLowerCase()] * 60_000;
    } else if (i === 1) {
      const dayWord = m[1].toLowerCase().replace(/^next\s+/, '');
      const hm = hourMinute(m[2], m[3], m[4], m[5]);
      let days: number;
      if (dayWord === 'today' || dayWord === 'tonight') days = 0;
      else if (dayWord === 'tomorrow' || dayWord === 'tmrw') days = 1;
      else days = daysUntil(now, WEEKDAYS.findIndex((w) => w.startsWith(dayWord)));
      const [hour, minute] = hm ?? (dayWord === 'tonight' ? [20, 0] : [9, 0]);
      // "tonight 8" means 8 PM; otherwise hours are taken as written (24h unless am/pm).
      at = atLocal(now, days, dayWord === 'tonight' && hm && !m[5] && hour < 12 ? hour + 12 : hour, minute);
    } else {
      const hm = hourMinute(m[1], m[2], m[3], m[4]);
      if (!hm) return null;
      at = atLocal(now, 0, hm[0], hm[1]);
      if (at <= now) at = atLocal(now, 1, hm[0], hm[1]);
    }
    if (at == null || Number.isNaN(at) || at <= now) return null;
    return { at: ceilSlot(at, now), length: lead + m[0].length };
  }
  return null;
}

export type RemindParse = { ok: true; at: number; text: string } | { ok: false; error: string };

export const REMIND_HELP = 'Try “/remind me in 1h to call Ana” or “/remind me tomorrow at 9am check the deploy”.';

/**
 * "/remind [me] <when> [to] <what>" or "/remind [me] [to] <what> <when>".
 * Returns null when the text isn't a /remind command at all.
 */
export function parseRemind(input: string, now = Date.now()): RemindParse | null {
  const m = input.trim().match(/^\/remind(?:\s+|$)([\s\S]*)$/i);
  if (!m) return null;
  let rest = m[1].trim().replace(/^me\b\s*/i, '');
  if (!rest) return { ok: false, error: REMIND_HELP };

  // <when> first.
  const first = parseWhen(rest, now);
  if (first) {
    const text = rest.slice(first.length).trim().replace(/^to\b\s*/i, '').trim();
    return text ? { ok: true, at: first.at, text: text.slice(0, 500) } : { ok: false, error: `What should I remind you about? ${REMIND_HELP}` };
  }

  // <what> first: find the earliest " in …" / " at …" / " tomorrow …" suffix that parses to the end.
  rest = rest.replace(/^to\b\s*/i, '');
  const words = [...rest.matchAll(/\s(?=\S)/g)].map((x) => x.index! + 1);
  for (const start of words) {
    const tail = rest.slice(start);
    const when = parseWhen(tail, now);
    if (when && tail.slice(when.length).trim() === '') {
      const text = rest.slice(0, start).trim();
      if (text) return { ok: true, at: when.at, text: text.slice(0, 500) };
    }
  }
  return { ok: false, error: `I couldn't tell when. ${REMIND_HELP}` };
}

// ---------------------------------------------------------------------------------------------
// "/schedule tomorrow 9am Standup notes are in the doc"
// ---------------------------------------------------------------------------------------------

export const SCHEDULE_HELP = 'Try “/schedule tomorrow 9am Standup notes are in the doc” or “/schedule in 2h Deploy is done”.';

export type ScheduleParse =
  | { ok: true; at: number; text: string }
  /** No time understood: `text` is the message, so the app can ask for a time instead. */
  | { ok: false; error: string; text?: string };

/** "/schedule <when> <message>". Returns null when the text isn't a /schedule command. */
export function parseSchedule(input: string, now = Date.now()): ScheduleParse | null {
  const m = input.trim().match(/^\/schedule(?:\s+|$)([\s\S]*)$/i);
  if (!m) return null;
  const rest = m[1].trim();
  if (!rest) return { ok: false, error: SCHEDULE_HELP };
  const when = parseWhen(rest, now);
  if (!when) return { ok: false, error: `When should it go out? ${SCHEDULE_HELP}`, text: rest };
  const text = rest.slice(when.length).trim();
  return text ? { ok: true, at: when.at, text } : { ok: false, error: `What should the message say? ${SCHEDULE_HELP}` };
}

// ---------------------------------------------------------------------------------------------
// The "/" command menu
// ---------------------------------------------------------------------------------------------

export interface SlashCommand {
  name: 'remind' | 'schedule';
  description: string;
  example: string;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  { name: 'remind', description: 'Set a reminder for yourself', example: '/remind me in 1h to call Ana' },
  { name: 'schedule', description: 'Schedule a message here', example: '/schedule tomorrow 9am Standup notes are in the doc' },
];

/** Commands to offer while the whole message is "/" plus a partial command name. */
export function slashMatches(text: string): SlashCommand[] {
  const m = text.match(/^\/([a-z]*)$/i);
  if (!m) return [];
  const q = m[1].toLowerCase();
  return SLASH_COMMANDS.filter((c) => c.name.startsWith(q));
}

/** The command being typed ("/remind …"), for showing its example as a hint. */
export function activeCommand(text: string): SlashCommand | null {
  const m = text.match(/^\/([a-z]+)\s/i);
  return (m && SLASH_COMMANDS.find((c) => c.name === m[1].toLowerCase())) || null;
}
