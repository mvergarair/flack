import { useNow } from '../lib/hooks';
import { activeStatus } from '../lib/status';
import type { UserProfile } from '../data/types';

/** A user's status emoji (tooltip = text), or nothing. `withText` also shows the text. */
export function StatusEmoji({ user, withText = false, className }: { user: UserProfile | undefined; withText?: boolean; className?: string }) {
  const now = useNow(60_000);
  const s = activeStatus(user, now);
  if (!s) return null;
  return (
    <span className={className} title={s.text || undefined} data-testid="status-emoji" style={{ whiteSpace: 'nowrap' }}>
      {s.emoji}
      {withText && s.text ? ` ${s.text}` : ''}
    </span>
  );
}
