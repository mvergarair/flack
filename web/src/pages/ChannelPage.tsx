import { useEffect, useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { MARKED_UNREAD_EVENT, manualUnread, markRead, useChannelMessages } from '../data/messages';
import { channelTitle, dmOthers } from '../lib/channels';
import { isUnread } from '../lib/unread';
import { useDocumentVisible, useIsMobile } from '../lib/hooks';
import { rememberChannel } from './Home';
import { NotFound } from './NotFound';
import { ChannelHeader } from '../components/ChannelHeader';
import { MessageList } from '../components/MessageList';
import { Composer } from '../components/Composer';
import { TypingIndicator } from '../components/TypingIndicator';
import { typingKey, useEnsureTypingKey } from '../data/typing';
import { ThreadPanel } from '../components/ThreadPanel';
import { PinnedBar } from '../components/PinnedBar';
import { Avatar } from '../components/Avatar';
import { usePageTitle } from '../data/branding';
import type { Channel } from '../data/types';
import styles from './ChannelPage.module.css';

export function ChannelPage() {
  const { channelId = '', threadId } = useParams();
  const me = useMe();
  const { channelsById, users } = useWorkspace();
  const mobile = useIsMobile();
  const channel = channelsById.get(channelId);

  useEffect(() => {
    if (channel) rememberChannel(channel.id);
  }, [channel]);
  usePageTitle(channel ? `${channel.type === 'dm' ? '' : '#'}${channelTitle(channel, me.id, users)}` : null);

  if (!channel) return <NotFound />;

  // Phone: a thread takes over the whole screen.
  if (mobile && threadId) {
    return (
      <div className={styles.page}>
        <aside className={styles.thread} aria-label="Thread">
          <ThreadPanel channel={channel} threadId={threadId} />
        </aside>
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <ChannelMain key={channel.id} channel={channel} />
      {threadId && (
        <aside className={styles.thread} aria-label="Thread">
          <ThreadPanel channel={channel} threadId={threadId} />
        </aside>
      )}
    </div>
  );
}

function ChannelMain({ channel }: { channel: Channel }) {
  const me = useMe();
  const { users, reads, manualReads } = useWorkspace();
  const visible = useDocumentVisible();
  const [params] = useSearchParams();
  const highlight = params.get('m') ?? undefined;
  const { messages, loading, hasMore, loadOlder, loadingOlder, error } = useChannelMessages(channel.id);
  useEnsureTypingKey(channel, me.id);
  const unread = isUnread(channel, reads, me.id, manualReads);

  // "New" divider: where my read marker was when I opened the channel (or where I
  // marked unread). Auto-read pauses after "Mark unread" until I leave the channel.
  const [newSince, setNewSince] = useState<number | null>(() => (unread ? (reads.get(channel.id)?.toMillis() ?? null) : null));
  useEffect(() => {
    const on = (e: Event) => {
      const d = (e as CustomEvent<{ channelId: string; ms: number }>).detail;
      if (d.channelId === channel.id) setNewSince(d.ms);
    };
    window.addEventListener(MARKED_UNREAD_EVENT, on);
    return () => {
      window.removeEventListener(MARKED_UNREAD_EVENT, on);
      manualUnread.delete(channel.id);
    };
  }, [channel.id]);

  // Jumping to an older (e.g. pinned) message: page back until it's loaded.
  useEffect(() => {
    if (highlight && !loading && !loadingOlder && hasMore && !messages.some((m) => m.id === highlight)) void loadOlder();
  }, [highlight, loading, loadingOlder, hasMore, messages, loadOlder]);
  const lastOwnMessageId = [...messages].reverse().find((m) => m.authorId === me.id && !m.deleted)?.id;

  // Mark read while the channel is on screen and has something new.
  useEffect(() => {
    if (!visible || loading || !unread || manualUnread.has(channel.id)) return;
    const t = setTimeout(() => markRead(me.id, channel.id).catch(() => undefined), 600);
    return () => clearTimeout(t);
  }, [visible, loading, unread, me.id, channel.id, channel.lastMessageAt]);

  const title = channelTitle(channel, me.id, users);
  const isDm = channel.type === 'dm';
  const others = isDm ? dmOthers(channel, me.id) : [];
  const intro = (
    <div className={styles.intro}>
      {isDm ? (
        <>
          <div className={styles.introAvatars}>
            {others.slice(0, 4).map((id) => (
              <Avatar key={id} user={users.get(id)} size={56} />
            ))}
          </div>
          <h2>{title}</h2>
          <p>
            {others[0] === me.id
              ? 'This is your space. Draft messages, keep notes and links.'
              : `This is the start of your conversation with ${title}.`}
          </p>
        </>
      ) : (
        <>
          <h2>Welcome to #{channel.name}</h2>
          <p>
            This is the very beginning of the <strong>#{channel.name}</strong> channel
            {channel.topic ? `: ${channel.topic}` : '.'}
          </p>
        </>
      )}
    </div>
  );

  return (
    <main className={styles.main} aria-label={isDm ? `Conversation with ${title}` : `Channel ${channel.name}`}>
      <ChannelHeader channel={channel} />
      <PinnedBar channel={channel} />
      {error ? (
        <div className={styles.error}>{error}</div>
      ) : (
        <MessageList
          channel={channel}
          messages={messages}
          loading={loading}
          hasMore={hasMore}
          loadingOlder={loadingOlder}
          onLoadOlder={loadOlder}
          intro={intro}
          highlightId={highlight}
          meId={me.id}
          newSince={newSince}
        />
      )}
      <TypingIndicator channelId={typingKey(channel)} />
      <Composer key={channel.id} channel={channel} placeholder={isDm ? `Message ${title}` : `Message #${channel.name}`} autoFocus lastOwnMessageId={lastOwnMessageId} />
    </main>
  );
}
