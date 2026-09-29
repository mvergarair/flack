import type { UserProfile } from '../data/types';
import styles from './Avatar.module.css';

const PALETTE = ['#9A4A24', '#2E6A4F', '#5B4A9E', '#1F5FC4', '#7A5C1E', '#8B3A62', '#2F6B7A', '#6B5B3A'];

export function colorFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

interface Props {
  user: UserProfile | undefined;
  size?: number;
  online?: boolean | 'away' | null; // null/undefined = no presence dot
  ring?: string; // border color of the presence dot (matches the background)
}

export function Avatar({ user, size = 36, online, ring = 'var(--surface)' }: Props) {
  const name = user?.displayName ?? '?';
  const radius = Math.round(size * 0.22);
  const dot = Math.max(8, Math.round(size * 0.32));
  return (
    <span
      className={styles.avatar}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        background: user?.photoURL ? 'var(--surface-3)' : colorFor(user?.id ?? name),
        fontSize: Math.round(size * 0.38),
        opacity: user?.status === 'deactivated' ? 0.55 : 1,
      }}
      aria-hidden="true"
    >
      {user?.photoURL ? (
        <img src={user.photoURL} alt="" referrerPolicy="no-referrer" style={{ borderRadius: radius }} />
      ) : (
        initials(name)
      )}
      {online != null && (
        <span
          className={styles.dot}
          data-online={online === 'away' ? 'away' : online}
          aria-label={online === 'away' ? 'Away' : undefined}
          style={{ width: dot, height: dot, borderColor: ring, background: online === 'away' ? 'var(--away)' : online ? 'var(--online)' : ring }}
        />
      )}
    </span>
  );
}
