import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { askFlackbot, startNewConversation, useAiSettings, useBotDraft, useConversation, useConversationId, type BotDraft } from '../data/ai';
import { openFlackbot } from '../data/bot';
import { markRead, newMessageId, sendMessage } from '../data/messages';
import type { Channel, Message, UserProfile } from '../data/types';
import { botDmId } from '../lib/bot';
import { friendlyError } from '../lib/errors';
import { renderMarkdown } from '../lib/markdown';
import { BackIcon, CloseIcon, Logo, NewChatIcon, SendIcon } from './icons';
import styles from './FlackbotPanel.module.css';

type Source = NonNullable<NonNullable<Message['botRef']>['sources']>[number];
const SAFE_ID = /^[A-Za-z0-9_-]{1,120}$/;

const sourceHref = (s: Source) =>
  SAFE_ID.test(s.channelId) && SAFE_ID.test(s.messageId) && (!s.threadParentId || SAFE_ID.test(s.threadParentId))
    ? s.threadParentId
      ? `/c/${s.channelId}/t/${s.threadParentId}`
      : `/c/${s.channelId}?m=${s.messageId}`
    : null;

function greeting(name: string): string {
  const h = new Date().getHours();
  const part = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
  return `${part}, ${name.split(' ')[0]}!`;
}

const SUGGESTIONS = ['What did I miss in the last day?', 'Summarize what happened in #general this week', 'What have people said about the launch?'];

interface Props {
  /** Desktop pane: close button. Phone page: back button. */
  variant: 'pane' | 'page';
  onClose: () => void;
}

/**
 * Ask Flackbot: a chat with Flackbot about the team's messages. The desktop app shows it as a
 * right-hand pane; phones get it as a full-screen page. Questions and answers live in the
 * person's Flackbot DM, grouped by conversation.
 */
