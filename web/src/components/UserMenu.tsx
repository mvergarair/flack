import { useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { signOut } from '../auth/signin';
import { Avatar } from './Avatar';
import { ProfileDialog } from './ProfileDialog';
import { NotificationSettings } from './NotificationSettings';
import { StatusDialog } from './StatusDialog';
import { ApiTokensDialog } from './ApiTokensDialog';
import { StatusEmoji } from './StatusEmoji';
import { activeStatus } from '../lib/status';
import { setManualAway, useManualAway } from '../data/presence';
import { isDndActive } from '../lib/dnd';
import { useNow } from '../lib/hooks';
import { BellIcon, LogOutIcon, PencilIcon } from './icons';
import styles from './UserMenu.module.css';

export function UserMenu({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const me = useMe();
  const [open, setOpen] = useState(false);
  const [dialog, setDialog] = useState<'profile' | 'notifications' | 'status' | 'api' | null>(null);
  const status = activeStatus(me);
  const away = useManualAway();
  const now = useNow(60_000);
  const dnd = isDndActive(me.dnd, me.timeZone, now);

  return (
    <div className={`${styles.wrap} ${styles[variant]}`}>
      <button
        className={styles.me}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Account menu"
        data-testid="user-menu"
      >
        <Avatar user={me} size={variant === 'mobile' ? 34 : 32} />
        {variant === 'sidebar' && (
          <span className={styles.meText}>
            <span className={styles.meName}>{me.displayName}</span>
            <span className={styles.meSub}>
              {dnd && <span title="Notifications paused">🌙 </span>}
              {status ? <StatusEmoji user={me} withText /> : away ? 'Away' : me.role === 'admin' ? 'Admin' : 'Active'}
            </span>
          </span>
        )}
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <div role="menu" className={styles.menu}>
            <div className={styles.menuHead}>
              <strong>{me.displayName}</strong>
              <span>{me.email}</span>
            </div>
            <button role="menuitem" onClick={() => (setOpen(false), setDialog('status'))} data-testid="status-menuitem">
              <span className={styles.statusIcon}>{status?.emoji ?? '💬'}</span> {status ? `${status.text || 'Status'} · Edit` : 'Set a status'}
            </button>
            <button role="menuitem" onClick={() => (setOpen(false), setManualAway(!away))} data-testid="away-toggle">
              <span className={styles.awayDot} data-away={away} /> {away ? 'Set yourself active' : 'Set yourself away'}
            </button>
            <button role="menuitem" onClick={() => (setOpen(false), setDialog('profile'))}>
              <PencilIcon size={16} /> Edit profile
            </button>
            <button role="menuitem" onClick={() => (setOpen(false), setDialog('notifications'))} data-testid="dnd-menuitem">
              <BellIcon size={16} /> {dnd ? 'Notifications paused 🌙' : 'Pause notifications…'}
            </button>
            <button role="menuitem" onClick={() => (setOpen(false), setDialog('api'))}>
              API tokens
            </button>
            <button role="menuitem" onClick={() => void signOut()}>
              <LogOutIcon size={16} /> Sign out
            </button>
          </div>
        </>
      )}
      {dialog === 'profile' && <ProfileDialog onClose={() => setDialog(null)} />}
      {dialog === 'notifications' && <NotificationSettings onClose={() => setDialog(null)} />}
      {dialog === 'status' && <StatusDialog onClose={() => setDialog(null)} />}
      {dialog === 'api' && <ApiTokensDialog onClose={() => setDialog(null)} />}
    </div>
  );
}
