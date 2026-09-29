import { NavLink } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { isUnread } from '../lib/unread';
import { useActivity, useUnseenActivity } from '../data/activity';
import { BellIcon, ChatIcon, HomeIcon, ShieldIcon } from './icons';
import styles from './MobileNav.module.css';

export function MobileNav() {
  const me = useMe();
  const { channels, reads, manualReads } = useWorkspace();
  const unseen = useUnseenActivity(useActivity());
  const dmUnread = channels.some((c) => c.type === 'dm' && isUnread(c, reads, me.id, manualReads));
  const cls = ({ isActive }: { isActive: boolean }) => `${styles.tab} ${isActive ? styles.active : ''}`;
  return (
    <nav aria-label="Main" className={styles.nav} data-cols={me.role === 'admin' ? 4 : 3}>
      <NavLink to="/" end className={cls}>
        <HomeIcon size={22} />
        Home
      </NavLink>
      <NavLink to="/dms" className={cls}>
        <span className={styles.iconWrap}>
          <ChatIcon size={22} />
          {dmUnread && <span className={styles.dot} aria-label="Unread messages" />}
        </span>
        DMs
      </NavLink>
      <NavLink to="/activity" className={cls}>
        <span className={styles.iconWrap}>
          <BellIcon size={22} />
          {unseen > 0 && <span className={styles.dot} aria-label="New activity" />}
        </span>
        Activity
      </NavLink>
      {me.role === 'admin' && (
        <NavLink to="/admin" className={cls}>
          <ShieldIcon size={22} />
          Admin
        </NavLink>
      )}
    </nav>
  );
}
