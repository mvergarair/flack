import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ClipboardEvent, type DragEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot } from '../data/workspace';
import { sendMessage, newMessageId } from '../data/messages';
import { scheduleMessage, scheduleReminder } from '../data/scheduled';
import { activeCommand, formatWhen, messagePresets, parseRemind, parseSchedule, slashMatches, type SlashCommand } from '../lib/schedule';
import { codeBlock, link, mentionQuery, prefixLines, wrap, type Edit } from '../lib/format';
import { BROADCASTS, broadcastKey, displayToMentions, extractMentions, type Broadcast } from '../lib/markdown';
import { friendlyError } from '../lib/errors';
import { useIsMobile } from '../lib/hooks';
import { typingKey, useTyping } from '../data/typing';
import { uploadAttachments, validateFile, type PendingFile } from '../data/attachments';
import type { Channel, Message, UserProfile } from '../data/types';
import { Avatar } from './Avatar';
import { PendingFiles } from './PendingFiles';
import { requestEdit } from './MessageItem';
import { SchedulePicker } from './SchedulePicker';
import { AtIcon, BellIcon, BoldIcon, ClockIcon, CodeBlockIcon, CodeIcon, ItalicIcon, LinkIcon, ListIcon, OrderedListIcon, PaperclipIcon, SendIcon } from './icons';
import styles from './Composer.module.css';

type Candidate = { kind: 'user'; user: UserProfile } | { kind: 'broadcast'; which: Broadcast };

interface Props {
  channel: Channel;
  thread?: Message | null;
  placeholder: string;
  autoFocus?: boolean;
  /** My most recent editable message here; ↑ in an empty composer edits it. */
  lastOwnMessageId?: string;
}

const draftKey = (channelId: string, threadId?: string) => `flack:draft:${channelId}${threadId ? `:${threadId}` : ''}`;
const loadDraft = (k: string) => {
  try {
    return localStorage.getItem(k) ?? '';
  } catch {
    return '';
  }
};
const saveDraft = (k: string, v: string) => {
  try {
    if (v) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  } catch {
    // ignore
  }
};

