import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot, notifyLevel } from '../data/workspace';
import { useMentionCounts } from '../data/unreadCounts';
import { channelTitle, dmOthers, sortByRecent, sortChannels } from '../lib/channels';
import { isUnread } from '../lib/unread';
import { formatShortTime } from '../lib/time';
import { plainPreview } from '../lib/markdown';
import { Avatar } from '../components/Avatar';
import { UserMenu } from '../components/UserMenu';
import { NotificationPrompt } from '../components/NotificationPrompt';
import { StatusEmoji } from '../components/StatusEmoji';
import { ChannelDialogs, type ChannelDialog } from '../components/ChannelDialogs';
import { BookmarkIcon, ComposeIcon, HashIcon, LockIcon, PlusIcon, SearchIcon } from '../components/icons';
import { useBranding } from '../data/branding';
import styles from './MobileHome.module.css';

export function MobileHome() {
  const { name } = useBranding();
  const me = useMe();
  const { channels, reads, prefs, manualReads } = useWorkspace();
  const counts = useMentionCounts();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<ChannelDialog>(null);
  const rooms = useMemo(() => sortChannels(channels.filter((c) => c.type !== 'dm' && !c.archived)), [channels]);
  const dms = useMemo(() => sortByRecent(channels.filter((c) => c.type === 'dm')).slice(0, 6), [channels]);

  return (
    <div className={styles.page}>
      <MobileHeader title={name} />
      <NotificationPrompt variant="mobile" />
      <div className={styles.scroll}>
        <Link to="/search" className={`${styles.row} ${styles.muted}`}>
          <span className={styles.hash}>
            <SearchIcon size={17} />
          </span>
          Search
        </Link>
        <Link to="/later" className={`${styles.row} ${styles.muted}`}>
          <span className={styles.hash}>
            <BookmarkIcon size={17} />
          </span>
          Later
        </Link>
        <h2 className={styles.section}>Channels</h2>
        <ul className={styles.list} data-testid="channel-list">
          {rooms.map((c) => {
            const muted = notifyLevel(c, prefs) === 'none';
            const unread = !muted && isUnread(c, reads, me.id, manualReads);
            const n = counts.get(c.id) ?? 0;
            return (
              <li key={c.id}>
                <Link to={`/c/${c.id}`} className={`${styles.row} ${unread ? styles.unread : ''} ${muted ? styles.mutedRow : ''}`} data-unread={unread || undefined} data-muted={muted || undefined}>
                  <span className={styles.hash}>{c.type === 'private' ? <LockIcon size={17} /> : <HashIcon size={18} />}</span>
                  <span className={styles.grow}>{c.name}</span>
                  {n > 0 ? <span className="badge">{n}</span> : unread && <span className={styles.unreadDot} />}
                </Link>
              </li>
            );
          })}
          <li>
            <button className={`${styles.row} ${styles.muted}`} onClick={() => setDialog({ kind: 'browse' })}>
              <span className={styles.hash}>
                <HashIcon size={18} />
              </span>
              Browse channels
            </button>
          </li>
          <li>
            <button className={`${styles.row} ${styles.muted}`} onClick={() => setDialog({ kind: 'create' })}>
              <span className={styles.hash}>
                <PlusIcon size={18} />
              </span>
              Add channel
            </button>
          </li>
        </ul>
        <h2 className={`${styles.section} ${styles.border}`}>Direct messages</h2>
        <DmRows channels={dms} />
      </div>
      <button className={styles.fab} aria-label="New message" onClick={() => setDialog({ kind: 'dm' })}>
        <ComposeIcon size={22} />
      </button>
      <ChannelDialogs dialog={dialog} onClose={() => setDialog(null)} onDone={(id) => navigate(`/c/${id}`)} />
    </div>
  );
}

export function MobileHeader({ title }: { title: string }) {
  return (
    <header className={styles.header}>
      <div className={styles.headerRow}>
        <h1 className={styles.title}>{title}</h1>
        <UserMenu variant="mobile" />
      </div>
    </header>
  );
}

export function DmRows({ channels }: { channels: ReturnType<typeof sortByRecent> }) {
  const me = useMe();
  const { users, reads, presence, prefs, manualReads } = useWorkspace();
  const counts = useMentionCounts();
  return (
    <ul className={styles.list} data-testid="dm-list">
      {channels.map((c) => {
        const others = dmOthers(c, me.id);
        const muted = notifyLevel(c, prefs) === 'none';
        const unread = !muted && isUnread(c, reads, me.id, manualReads);
        const n = counts.get(c.id) ?? 0;
        const last = c.lastMessage;
        const preview = last ? `${last.authorId === me.id ? 'You: ' : ''}${plainPreview(last.text, users)}` : 'No messages yet';
        return (
          <li key={c.id}>
            <Link to={`/c/${c.id}`} className={`${styles.dmRow} ${unread ? styles.unread : ''} ${muted ? styles.mutedRow : ''}`} data-unread={unread || undefined} data-muted={muted || undefined}>
              {others.length > 1 ? (
                <span className={styles.group}>{others.length}</span>
              ) : (
                <Avatar user={users.get(others[0])} size={36} online={presenceDot(presence.get(others[0]))} />
              )}
              <span className={styles.dmText}>
                <span className={styles.dmName}>
                  {channelTitle(c, me.id, users)} {others.length === 1 && <StatusEmoji user={users.get(others[0])} />}
                </span>
                <span className={styles.dmPreview}>{preview}</span>
              </span>
              {n > 0 ? <span className="badge">{n}</span> : <span className={styles.time}>{formatShortTime(c.lastMessageAt)}</span>}
            </Link>
          </li>
        );
      })}
      {channels.length === 0 && <li className={styles.empty}>No conversations yet.</li>}
    </ul>
  );
}
