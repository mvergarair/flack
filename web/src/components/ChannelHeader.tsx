import { useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot, notifyLevel } from '../data/workspace';
import { channelTitle, dmOthers } from '../lib/channels';
import { useIsMobile, useNow } from '../lib/hooks';
import { lastOnlineLabel } from '../lib/time';
import { activeStatus } from '../lib/status';
import type { Channel } from '../data/types';
import { Avatar } from './Avatar';
import { ChannelSettings } from './ChannelSettings';
import { BackIcon, BellIcon, BellOffIcon, HashIcon, LockIcon, UsersIcon } from './icons';
import { BOT_ID } from '../lib/bot';
import styles from './ChannelHeader.module.css';

export function ChannelHeader({ channel }: { channel: Channel }) {
  const me = useMe();
  const { users, presence, prefs } = useWorkspace();
  const mobile = useIsMobile();
  const [settings, setSettings] = useState<false | 'about' | 'notifications'>(false);
  const level = notifyLevel(channel, prefs);
  const title = channelTitle(channel, me.id, users);
  const isDm = channel.type === 'dm';
  const others = isDm ? dmOthers(channel, me.id) : [];
  const now = useNow(60_000);
  const dmOther = isDm && others.length === 1 ? users.get(others[0]) : undefined;
  const custom = activeStatus(dmOther, now);
  const dmStatus =
    isDm && others.length === 1
      ? [custom ? `${custom.emoji} ${custom.text}`.trim() : '', others[0] !== me.id ? lastOnlineLabel(presence.get(others[0]), now) : '']
          .filter(Boolean)
          .join(' · ')
      : '';

  return (
    <header className={styles.header}>
      {mobile && (
        <Link to={isDm ? '/dms' : '/'} className={styles.back} aria-label="Back">
          <BackIcon size={22} />
        </Link>
      )}
      <button className={styles.titleBtn} onClick={() => setSettings('about')} aria-label={`Channel details for ${title}`}>
        <h1 className={styles.title}>
          {isDm ? (
            others.length === 1 && <Avatar user={users.get(others[0])} size={24} online={presenceDot(presence.get(others[0]))} />
          ) : (
            <span className={styles.hash}>{channel.type === 'private' ? <LockIcon size={16} /> : <HashIcon size={18} />}</span>
          )}
          <span className={styles.name} data-testid="channel-title">
            {title}
          </span>
        </h1>
        {mobile ? (
          <span className={styles.sub} data-testid="last-online">{isDm ? dmStatus : `${channel.memberIds.length} members`}</span>
        ) : isDm ? (
          dmStatus && (
            <span className={styles.topic} data-testid="last-online">
              {dmStatus}
            </span>
          )
        ) : (
          channel.topic && <span className={styles.topic}>{channel.topic}</span>
        )}
      </button>
      <div className={styles.spacer} />
      {channel.archived && <span className="pill">Archived</span>}
      <button
        className={`${styles.members} ${level !== (channel.type === 'dm' ? 'all' : 'mentions') ? styles.bellCustom : ''}`}
        onClick={() => setSettings('notifications')}
        aria-label={`Notifications: ${level === 'all' ? 'all new messages' : level === 'none' ? 'muted' : 'mentions and thread replies'}`}
        title="Notification settings"
        data-testid="notify-button"
        data-level={level}
      >
        {level === 'none' ? <BellOffIcon size={16} /> : <BellIcon size={16} />}
      </button>
      {!channel.memberIds.includes(BOT_ID) && (
        <button className={styles.members} onClick={() => setSettings('about')} aria-label={`${channel.memberIds.length} members`}>
          <UsersIcon size={16} />
          {channel.memberIds.length}
        </button>
      )}
      {settings && <ChannelSettings channel={channel} initialTab={settings} onClose={() => setSettings(false)} />}
    </header>
  );
}
