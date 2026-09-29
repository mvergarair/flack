import { useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { useThread } from '../data/messages';
import { channelTitle } from '../lib/channels';
import { useIsMobile } from '../lib/hooks';
import type { Channel } from '../data/types';
import { MessageItem } from './MessageItem';
import { isCompact } from '../lib/grouping';
import { Composer } from './Composer';
import { TypingIndicator } from './TypingIndicator';
import { typingKey } from '../data/typing';
import { BackIcon, CloseIcon } from './icons';
import styles from './ThreadPanel.module.css';

export function ThreadPanel({ channel, threadId }: { channel: Channel; threadId: string }) {
  const me = useMe();
  const { users } = useWorkspace();
  const mobile = useIsMobile();
  const { parent, replies } = useThread(channel.id, threadId);
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const lastOwnMessageId = [...(parent ? [parent] : []), ...replies].reverse().find((m) => m.authorId === me.id && !m.deleted)?.id;
  const title = channel.type === 'dm' ? channelTitle(channel, me.id, users) : `#${channel.name}`;

  useEffect(() => {
    atBottom.current = true;
  }, [threadId]);

  useLayoutEffect(() => {
    const el = scroller.current;
    const last = replies[replies.length - 1];
    if (el && (atBottom.current || last?.authorId === me.id)) el.scrollTop = el.scrollHeight;
  }, [replies, me.id]);

  return (
    <div className={styles.panel} data-testid="thread-panel">
      <header className={styles.header}>
        {mobile && (
          <Link to={`/c/${channel.id}`} className={styles.back} aria-label="Back to channel">
            <BackIcon size={22} />
          </Link>
        )}
        <h2 className={styles.title}>Thread</h2>
        <span className={styles.channel}>{title}</span>
        <span className={styles.grow} />
        {!mobile && (
          <Link to={`/c/${channel.id}`} className="icon-btn" aria-label="Close thread">
            <CloseIcon />
          </Link>
        )}
      </header>

      <div
        className={styles.scroller}
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
        }}
      >
        {parent === undefined && (
          <div className={styles.center}>
            <div className="spinner" />
          </div>
        )}
        {parent === null && <p className={styles.missing}>This message was deleted or doesn't exist.</p>}
        {parent && (
          <>
            <MessageItem message={parent} channel={channel} inThread />
            <div className={styles.divider} data-testid="thread-reply-count">
              <span>
                {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
              </span>
            </div>
            <div data-testid="thread-replies">
              {replies.map((m, i) => (
                <MessageItem key={m.id} message={m} channel={channel} inThread compact={isCompact(replies[i - 1], m)} />
              ))}
            </div>
          </>
        )}
      </div>

      {parent && !parent.deleted && <TypingIndicator channelId={typingKey(channel, threadId)} testId="thread-typing" />}
      {parent && !parent.deleted && <Composer key={`${channel.id}:${threadId}`} channel={channel} thread={parent} placeholder="Reply…" autoFocus lastOwnMessageId={lastOwnMessageId} />}
    </div>
  );
}
