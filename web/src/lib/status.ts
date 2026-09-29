import type { CustomStatus, UserProfile } from '../data/types';

/** The user's status if it's set and not expired. */
export function activeStatus(user: Pick<UserProfile, 'customStatus'> | undefined, now = Date.now()): CustomStatus | null {
  const s = user?.customStatus;
  if (!s || (!s.emoji && !s.text)) return null;
  if (s.expiresAt && s.expiresAt.toMillis() <= now) return null;
  return s;
}

export type ClearAfter = 'never' | '30m' | '1h' | '4h' | 'today' | 'week';

export const CLEAR_OPTIONS: { value: ClearAfter; label: string }[] = [
  { value: 'never', label: "Don't clear" },
  { value: '30m', label: '30 minutes' },
  { value: '1h', label: '1 hour' },
  { value: '4h', label: '4 hours' },
  { value: 'today', label: 'Today' },
  { value: 'week', label: 'This week' },
];

/** When a status set now should expire (ms), or null for never. "This week" ends Sunday night. */
export function expiryFor(option: ClearAfter, now = Date.now()): number | null {
  const d = new Date(now);
  switch (option) {
    case 'never':
      return null;
    case '30m':
      return now + 30 * 60_000;
    case '1h':
      return now + 3_600_000;
    case '4h':
      return now + 4 * 3_600_000;
    case 'today':
      return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime();
    case 'week': {
      const daysToSunday = (7 - d.getDay()) % 7;
      return new Date(d.getFullYear(), d.getMonth(), d.getDate() + daysToSunday, 23, 59, 59, 999).getTime();
    }
  }
}

export const STATUS_PRESETS: { emoji: string; text: string; clear: ClearAfter }[] = [
  { emoji: '📅', text: 'In a meeting', clear: '1h' },
  { emoji: '🚌', text: 'Commuting', clear: '30m' },
  { emoji: '🎧', text: 'Focusing', clear: '4h' },
  { emoji: '🤒', text: 'Out sick', clear: 'today' },
  { emoji: '🌴', text: 'On vacation', clear: 'never' },
  { emoji: '🏡', text: 'Working remotely', clear: 'today' },
];

/** "Until 3:30 PM", "Until tomorrow", "Until Sep 30" for the status line. */
export function untilLabel(expiresAt: number | null, now = Date.now()): string {
  if (!expiresAt) return '';
  const d = new Date(expiresAt);
  const n = new Date(now);
  const sameDay = d.toDateString() === n.toDateString();
  if (sameDay) return d.getHours() === 23 && d.getMinutes() === 59 ? 'Until end of today' : `Until ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
  const tomorrow = new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1);
  if (d.toDateString() === tomorrow.toDateString()) return 'Until tomorrow';
  return `Until ${d.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })}`;
}