export function Composer({ channel, thread, placeholder, autoFocus, lastOwnMessageId }: Props) {
  const me = useMe();
  const { users, presence, scheduled } = useWorkspace();
  const mobile = useIsMobile();
  const key = draftKey(channel.id, thread?.id);
  const [text, setText] = useState(() => loadDraft(key));
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [picked, setPicked] = useState<Map<string, string>>(new Map());
  const [mention, setMention] = useState<{ start: number; query: string; index: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [alsoToChannel, setAlsoToChannel] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  /** Short confirmation ("Scheduled for …", "Reminder set …"), cleared after a few seconds. */
  const [note, setNote] = useState<string | null>(null);
  // "/" command menu: highlighted row, and whether Esc closed it for the current "/…" text.
  const [slashIndex, setSlashIndex] = useState(0);
  const [slashClosed, setSlashClosed] = useState(false);
  const ta = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const typing = useTyping(typingKey(channel, thread?.id));

  // The parent remounts the composer per channel/thread (React key), so state starts fresh.
  useEffect(() => {
    // Only grab focus if nobody else has it (e.g. never steal it from ⌘K search).
    const active = document.activeElement;
    const idle = !active || active === document.body || active.tagName === 'A' || active.tagName === 'BUTTON';
    if (autoFocus && !mobile && idle) ta.current?.focus();
  }, [autoFocus, mobile]);

  useEffect(() => saveDraft(key, text), [key, text]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => setNote(null), 8000);
    return () => clearTimeout(t);
  }, [note]);

  const commands = slashClosed ? [] : slashMatches(text);
  const hintCommand = activeCommand(text);
  useEffect(() => {
    setSlashIndex(0);
    if (!/^\/[a-z]*$/i.test(text)) setSlashClosed(false);
  }, [text]);

  const pickCommand = (c: SlashCommand) => {
    const next = `/${c.name} `;
    pendingSel.current = [next.length, next.length];
    setText(next);
    ta.current?.focus();
  };

  // My scheduled messages for this channel (or this thread).
  const scheduledHere = scheduled.filter(
    (s) => s.kind === 'message' && s.channelId === channel.id && (s.threadParentId ?? null) === (thread?.id ?? null),
  ).length;

  // Auto-grow the textarea up to a limit.
  useLayoutEffect(() => {
    const el = ta.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, mobile ? 140 : 260)}px`;
    if (pendingSel.current) {
      el.setSelectionRange(...pendingSel.current);
      pendingSel.current = null;
    }
  }, [text, mobile]);

  const candidates = useMemo<Candidate[]>(() => {
    if (!mention) return [];
    const q = mention.query.toLowerCase();
    const inChannel = (u: UserProfile) => channel.memberIds.includes(u.id);
    const people: Candidate[] = [...users.values()]
      .filter((u) => u.status === 'active' && (u.displayName.toLowerCase().includes(q) || u.email.toLowerCase().startsWith(q)))
      .sort((a, b) => Number(inChannel(b)) - Number(inChannel(a)) || a.displayName.localeCompare(b.displayName))
      .slice(0, 7)
      .map((user) => ({ kind: 'user', user }));
    // @channel / @here aren't offered in DMs (everyone there is already notified).
    const specials: Candidate[] =
      channel.type === 'dm' ? [] : BROADCASTS.filter((b) => b.startsWith(q)).map((b) => ({ kind: 'broadcast', which: b }));
    return q ? [...people, ...specials] : [...specials, ...people];
  }, [mention, users, channel.memberIds, channel.type]);

  const disabled = channel.archived;

  const apply = (fn: (e: Edit) => Edit) => {
    const el = ta.current;
    if (!el) return;
    const r = fn({ text, selStart: el.selectionStart, selEnd: el.selectionEnd });
    pendingSel.current = [r.selStart, r.selEnd];
    setText(r.text);
    el.focus();
  };

  const pickMention = (c: Candidate) => {
    if (!mention || !ta.current) return;
    const caret = ta.current.selectionStart;
    const label = c.kind === 'user' ? c.user.displayName : c.which;
    const insert = `@${label} `;
    const next = text.slice(0, mention.start) + insert + text.slice(caret);
    const pos = mention.start + insert.length;
    pendingSel.current = [pos, pos];
    setText(next);
    if (c.kind === 'user') setPicked((p) => new Map(p).set(c.user.id, c.user.displayName));
    setMention(null);
    ta.current.focus();
  };

  const updateMention = (value: string, caret: number) => {
    const m = mentionQuery(value, caret);
    setMention(m ? { ...m, index: 0 } : null);
  };

  const addFiles = (list: FileList | File[]) => {
    const next: PendingFile[] = [];
    for (const f of Array.from(list)) {
      const problem = validateFile(f);
      if (problem) {
        setError(problem);
        continue;
      }
      next.push({ id: crypto.randomUUID(), file: f, progress: 0 });
    }
    if (next.length) {
      setError(null);
      setFiles((cur) => [...cur, ...next].slice(0, 10));
    }
  };

  /** Composer text → stored format (`<@uid>` mentions). Typed @channel / @here count too. */
  const toBody = (raw: string) => {
    const withBroadcasts = channel.type === 'dm' ? picked : new Map([...picked, ...BROADCASTS.map((b) => [broadcastKey(b), b] as [string, string])]);
    return displayToMentions(raw, withBroadcasts);
  };

  const clearComposer = () => {
    setText('');
    setPicked(new Map());
    setAlsoToChannel(false);
    typing.stop();
  };

  /** "/remind me in 1h to …": sets a reminder instead of posting. */
  const remind = async (raw: string): Promise<boolean> => {
    const r = parseRemind(raw);
    if (!r) return false;
    if (!r.ok) {
      setError(r.error);
      return true;
    }
    const draft = text;
    clearComposer();
    try {
      await scheduleReminder(me.id, { text: r.text, at: r.at });
      setNote(`⏰ Reminder set for ${formatWhen(r.at)}: “${r.text}”`);
    } catch (err) {
      setText((cur) => (cur ? `${draft}\n${cur}` : draft));
      setError(friendlyError(err));
    }
    return true;
  };

  /** Schedules `raw` (default: the composer text) for `at`. */
  const schedule = async (at: number, raw = text.trim()) => {
    if (!raw) throw new Error('Write a message first.');
    if (files.length) throw new Error('Scheduled messages can’t include files yet.');
    const body = toBody(raw);
    // Clear right away so anything typed while the write is in flight is kept; restore on failure.
    const draft = { text, picked, alsoToChannel };
    clearComposer();
    setError(null);
    try {
      await scheduleMessage(me.id, { channelId: channel.id, threadParentId: thread?.id ?? null, text: body, mentions: extractMentions(body), alsoToChannel: draft.alsoToChannel, at });
    } catch (err) {
      setText((cur) => (cur ? `${draft.text}\n${cur}` : draft.text));
      setPicked(draft.picked);
      setAlsoToChannel(draft.alsoToChannel);
      throw err;
    }
    setNote(`Scheduled for ${formatWhen(at)}.`);
  };

  /** "/schedule tomorrow 9am …": schedules instead of posting. Without a time, asks for one. */
  const scheduleCommand = async (raw: string): Promise<boolean> => {
    const r = parseSchedule(raw);
    if (!r) return false;
    if (r.ok) {
      await schedule(r.at, r.text).catch((err) => setError(friendlyError(err)));
    } else if (r.text) {
      setText(r.text);
      setScheduling(true);
    } else {
      setError(r.error);
    }
    return true;
  };

  const send = async () => {
    const raw = text.trim();
    if ((!raw && files.length === 0) || sending || disabled) return;
    setError(null);
    if (files.length === 0 && ((await remind(raw)) || (await scheduleCommand(raw)))) return;
    const body = toBody(raw);
    const messageId = newMessageId(channel.id);
    typing.stop();
    if (files.length === 0) {
      // Text-only: clear right away (the message shows optimistically) so anything typed while
      // the write is in flight is never wiped. Restore the draft if the write fails.
      const draft = text;
      const draftPicked = picked;
      setText('');
      setPicked(new Map());
      try {
        await sendMessage({ channel, me: me.id, text: body, mentions: extractMentions(body), thread, messageId, users, alsoToChannel });
        setAlsoToChannel(false);
      } catch (err) {
        setText((cur) => (cur ? `${draft}\n${cur}` : draft));
        setPicked(draftPicked);
        setError(friendlyError(err));
      }
      return;
    }
    // With files: keep the composer (showing upload progress) until the uploads finish.
    setSending(true);
    try {
      const attachments = await uploadAttachments(channel.id, messageId, me.id, files, (id, progress) =>
        setFiles((cur) => cur.map((f) => (f.id === id ? { ...f, progress } : f))),
      );
      await sendMessage({ channel, me: me.id, text: body, mentions: extractMentions(body), attachments, thread, messageId, users, alsoToChannel });
      setAlsoToChannel(false);
      setText('');
      setFiles([]);
      setPicked(new Map());
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (commands.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setSlashIndex((i) => (i + d + commands.length) % commands.length);
        return;
      }
      if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') {
        e.preventDefault();
        pickCommand(commands[Math.min(slashIndex, commands.length - 1)]);
        return;
      }
      if (e.key === 'Escape') {
        setSlashClosed(true);
        return;
      }
    }
    if (mention && candidates.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        const d = e.key === 'ArrowDown' ? 1 : -1;
        setMention({ ...mention, index: (mention.index + d + candidates.length) % candidates.length });
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        pickMention(candidates[mention.index]);
        return;
      }
      if (e.key === 'Escape') {
        setMention(null);
        return;
      }
    }
    const mod = e.metaKey || e.ctrlKey;
    if (e.key === 'ArrowUp' && !mod && !e.altKey && !e.shiftKey && !text && files.length === 0 && lastOwnMessageId) {
      e.preventDefault();
      requestEdit(lastOwnMessageId);
      return;
    }
    if (mod && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      apply((x) => wrap(x, '**'));
    } else if (mod && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      apply((x) => wrap(x, '_'));
    } else if (mod && e.shiftKey && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      apply((x) => wrap(x, '`'));
    } else if (e.key === 'Enter' && !e.shiftKey && !mobile && !e.nativeEvent.isComposing) {
      // Inside an open code fence, Enter adds a line instead of sending.
      const before = e.currentTarget.value.slice(0, e.currentTarget.selectionStart);
      if ((before.match(/```/g)?.length ?? 0) % 2 === 1) return;
      e.preventDefault();
      void send();
    }
  };

  const onPaste = (e: ClipboardEvent<HTMLTextAreaElement>) => {
    const pasted = Array.from(e.clipboardData.files);
    if (pasted.length) {
      e.preventDefault();
      addFiles(pasted);
    }
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files);
  };

  if (disabled) {
    return (
      <div className={styles.archived} data-testid="composer-archived">
        This channel is archived. You can read its history but not post.
      </div>
    );
  }

  const tool = (label: string, icon: React.ReactNode, fn: () => void, hint?: string) => (
    <button type="button" className={styles.tool} aria-label={label} title={hint ? `${label} (${hint})` : label} onMouseDown={(e) => e.preventDefault()} onClick={fn}>
      {icon}
    </button>
  );

  const openScheduler = () => {
    if (!text.trim()) return setError('Write the message first, then pick when to send it.');
    if (files.length) return setError('Scheduled messages can’t include files yet.');
    setError(null);
    setScheduling(true);
  };

  const schedulePicker = <SchedulePicker title="Schedule message" presets={messagePresets()} onPick={schedule} onClose={() => setScheduling(false)} />;

  return (
    <div
      className={`${styles.wrap} ${thread ? styles.inThread : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('Files')) {
          e.preventDefault();
          setDragging(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDragging(false);
      }}
      onDrop={onDrop}
      data-testid={thread ? 'thread-composer' : 'composer'}
    >
      {commands.length > 0 && (
        <ul className={styles.mentions} role="listbox" aria-label="Commands">
          {commands.map((c, i) => (
            <li
              key={c.name}
              role="option"
              aria-selected={i === slashIndex}
              className={i === slashIndex ? styles.mentionActive : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pickCommand(c);
              }}
            >
              <span className={styles.broadcastIcon}>{c.name === 'remind' ? <BellIcon size={14} /> : <ClockIcon size={14} />}</span>
              <strong>/{c.name}</strong>
              <span>{c.description}</span>
            </li>
          ))}
        </ul>
      )}
      {mention && candidates.length > 0 && (
        <ul className={styles.mentions} role="listbox" aria-label="Mention someone">
          {candidates.map((c, i) => (
            <li
              key={c.kind === 'user' ? c.user.id : c.which}
              role="option"
              aria-selected={i === mention.index}
              className={i === mention.index ? styles.mentionActive : undefined}
              onMouseDown={(e) => {
                e.preventDefault();
                pickMention(c);
              }}
            >
              {c.kind === 'user' ? (
                <>
                  <Avatar user={c.user} size={22} online={presenceDot(presence.get(c.user.id))} />
                  <strong>{c.user.displayName}</strong>
                  <span>{channel.memberIds.includes(c.user.id) ? c.user.title || c.user.email : 'not in this channel'}</span>
                </>
              ) : (
                <>
                  <span className={styles.broadcastIcon}>
                    <AtIcon size={14} />
                  </span>
                  <strong>@{c.which}</strong>
                  <span>
                    {c.which === 'channel'
                      ? `Notify everyone in this channel (${channel.memberIds.length})`
                      : 'Notify everyone here who is online'}
                  </span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {scheduledHere > 0 && (
        <div className={styles.scheduledBar} data-testid="scheduled-bar">
          <ClockIcon size={14} />
          {scheduledHere === 1 ? '1 scheduled message' : `${scheduledHere} scheduled messages`} {thread ? 'in this thread' : 'here'}
          <Link to="/later?tab=scheduled">See all</Link>
        </div>
      )}
      {/* Outside the box (which clips its children), pinned to its top-right corner. */}
      {scheduling && <div className={styles.pickerSlot}>{schedulePicker}</div>}
      <div className={`${styles.box} ${dragging ? styles.dragging : ''}`}>
        {!mobile && (
          <div className={styles.toolbar} role="toolbar" aria-label="Formatting">
            {tool('Bold', <BoldIcon size={17} />, () => apply((x) => wrap(x, '**')), '⌘B')}
            {tool('Italic', <ItalicIcon size={17} />, () => apply((x) => wrap(x, '_')), '⌘I')}
            {tool('Link', <LinkIcon size={17} />, () => apply((x) => link(x)))}
            <span className={styles.sep} />
            {tool('Bulleted list', <ListIcon size={17} />, () => apply((x) => prefixLines(x, '- ')))}
            {tool('Numbered list', <OrderedListIcon size={17} />, () => apply((x) => prefixLines(x, (i) => `${i + 1}. `)))}
            {tool('Inline code', <CodeIcon size={17} />, () => apply((x) => wrap(x, '`', '`', 'code')), '⌘⇧C')}
            {tool('Code block', <CodeBlockIcon size={17} />, () => apply(codeBlock))}
            <span className={styles.grow} />
            {!thread && <span className={styles.hint}>Markdown supported</span>}
          </div>
        )}
        <PendingFiles files={files} onRemove={(id) => setFiles((cur) => cur.filter((f) => f.id !== id))} disabled={sending} />
        <div className={styles.inputRow}>
          {mobile && (
            <button type="button" className={styles.roundBtn} aria-label="Attach a file" onClick={() => fileInput.current?.click()}>
              <PaperclipIcon size={19} />
            </button>
          )}
          <label className="sr-only" htmlFor={`composer-${key}`}>
            {placeholder}
          </label>
          <textarea
            id={`composer-${key}`}
            ref={ta}
            className={styles.textarea}
            rows={1}
            value={text}
            placeholder={placeholder}
            onChange={(e) => {
              setText(e.target.value);
              updateMention(e.target.value, e.target.selectionStart);
              if (e.target.value) typing.ping();
            }}
            onKeyDown={onKeyDown}
            onKeyUp={(e) => {
              if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) updateMention(text, e.currentTarget.selectionStart);
            }}
            onClick={(e) => updateMention(text, e.currentTarget.selectionStart)}
            onBlur={() => setTimeout(() => setMention(null), 150)}
            onPaste={onPaste}
            enterKeyHint={mobile ? 'enter' : 'send'}
          />
          {mobile && (
            <button type="button" className={`${styles.roundBtn} ${styles.sendRound}`} aria-label="Send" onClick={send} disabled={sending || (!text.trim() && !files.length)}>
              <SendIcon size={18} />
            </button>
          )}
        </div>
        {mobile ? (
          <div className={styles.mobileTools} role="toolbar" aria-label="Formatting">
            {tool('Bold', <BoldIcon size={17} />, () => apply((x) => wrap(x, '**')))}
            {tool('Italic', <ItalicIcon size={17} />, () => apply((x) => wrap(x, '_')))}
            {tool('Inline code', <CodeIcon size={17} />, () => apply((x) => wrap(x, '`', '`', 'code')))}
            {tool('Bulleted list', <ListIcon size={17} />, () => apply((x) => prefixLines(x, '- ')))}
            {tool('Mention someone', <AtIcon size={17} />, () => apply((x) => ({ text: x.text.slice(0, x.selStart) + '@' + x.text.slice(x.selEnd), selStart: x.selStart + 1, selEnd: x.selStart + 1 })))}
            {tool('Schedule message', <ClockIcon size={17} />, openScheduler)}
          </div>
        ) : (
          <div className={styles.footer}>
            {tool('Attach a file', <PaperclipIcon size={18} />, () => fileInput.current?.click())}
            {tool('Mention someone', <AtIcon size={18} />, () => {
              const pos = ta.current?.selectionStart ?? text.length;
              apply((x) => ({ text: x.text.slice(0, x.selStart) + '@' + x.text.slice(x.selEnd), selStart: x.selStart + 1, selEnd: x.selStart + 1 }));
              setMention({ start: pos, query: '', index: 0 });
            })}
            <span className={styles.grow} />
            {tool('Schedule message', <ClockIcon size={18} />, openScheduler)}
            <button type="button" className={styles.send} aria-label="Send" onClick={send} disabled={sending || (!text.trim() && !files.length)}>
              <SendIcon size={17} />
            </button>
          </div>
        )}
      </div>
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        data-testid="file-input"
        onChange={(e) => {
          if (e.target.files) addFiles(e.target.files);
          e.target.value = '';
        }}
      />
      {thread && (
        <label className={styles.alsoSend}>
          <input type="checkbox" checked={alsoToChannel} onChange={(e) => setAlsoToChannel(e.target.checked)} />
          {channel.type === 'dm' ? 'Also send as direct message' : `Also send to #${channel.name}`}
        </label>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      {hintCommand && !error && !note && (
        <p className={styles.note} data-testid="command-hint">
          For example: <code>{hintCommand.example}</code>
        </p>
      )}
      {note && !error && (
        <p className={styles.note} role="status">
          {note} <Link to={note.startsWith('⏰') ? '/later?tab=reminders' : '/later?tab=scheduled'}>View</Link>
        </p>
      )}
    </div>
  );
}
