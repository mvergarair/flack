import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import type { Channel, Message } from '../data/types';
import { formatDay, sameDay } from '../lib/time';
import { isCompact } from '../lib/grouping';

export { isCompact };
import { MessageItem } from './MessageItem';
import styles from './MessageList.module.css';

interface Props {
  channel: Channel;
  messages: Message[];
  loading: boolean;
  hasMore: boolean;
  loadingOlder: boolean;
  onLoadOlder: () => void;
  intro?: ReactNode;
  footer?: ReactNode;
  highlightId?: string;
  meId: string;
  /** Draw a "New" divider before the first message from others after this time (ms). */
  newSince?: number | null;
}

export function MessageList({ channel, messages, loading, hasMore, loadingOlder, onLoadOlder, intro, footer, highlightId, meId, newSince }: Props) {
  const scroller = useRef<HTMLDivElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);
  const prevFirst = useRef<string | undefined>(undefined);
  const prevLast = useRef<string | undefined>(undefined);
  const prevHeight = useRef(0);
  const [showJump, setShowJump] = useState(false);

  const firstNewId =
    newSince == null ? undefined : messages.find((m) => m.authorId !== meId && (m.createdAt?.toMillis() ?? 0) > newSince)?.id;
  const first = messages[0]?.id;
  const last = messages[messages.length - 1];

  // Reset per channel.
  useEffect(() => {
    atBottom.current = true;
    prevFirst.current = undefined;
    prevLast.current = undefined;
  }, [channel.id]);

  // Keep position when older messages are prepended; stick to bottom for new ones.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (prevFirst.current && first !== prevFirst.current && last?.id === prevLast.current) {
      el.scrollTop += el.scrollHeight - prevHeight.current;
    } else if (last && last.id !== prevLast.current && (atBottom.current || last.authorId === meId || !prevLast.current)) {
      el.scrollTop = el.scrollHeight;
    }
    prevFirst.current = first;
    prevLast.current = last?.id;
    prevHeight.current = el.scrollHeight;
  }, [first, last, meId]);

  // Images and fonts load after render: stay pinned to the bottom if we were there.
  useEffect(() => {
    const el = scroller.current;
    const inner = content.current;
    if (!el || !inner) return;
    const ro = new ResizeObserver(() => {
      if (atBottom.current) el.scrollTop = el.scrollHeight;
      prevHeight.current = el.scrollHeight;
    });
    ro.observe(inner);
    return () => ro.disconnect();
  }, []);

  // Load older pages when the top sentinel scrolls into view.
  useEffect(() => {
    const s = sentinel.current;
    if (!s || !hasMore) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading) {
          prevHeight.current = scroller.current?.scrollHeight ?? 0;
          onLoadOlder();
        }
      },
      { root: scroller.current, rootMargin: '400px 0px 0px 0px' },
    );
    io.observe(s);
    return () => io.disconnect();
  }, [hasMore, loading, onLoadOlder]);

  // Scroll a highlighted (linked) message into view once it's loaded.
  useEffect(() => {
    if (!highlightId) return;
    const node = scroller.current?.querySelector(`[data-message-id="${CSS.escape(highlightId)}"]`);
    if (node) {
      atBottom.current = false;
      node.scrollIntoView({ block: 'center' });
    }
  }, [highlightId, messages.length]);

  const onScroll = () => {
    const el = scroller.current!;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    atBottom.current = dist < 80;
    setShowJump(dist > 600);
  };

  return (
    <div className={styles.wrap}>
      <div className={styles.scroller} ref={scroller} onScroll={onScroll} data-testid="message-list" role="log" aria-live="polite" aria-relevant="additions">
        <div ref={content} className={styles.content}>
          {hasMore && !loading && <div ref={sentinel} className={styles.sentinel} aria-hidden="true" />}
          {loadingOlder && (
            <div className={styles.loadingOlder}>
              <div className="spinner" />
            </div>
          )}
          {!hasMore && !loading && intro}
          {loading && messages.length === 0 && (
            <div className={styles.loading}>
              <div className="spinner" aria-label="Loading messages" />
            </div>
          )}
          {messages.map((m, i) => {
            const prev = messages[i - 1];
            const d = m.createdAt?.toDate();
            const newDay = d && (!prev?.createdAt || !sameDay(prev.createdAt.toDate(), d));
            return (
              <Fragment key={m.id}>
                {m.id === firstNewId && (
                  <div className={styles.newLine} role="separator" data-testid="new-divider">
                    <span>New</span>
                  </div>
                )}
                {newDay && (
                  <div className={styles.day} role="separator">
                    <span>{formatDay(d)}</span>
                  </div>
                )}
                <MessageItem message={m} channel={channel} compact={!newDay && isCompact(prev, m)} highlighted={m.id === highlightId} />
              </Fragment>
            );
          })}
        </div>
      </div>
      {footer}
      {showJump && (
        <button
          className={styles.jump}
          onClick={() => {
            const el = scroller.current!;
            el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
          }}
        >
          Jump to latest ↓
        </button>
      )}
    </div>
  );
}
