import { useMemo, useState } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot, notifyLevel } from '../data/workspace';
import { channelTitle, dmOthers, sortByRecent, sortChannels } from '../lib/channels';
import { isUnread } from '../lib/unread';
import { useMentionCounts } from '../data/unreadCounts';
import { useActivity, useUnseenActivity } from '../data/activity';
import { Avatar } from './Avatar';
import { UserMenu } from './UserMenu';
import { NotificationPrompt } from './NotificationPrompt';
import { StatusEmoji } from './StatusEmoji';
import { ChannelDialogs, type ChannelDialog } from './ChannelDialogs';
import { ComposeIcon, HashIcon, LockIcon, PlusIcon, ShieldIcon, BellIcon, BellOffIcon, BookmarkIcon, SearchIcon, SparkleIcon } from './icons';
import { useAiSettings } from '../data/ai';
import { useFlackbotPane } from '../app/flackbotPane';
import { useBranding } from '../data/branding';
import { BrandLogo } from './BrandLogo';
import styles from './Sidebar.module.css';

export function Sidebar() {
  const me = useMe();
  const ai = useAiSettings();
  const pane = useFlackbotPane();
  const { channels, users, reads, presence, prefs, manualReads } = useWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<ChannelDialog>(null);
  const counts = useMentionCounts();
  const unseenActivity = useUnseenActivity(useActivity());

  const { name, branding } = useBranding();
  const rooms = useMemo(() => sortChannels(channels.filter((c) => c.type !== 'dm' && !c.archived)), [channels]);
  const dms = useMemo(() => sortByRecent(channels.filter((c) => c.type === 'dm')), [channels]);

  return (
    <nav className={styles.sidebar} aria-label="Workspace">
      <div className={styles.head}>
        <span className={styles.workspace} data-testid="workspace-name">
          {branding.logo && <BrandLogo size={24} />}
          <span>{name}</span>
        </span>
        <button className={styles.headBtn} aria-label="New message" title="New message" onClick={() => setDialog({ kind: 'dm' })}>
          <ComposeIcon />
        </button>
      </div>

      <NotificationPrompt />

      <div className={styles.scroll}>
        <NavLink to="/activity" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
          <span className={styles.icon}>
            <BellIcon size={16} />
          </span>
          <span className={styles.label}>Activity</span>
          {unseenActivity > 0 && (
            <span className="badge" aria-label={`${unseenActivity} new`} data-testid="activity-badge">
              {unseenActivity}
            </span>
          )}
        </NavLink>
        <NavLink to="/search" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
          <span className={styles.icon}>
            <SearchIcon size={16} />
          </span>
          <span className={styles.label}>Search</span>
          <kbd className={styles.kbd} aria-hidden="true">
            {/Mac|iPhone|iPad/.test(navigator.platform) ? '⌘K' : 'Ctrl K'}
          </kbd>
        </NavLink>
        {(ai?.enabled || me.role === 'admin') && (
          <button className={`${styles.item} ${pane.open ? styles.active : ''}`} onClick={pane.toggle} aria-pressed={pane.open} data-testid="ask-flackbot">
            <span className={styles.icon}>
              <SparkleIcon size={16} />
            </span>
            <span className={styles.label}>Ask Flackbot</span>
          </button>
        )}
        <NavLink to="/later" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
          <span className={styles.icon}>
            <BookmarkIcon size={16} />
          </span>
          <span className={styles.label}>Later</span>
        </NavLink>
        {me.role === 'admin' && (
          <NavLink to="/admin" className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''}`}>
            <span className={styles.icon}>
              <ShieldIcon size={16} />
            </span>
            <span className={styles.label}>People &amp; invites</span>
          </NavLink>
        )}

        <h2 className={styles.section}>Channels</h2>
        <ul className={styles.list} data-testid="channel-list">
          {rooms.map((c) => {
            const muted = notifyLevel(c, prefs) === 'none';
            const unread = !muted && isUnread(c, reads, me.id, manualReads);
            const mentions = counts.get(c.id) ?? 0;
            return (
              <li key={c.id}>
                <NavLink
                  to={`/c/${c.id}`}
                  className={({ isActive }) => `${styles.item} ${isActive ? styles.active : ''} ${unread ? styles.unread : ''} ${muted ? styles.muted : ''}`}
                  data-unread={unread || undefined}
                  data-muted={muted || undefined}
                >
                  <span className={styles.icon}>{c.type === 'private' ? <LockIcon size={15} /> : <HashIcon size={16} />}</span>
                  <span className={styles.label}>{c.name}</span>
                  {muted && <BellOffIcon size={13} aria-label="Muted" />}
                  {mentions > 0 && (
                    <span className="badge" aria-label={`${mentions} mentions`}>
                      {mentions}
                    </span>
                  )}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button className={`${styles.item} ${styles.add}`} onClick={() => setDialog({ kind: 'create' })}>
              <span className={styles.icon}>
                <PlusIcon size={16} />
              </span>
              <span className={styles.label}>Add channel</span>
            </button>
          </li>
          <li>
            <button className={`${styles.item} ${styles.add}`} onClick={() => setDialog({ kind: 'browse' })}>
              <span className={styles.icon}>
                <HashIcon size={16} />
              </span>
              <span className={styles.label}>Browse channels</span>
            </button>
          </li>
        </ul>

        <h2 className={styles.section}>Direct messages</h2>
        <ul className={styles.list} data-testid="dm-list">
          {dms.map((c) => {
            const others = dmOthers(c, me.id);
            const first = users.get(others[0]);
            const muted = notifyLevel(c, prefs) === 'none';
            const unread = !muted && isUnread(c, reads, me.id, manualReads);
            const count = counts.get(c.id) ?? 0;
            return (
              <li key={c.id}>
                <NavLink
                  to={`/c/${c.id}`}
                  className={({ isActive }) => `${styles.item} ${styles.dm} ${isActive ? styles.active : ''} ${unread ? styles.unread : ''} ${muted ? styles.muted : ''}`}
                  data-unread={unread || undefined}
                  data-muted={muted || undefined}
                >
                  {others.length > 1 ? (
                    <span className={styles.groupCount}>{others.length}</span>
                  ) : (
                    <Avatar user={first} size={22} online={presenceDot(presence.get(others[0]))} ring="var(--side-bg)" />
                  )}
                  <span className={styles.label}>
                    {channelTitle(c, me.id, users)} {others.length === 1 && <StatusEmoji user={first} />}
                  </span>
                  {count > 0 && <span className="badge">{count}</span>}
                </NavLink>
              </li>
            );
          })}
          <li>
            <button className={`${styles.item} ${styles.add}`} onClick={() => setDialog({ kind: 'dm' })}>
              <span className={styles.icon}>
                <PlusIcon size={16} />
              </span>
              <span className={styles.label}>New message</span>
            </button>
          </li>
        </ul>
      </div>

      <UserMenu />
      <ChannelDialogs dialog={dialog} onClose={() => setDialog(null)} onDone={(id) => navigate(`/c/${id}`)} />
    </nav>
  );
}