export function FlackbotPanel({ variant, onClose }: Props) {
  const me = useMe();
  const { users, channelsById } = useWorkspace();
  const settings = useAiSettings();
  const conversationId = useConversationId();
  const dmId = botDmId(me.id);
  const messages = useConversation(me.id, conversationId, channelsById.has(dmId));
  const draft = useBotDraft(me.id);
  const [text, setText] = useState('');
  const [asking, setAsking] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const navigate = useNavigate();

  const answered = new Set((messages ?? []).map((m) => m.ai?.questionId).filter(Boolean));
  const liveDraft: BotDraft | null = draft && draft.conversationId === conversationId && !answered.has(draft.questionId) ? draft : null;
  const waiting = !!asking && !answered.has(asking);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages?.length, liveDraft?.text, liveDraft?.status]);
  // Reading answers here counts as reading the Flackbot DM.
  useEffect(() => {
    if (messages?.length && channelsById.has(dmId)) markRead(me.id, dmId).catch(() => undefined);
  }, [messages?.length, channelsById, dmId, me.id]);
  useEffect(() => {
    input.current?.focus();
  }, [conversationId]);

  const ask = async (question: string) => {
    const q = question.trim();
    if (!q || waiting) return;
    setError(null);
    setText('');
    const channel: Channel = channelsById.get(dmId) ?? ({ id: await openFlackbot(), type: 'dm', name: '', memberIds: [], createdBy: '', archived: false } as unknown as Channel);
    const id = newMessageId(channel.id);
    setAsking(id);
    try {
      await sendMessage({ channel, me: me.id, text: q, mentions: [], messageId: id, users });
      await askFlackbot(id, conversationId);
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setAsking((cur) => (cur === id ? null : cur));
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      void ask(text);
    }
  };

  // Citation links inside answers use the router.
  const onAnswerClick = (e: MouseEvent) => {
    const a = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[data-cite]');
    if (!a) return;
    e.preventDefault();
    navigate(a.getAttribute('href')!);
    if (variant === 'page') onClose();
  };

  const off = settings && !settings.enabled;
  return (
    <section className={styles.panel} data-variant={variant} aria-label="Ask Flackbot" data-testid="flackbot-panel">
      <header className={styles.header}>
        {variant === 'page' && (
          <button className="icon-btn" onClick={onClose} aria-label="Back">
            <BackIcon />
          </button>
        )}
        <Logo size={26} />
        <h2 className={styles.title}>Flackbot</h2>
        <span className={styles.spacer} />
        {!off && (
          <button className="icon-btn" onClick={startNewConversation} aria-label="New chat" title="New chat" disabled={waiting}>
            <NewChatIcon size={18} />
          </button>
        )}
        {variant === 'pane' && (
          <button className="icon-btn" onClick={onClose} aria-label="Close Flackbot" title="Close">
            <CloseIcon size={18} />
          </button>
        )}
      </header>

      <div className={styles.body} onClick={onAnswerClick}>
        {off ? (
          <div className={styles.empty}>
            <Logo size={56} />
            <p className={styles.hello}>Ask Flackbot is off</p>
            <p className={styles.sub}>
              {me.role === 'admin' ? (
                <>
                  Turn it on in <Link to="/admin">People &amp; invites → Flackbot</Link>.
                </>
              ) : (
                'An admin can turn it on for your workspace.'
              )}
            </p>
          </div>
        ) : messages && messages.length === 0 && !liveDraft && !waiting ? (
          <div className={styles.empty} data-testid="flackbot-empty">
            <Logo size={56} />
            <p className={styles.hello}>{greeting(me.displayName)}</p>
            <p className={styles.sub}>Ask me about anything your team has discussed. I only see the channels and messages you can see.</p>
            <div className={styles.suggestions}>
              {SUGGESTIONS.map((s) => (
                <button key={s} className={styles.suggestion} onClick={() => void ask(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <ol className={styles.list} data-testid="flackbot-messages">
            {(messages ?? []).map((m) => (m.authorId === me.id ? <Question key={m.id} message={m} /> : <Answer key={m.id} message={m} users={users} meId={me.id} />))}
            {(liveDraft || waiting) && (
              <li className={styles.answer} data-testid="flackbot-draft" aria-live="polite">
                {liveDraft?.text ? (
                  <div className={styles.draftText}>{liveDraft.text}</div>
                ) : (
                  <span className={styles.status}>
                    <span className={styles.dots} aria-hidden="true" />
                    {liveDraft?.status ?? 'Thinking'}…
                  </span>
                )}
              </li>
            )}
          </ol>
        )}
        <div ref={bottom} />
      </div>

      {!off && (
        <footer className={styles.footer}>
          {error && (
            <p className={styles.error} role="alert">
              {error}
            </p>
          )}
          <div className={styles.composer}>
            <textarea
              ref={input}
              className={styles.input}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Ask Flackbot…"
              aria-label="Ask Flackbot"
              rows={Math.min(6, Math.max(1, text.split('\n').length))}
              maxLength={4000}
            />
            <button className={styles.send} onClick={() => void ask(text)} disabled={!text.trim() || waiting} aria-label="Ask">
              <SendIcon size={18} />
            </button>
          </div>
          <p className={styles.note}>Answers are written by AI (Claude) and can be wrong. Check the linked messages.</p>
        </footer>
      )}
    </section>
  );

}

function Question({ message }: { message: Message }) {
  return (
    <li className={styles.question} data-testid="flackbot-question">
      {message.text}
    </li>
  );
}

function Answer({ message, users, meId }: { message: Message; users: Map<string, UserProfile>; meId: string }) {
  const sources = message.botRef?.sources ?? [];
  const html = useMemo(() => {
    const byN = new Map(sources.map((s) => [s.n, sourceHref(s)]));
    // [3] → a link to that message (added after sanitizing; hrefs are built from safe ids).
    return renderMarkdown(message.text, users, meId).replace(/\[(\d{1,3})\]/g, (all, n) => {
      const href = byN.get(Number(n));
      return href ? `<a href="${href}" data-cite class="${styles.cite}">${n}</a>` : all;
    });
  }, [message.text, sources, users, meId]);
  return (
    <li className={styles.answer} data-testid="flackbot-answer">
      <div className={styles.answerText} dangerouslySetInnerHTML={{ __html: html }} />
      {sources.length > 0 && (
        <ul className={styles.sources} aria-label="Sources">
          {sources.map((s) => {
            const href = sourceHref(s);
            return (
              <li key={s.n}>
                {href ? (
                  <a href={href} data-cite className={styles.source}>
                    <b>{s.n}</b> {s.label}
                  </a>
                ) : (
                  <span className={styles.source}>
                    <b>{s.n}</b> {s.label}
                  </span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </li>
  );
}
