import type { Timestamp } from 'firebase/firestore';

type TS = Timestamp | null | undefined;

const toDate = (t: TS | Date): Date | null => (t instanceof Date ? t : t ? t.toDate() : null);

export function formatTime(t: TS | Date): string {
  const d = toDate(t);
  return d ? d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '';
}

/** "9:58", "Yesterday", "Mon", "Mar 3" — for list rows. */
export function formatShortTime(t: TS, now = Date.now()): string {
  const d = toDate(t);
  if (!d) return '';
  const today = new Date(now);
  if (sameDay(d, today)) return formatTime(d);
  const y = new Date(now - 86_400_000);
  if (sameDay(d, y)) return 'Yesterday';
  if (now - d.getTime() < 6 * 86_400_000) return d.toLocaleDateString([], { weekday: 'short' });
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

/** Day divider label: "Today", "Yesterday", "Monday, March 3". */
export function formatDay(d: Date, now = Date.now()): string {
  const today = new Date(now);
  if (sameDay(d, today)) return 'Today';
  if (sameDay(d, new Date(now - 86_400_000))) return 'Yesterday';
  return d.toLocaleDateString([], {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' } : {}),
  });
}

export function formatRelative(t: TS, now = Date.now()): string {
  const d = toDate(t);
  if (!d) return '';
  const s = Math.round((now - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hr ago`;
  return formatShortTime(t, now);
}

export function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/** Presence line: "Active now", "Last online 5 min ago", "Last online Mar 3", or "" if unknown. */
export function lastOnlineLabel(p: { state: 'online' | 'away' | 'offline'; lastChanged: number } | undefined, now = Date.now()): string {
  if (!p) return '';
  if (p.state === 'online') return 'Active now';
  if (p.state === 'away') return 'Away';
  const s = Math.max(0, Math.round((now - p.lastChanged) / 1000));
  if (s < 60) return 'Last online just now';
  const m = Math.round(s / 60);
  if (m < 60) return `Last online ${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `Last online ${h} hr ago`;
  const d = new Date(p.lastChanged);
  if (Math.round(h / 24) === 1) return 'Last online yesterday';
  return `Last online ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`;
}
