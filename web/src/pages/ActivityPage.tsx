import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { dismissActivity, getActivitySeen, setActivitySeen, useActivity } from '../data/activity';
import { channelTitle } from '../lib/channels';
import { formatRelative } from '../lib/time';
import { useIsMobile } from '../lib/hooks';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import { ClockIcon, CloseIcon } from '../components/icons';
import { SchedulePicker } from '../components/SchedulePicker';
import { scheduleReminder } from '../data/scheduled';
import { reminderPresets } from '../lib/schedule';
import { friendlyError } from '../lib/errors';
import type { ActivityItem } from '../data/types';
import { MobileHeader } from './MobileHome';
import { usePageTitle } from '../data/branding';
import styles from './ActivityPage.module.css';

export function ActivityPage() {
  const me = useMe();
  const mobile = useIsMobile();
  const { users, channelsById } = useWorkspace();
  const items = useActivity();
  const seenBefore = getActivitySeen();
  const [snoozing, setSnoozing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const snooze = async (a: ActivityItem, at: number) => {
    await scheduleReminder(me.id, { text: a.preview, at, channelId: a.channelId, messageId: a.messageId, threadParentId: a.threadParentId });
    await dismissActivity(me.id, a.id);
  };

  usePageTitle('Activity');

  // Opening the view marks everything as seen (after render, so "new" dots show once).
  useEffect(() => {
    if (items?.length) {
      const newest = items[0].createdAt?.toMillis() ?? Date.now();
      const t = setTimeout(() => setActivitySeen(Math.max(newest, Date.now())), 1500);
      return () => clearTimeout(t);
    }
  }, [items]);

  return (
    <div className={styles.page}>
      {mobile && <MobileHeader title="Activity" />}
      {!mobile && (
        <header className={styles.header}>
          <h1>Activity</h1>
          <span>Mentions, replies to your threads, and reminders</span>
        </header>
      )}
      <div className={styles.scroll}>
        {items === null && (
          <div className={styles.center}>
            <div className="spinner" />
          </div>
        )}
        {items?.length === 0 && <EmptyState title="Nothing yet" body="When someone @mentions you or replies to a thread you're in, or a reminder comes due, it shows up here." />}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
        <ul className={styles.list} data-testid="activity-list">
          {items?.map((a) => {
            const ch = a.channelId ? channelsById.get(a.channelId) : undefined;
            const where = ch ? (ch.type === 'dm' ? channelTitle(ch, me.id, users) : `#${ch.name}`) : 'a channel you left';
            const messageHref = a.channelId && a.messageId ? (a.threadParentId ? `/c/${a.channelId}/t/${a.threadParentId}` : `/c/${a.channelId}?m=${a.messageId}`) : null;
            const unseen = (a.createdAt?.toMillis() ?? 0) > seenBefore;
            const dismiss = (
              <button className="icon-btn" aria-label="Dismiss" onClick={() => dismissActivity(me.id, a.id)}>
                <CloseIcon size={15} />
              </button>
            );

            if (a.kind === 'reminder') {
              const body = (
                <>
                  <span className={styles.icon}>
                    <ClockIcon size={20} />
                  </span>
                  <span className={styles.text}>
                    <span className={styles.line}>
                      <strong>Reminder</strong>
                      {messageHref && <> about a message in <strong>{where}</strong></>}
                    </span>
                    <span className={styles.preview}>{a.preview}</span>
                  </span>
                  <span className={styles.when}>{formatRelative(a.createdAt)}</span>
                </>
              );
              return (
                <li key={a.id} className={unseen ? styles.unseen : undefined} data-testid="reminder-item">
                  {messageHref ? (
                    <Link to={messageHref} className={styles.item}>
                      {body}
                    </Link>
                  ) : (
                    <div className={styles.item}>{body}</div>
                  )}
                  <span className={styles.anchor}>
                    <button className="btn btn-ghost" onClick={() => setSnoozing(a.id)}>
                      Snooze
                    </button>
                    {snoozing === a.id && (
                      <SchedulePicker
                        title="Remind me again"
                        presets={reminderPresets().slice(0, 4)}
                        confirmLabel="Snooze"
                        placement="below"
                        onPick={(at) => snooze(a, at).catch((err) => setError(friendlyError(err)))}
                        onClose={() => setSnoozing(null)}
                      />
                    )}
                  </span>
                  <button className="btn btn-ghost" onClick={() => dismissActivity(me.id, a.id)}>
                    Done
                  </button>
                </li>
              );
            }

            if (a.kind === 'schedule-failed') {
              return (
                <li key={a.id} className={unseen ? styles.unseen : undefined}>
                  <Link to="/later?tab=scheduled" className={styles.item}>
                    <span className={`${styles.icon} ${styles.danger}`}>
                      <ClockIcon size={20} />
                    </span>
                    <span className={styles.text}>
                      <span className={styles.line}>
                        Your scheduled message to <strong>{where}</strong> wasn't sent: {a.error}
                      </span>
                      <span className={styles.preview}>{a.preview}</span>
                    </span>
                    <span className={styles.when}>{formatRelative(a.createdAt)}</span>
                  </Link>
                  {dismiss}
                </li>
              );
            }

            return (
              <li key={a.id} className={unseen ? styles.unseen : undefined}>
                <Link to={messageHref ?? '/'} className={styles.item}>
                  <Avatar user={users.get(a.authorId)} size={36} />
                  <span className={styles.text}>
                    <span className={styles.line}>
                      <strong>{users.get(a.authorId)?.displayName ?? 'Someone'}</strong>{' '}
                      {a.kind === 'mention' ? 'mentioned you in' : 'replied in a thread in'} <strong>{where}</strong>
                    </span>
                    <span className={styles.preview}>{a.preview}</span>
                  </span>
                  <span className={styles.when}>{formatRelative(a.createdAt)}</span>
                </Link>
                {dismiss}
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
