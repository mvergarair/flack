import { memo, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { deleteMessage, editMessage, markUnreadFrom, removeLinkPreviews } from '../data/messages';
import { toggleReaction } from '../data/reactions';
import { pinMessage, unpinMessage } from '../data/pins';
import { removeSaved, saveForLater } from '../data/saved';
import { scheduleReminder } from '../data/scheduled';
import { reminderPresets } from '../lib/schedule';
import { DEFAULT_QUICK_REACTIONS, hasReacted, reactorNames, summarizeReactions } from '../lib/reactions';
import { renderMarkdown, mentionsToDisplay, displayToMentions, extractMentions, mentionsUser, plainPreview } from '../lib/markdown';
import { formatRelative, formatTime } from '../lib/time';
import { friendlyError } from '../lib/errors';
import type { Channel, Message } from '../data/types';
import { Avatar } from './Avatar';
import { Attachments } from './Attachments';
import { EmojiPicker } from './EmojiPicker';
import { SchedulePicker } from './SchedulePicker';
import { StatusEmoji } from './StatusEmoji';
import { openProfile } from './ProfileCard';
import { MoreIcon, PencilIcon, ReplyIcon, SmileIcon, TrashIcon } from './icons';
import styles from './MessageItem.module.css';

/** Dispatched by the composer (↑ in an empty box) to start editing a message by id. */
export const EDIT_MESSAGE_EVENT = 'flack:edit-message';

export function requestEdit(messageId: string) {
  window.dispatchEvent(new CustomEvent(EDIT_MESSAGE_EVENT, { detail: { id: messageId } }));
}

interface Props {
  message: Message;
  channel: Channel;
  compact?: boolean;
  inThread?: boolean;
  highlighted?: boolean;
}

function MessageItemInner({ message, channel, compact, inThread, highlighted }: Props) {
  const me = useMe();
  const { users, saved: savedItems } = useWorkspace();
  const author = users.get(message.authorId);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [touchActions, setTouchActions] = useState(false);
  const [picker, setPicker] = useState(false);
  const [menu, setMenu] = useState(false);
  const [reminding, setReminding] = useState(false);

  const html = useMemo(() => (message.deleted ? '' : renderMarkdown(message.text, users, me.id)), [message.text, message.deleted, users, me.id]);
  const mine = message.authorId === me.id;
  const canDelete = mine || me.role === 'admin';
  const mentionsMe = mentionsUser(message.mentions, me.id) && !mine;
  const name = author?.displayName ?? 'Unknown';

  const rowRef = useRef<HTMLElement>(null);

  const startEdit = () => {
    setDraft(mentionsToDisplay(message.text, users));
    setEditing(true);
  };

  // Leaving the editor hands the keyboard back to the composer it came from.
  const finishEdit = () => {
    setEditing(false);
    const composer = inThread ? 'thread-composer' : 'composer';
    setTimeout(() => document.querySelector<HTMLTextAreaElement>(`[data-testid="${composer}"] textarea`)?.focus(), 0);
  };

  useEffect(() => {
    if (!mine || message.deleted) return;
    const on = (e: Event) => {
      if ((e as CustomEvent<{ id: string }>).detail?.id !== message.id) return;
      startEdit();
      rowRef.current?.scrollIntoView({ block: 'nearest' });
    };
    window.addEventListener(EDIT_MESSAGE_EVENT, on);
    return () => window.removeEventListener(EDIT_MESSAGE_EVENT, on);
    // startEdit reads the latest message text via closure on each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mine, message.id, message.deleted, message.text, users]);

  const saveEdit = async () => {
    const picked = new Map(message.mentions.map((id) => [id, id.startsWith('!') ? id.slice(1) : (users.get(id)?.displayName ?? '')]));
    if (channel.type !== 'dm') ['channel', 'here'].forEach((b) => picked.set(`!${b}`, b));
    const text = displayToMentions(draft.trim(), picked);
    if (!text && message.attachments.length === 0) return;
    try {
      await editMessage(channel.id, message, text, extractMentions(text));
      finishEdit();
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const onEditKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      finishEdit();
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void saveEdit();
    }
  };

  const threadLink = `/c/${channel.id}/t/${message.id}`;
  const pinned = !!channel.pinnedIds?.includes(message.id);
  const saved = savedItems.has(message.id);
  const quick = me.quickReactions?.length === 3 ? me.quickReactions : DEFAULT_QUICK_REACTIONS;
  const chips = summarizeReactions(message.reactions);
  const canReact = !channel.archived && !message.deleted && !message.pending;

  const react = (emoji: string) => {
    const on = !hasReacted(message.reactions, me.id, emoji);
    toggleReaction(channel.id, message.id, me.id, emoji, on).catch((err) => setError(friendlyError(err)));
  };
  const run = (fn: () => Promise<unknown>) => {
    setMenu(false);
    fn().catch((err) => setError(friendlyError(err)));
  };

  return (
    <article
      ref={rowRef}
      className={`${styles.row} ${compact ? styles.compact : ''} ${highlighted ? styles.highlight : ''} ${mentionsMe ? styles.mentioned : ''} ${touchActions ? styles.showActions : ''}`}
      onClick={(e) => {
        // Touch screens have no hover: tapping a message toggles its action bar.
        if (!matchMedia('(hover: none)').matches) return;
        if ((e.target as HTMLElement).closest('a, button, textarea, input, pre')) return;
        setTouchActions((v) => !v);
      }}
      data-testid="message"
      data-message-id={message.id}
      aria-label={`${name}, ${formatTime(message.createdAt)}`}
    >
      <div className={styles.gutter}>
        {compact ? (
          <time className={styles.hoverTime} dateTime={message.createdAt?.toDate().toISOString()}>
            {formatTime(message.createdAt).replace(/\s?[AP]M$/i, '')}
          </time>
        ) : (
          <button type="button" className={styles.avatarBtn} onClick={() => openProfile(message.authorId)} aria-label={`View profile of ${name}`}>
            <Avatar user={author} size={inThread ? 34 : 38} />
          </button>
        )}
      </div>
      <div className={styles.body}>
        {(pinned || saved) && (
          <div className={styles.pinned}>
            {pinned && <span data-testid="pinned-tag">📌 Pinned</span>}
            {pinned && saved && ' · '}
            {saved && <span data-testid="saved-tag">🔖 Saved for later</span>}
          </div>
        )}
        {message.threadParentId && !inThread && (
          <Link to={`/c/${channel.id}/t/${message.threadParentId}`} className={styles.repliedTo} data-testid="replied-to-thread">
            replied to a thread
          </Link>
        )}
        {message.threadParentId && inThread && message.alsoToChannel && (
          <div className={styles.pinned}>{channel.type === 'dm' ? 'Also sent as direct message' : `Also sent to #${channel.name}`}</div>
        )}
        {!compact && (
          <header className={styles.meta}>
            <button type="button" className={styles.author} onClick={() => openProfile(message.authorId)}>
              {name}
            </button>
            <StatusEmoji user={author} />
            {author?.status === 'deactivated' && <span className={styles.tag}>deactivated</span>}
            <time className={styles.time} dateTime={message.createdAt?.toDate().toISOString()} title={message.createdAt?.toDate().toLocaleString()}>
              {formatTime(message.createdAt)}
            </time>
          </header>
        )}

        {editing ? (
          <div className={styles.editor}>
            <textarea
              className={styles.editArea}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onEditKey}
              autoFocus
              onFocus={(e) => e.currentTarget.setSelectionRange(e.currentTarget.value.length, e.currentTarget.value.length)}
              aria-label="Edit message"
              rows={Math.min(8, draft.split('\n').length + 1)}
            />
            <div className={styles.editActions}>
              <span className="field-hint">Esc to cancel · Enter to save</span>
              <button className="btn" onClick={finishEdit}>
                Cancel
              </button>
              <button className="btn btn-primary" onClick={saveEdit}>
                Save
              </button>
            </div>
          </div>
        ) : message.deleted ? (
          <p className={styles.deleted}>This message was deleted.</p>
        ) : (
          <>
            {message.text && (
              <div
                className={styles.text}
                data-testid="message-text"
                onClick={(e) => {
                  // @mention chips open that person's profile.
                  const uid = (e.target as HTMLElement).closest<HTMLElement>('.mention[data-uid]')?.dataset.uid;
                  if (uid) openProfile(uid);
                }}
              >
                <span dangerouslySetInnerHTML={{ __html: html }} />
                {message.editedAt && <span className={styles.edited}> (edited)</span>}
              </div>
            )}
            {message.attachments.length > 0 && <Attachments attachments={message.attachments} />}
            {!!message.linkPreviews?.length && (
              <div className={styles.previews}>
                {message.linkPreviews.map((p) => (
                  <div key={p.url} className={styles.preview} data-testid="link-preview">
                    <div className={styles.previewText}>
                      <span className={styles.previewSite}>{p.siteName}</span>
                      {p.title && (
                        <a href={p.url} target="_blank" rel="noopener noreferrer nofollow" className={styles.previewTitle}>
                          {p.title}
                        </a>
                      )}
                      {p.description && <span className={styles.previewDesc}>{p.description}</span>}
                    </div>
                    {p.image && <img className={styles.previewImg} src={p.image} alt="" loading="lazy" referrerPolicy="no-referrer" />}
                  </div>
                ))}
                {mine && (
                  <button
                    type="button"
                    className={styles.previewRemove}
                    aria-label="Remove link previews"
                    title="Remove previews"
                    onClick={() => removeLinkPreviews(channel.id, message.id).catch((err) => setError(friendlyError(err)))}
                  >
                    ×
                  </button>
                )}
              </div>
            )}
          </>
        )}
        {chips.length > 0 && (
          <div className={styles.reactions} data-testid="reactions">
            {chips.map((c) => {
              const mineToo = c.uids.includes(me.id);
              const who = reactorNames(c.uids, (u) => users.get(u)?.displayName ?? 'Someone', me.id);
              return (
                <button
                  key={c.emoji}
                  type="button"
                  className={`${styles.chip} ${mineToo ? styles.chipMine : ''}`}
                  aria-pressed={mineToo}
                  aria-label={`${c.emoji} ${c.uids.length}, reacted by ${who}`}
                  title={`${who} reacted with ${c.emoji}`}
                  disabled={!canReact}
                  onClick={() => react(c.emoji)}
                >
                  <span>{c.emoji}</span>
                  <span className={styles.chipCount}>{c.uids.length}</span>
                </button>
              );
            })}
            {canReact && (
              <span className={styles.addWrap}>
                <button type="button" className={styles.chipAdd} aria-label="Add reaction" onClick={() => setPicker(true)}>
                  <SmileIcon size={15} />
                </button>
              </span>
            )}
          </div>
        )}
        {message.pending && <span className={styles.sending}>Sending…</span>}
        {error && <p className="error-text">{error}</p>}

        {!inThread && message.replyCount > 0 && (
          <Link to={threadLink} className={styles.thread} data-testid="thread-summary">
            <span className={styles.threadAvatars}>
              {message.replyUserIds.slice(-3).map((id) => (
                <Avatar key={id} user={users.get(id)} size={22} />
              ))}
            </span>
            <span className={styles.threadCount}>
              {message.replyCount} {message.replyCount === 1 ? 'reply' : 'replies'}
            </span>
            <span className={styles.threadWhen}>Last reply {formatRelative(message.lastReplyAt)}</span>
          </Link>
        )}

        {confirmDelete && (
          <div className={styles.confirm} role="alertdialog" aria-label="Delete message?">
            <span>Delete this message{message.attachments.length ? ' and its files' : ''}?</span>
            <button className="btn" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
            <button
              className="btn btn-primary"
              onClick={() =>
                deleteMessage(channel.id, message, me.id).catch((err) => {
                  setError(friendlyError(err));
                  setConfirmDelete(false);
                })
              }
            >
              Delete
            </button>
          </div>
        )}
      </div>

      {!editing && !message.deleted && !message.pending && (
        <div className={`${styles.actions} ${picker || menu ? styles.actionsOpen : ''}`} role="toolbar" aria-label="Message actions">
          {canReact &&
            quick.map((e) => (
              <button key={e} className={`icon-btn ${styles.quick}`} aria-label={`React with ${e}`} title={`React with ${e}`} onClick={() => react(e)}>
                {e}
              </button>
            ))}
          {canReact && (
            <button className="icon-btn" aria-label="Add reaction" title="Add reaction" onClick={() => setPicker((v) => !v)}>
              <SmileIcon size={17} />
            </button>
          )}
          {!inThread && !channel.archived && (
            <Link to={threadLink} className="icon-btn" aria-label="Reply in thread" title="Reply in thread">
              <ReplyIcon size={17} />
            </Link>
          )}
          {mine && !channel.archived && (
            <button className="icon-btn" aria-label="Edit message" title="Edit" onClick={startEdit}>
              <PencilIcon size={16} />
            </button>
          )}
          {canDelete && (
            <button className="icon-btn" aria-label="Delete message" title="Delete" onClick={() => setConfirmDelete(true)}>
              <TrashIcon size={16} />
            </button>
          )}
          <button className="icon-btn" aria-label="More actions" aria-haspopup="menu" aria-expanded={menu} title="More" onClick={() => setMenu((v) => !v)}>
            <MoreIcon size={17} />
          </button>
          {menu && (
            <>
              <div className={styles.scrim} onClick={() => setMenu(false)} />
              <div className={styles.menu} role="menu">
                <button role="menuitem" onClick={() => run(() => (saved ? removeSaved(me.id, message.id) : saveForLater(me.id, channel.id, message)))}>
                  {saved ? 'Remove from saved' : 'Save for later'}
                </button>
                <button
                  role="menuitem"
                  onClick={() => {
                    setMenu(false);
                    setReminding(true);
                  }}
                >
                  Remind me about this
                </button>
                <button role="menuitem" onClick={() => run(() => markUnreadFrom(me.id, channel.id, message))}>
                  Mark unread
                </button>
                {!channel.archived && (
                  <button
                    role="menuitem"
                    onClick={() => run(() => (pinned ? unpinMessage(channel.id, message.id) : pinMessage(channel.id, message.id)))}
                  >
                    {pinned ? 'Unpin from channel' : 'Pin to channel'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {reminding && (
        <div className={styles.remindAnchor}>
          <SchedulePicker
            title="Remind me about this"
            presets={reminderPresets()}
            confirmLabel="Remind me"
            placement="below"
            onPick={(at) => {
              const author = users.get(message.authorId)?.displayName ?? 'Someone';
              const preview = plainPreview(message.text, users, 180) || (message.attachments?.length ? '📎 attachment' : 'a message');
              return scheduleReminder(me.id, {
                text: `${author}: ${preview}`,
                at,
                channelId: channel.id,
                messageId: message.id,
                threadParentId: message.threadParentId ?? null,
              });
            }}
            onClose={() => setReminding(false)}
          />
        </div>
      )}
      {picker && (
        <div className={styles.pickerAnchor}>
          <EmojiPicker onPick={react} onClose={() => setPicker(false)} />
        </div>
      )}
    </article>
  );
}

export const MessageItem = memo(MessageItemInner);
