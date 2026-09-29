import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { cancelScheduled, editScheduledText, reschedule, sendScheduledNow } from '../data/scheduled';
import { channelTitle } from '../lib/channels';
import { BROADCASTS, broadcastKey, displayToMentions, extractMentions, mentionsToDisplay, plainPreview } from '../lib/markdown';
import { formatWhen, messagePresets, reminderPresets } from '../lib/schedule';
import { friendlyError } from '../lib/errors';
import { useIsMobile } from '../lib/hooks';
import type { ScheduledItem } from '../data/types';
import { EmptyState } from '../components/EmptyState';
import { SchedulePicker } from '../components/SchedulePicker';
import { ClockIcon } from '../components/icons';
import { MobileHeader } from './MobileHome';
import { SavedList } from './LaterSaved';
import { usePageTitle } from '../data/branding';
import styles from './ActivityPage.module.css';
import tabStyles from './LaterPage.module.css';

const TABS = [
  { id: 'saved', label: 'Saved' },
  { id: 'reminders', label: 'Reminders' },
  { id: 'scheduled', label: 'Scheduled' },
] as const;
type Tab = (typeof TABS)[number]['id'];

/** Later: saved messages, upcoming reminders and scheduled messages. */
export function LaterPage() {
  const mobile = useIsMobile();
  const { saved, scheduled } = useWorkspace();
  const [params, setParams] = useSearchParams();
  const tab: Tab = TABS.some((t) => t.id === params.get('tab')) ? (params.get('tab') as Tab) : 'saved';
  const counts: Record<Tab, number> = {
    saved: saved.size,
    reminders: scheduled.filter((s) => s.kind === 'reminder').length,
    scheduled: scheduled.filter((s) => s.kind === 'message').length,
  };

  usePageTitle('Later');

  return (
    <div className={styles.page}>
      {mobile && <MobileHeader title="Later" />}
      {!mobile && (
        <header className={styles.header}>
          <h1>Later</h1>
          <span>Saved messages, reminders and scheduled messages</span>
        </header>
      )}
      <div className={tabStyles.tabs} role="tablist" aria-label="Later">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={tab === t.id}
            className={tab === t.id ? tabStyles.active : undefined}
            onClick={() => setParams(t.id === 'saved' ? {} : { tab: t.id }, { replace: true })}
          >
            {t.label}
            {counts[t.id] > 0 && <span className={tabStyles.count}>{counts[t.id]}</span>}
          </button>
        ))}
      </div>
      <div className={styles.scroll} role="tabpanel">
        {tab === 'saved' && <SavedList />}
        {tab === 'reminders' && <ScheduledList kind="reminder" />}
        {tab === 'scheduled' && <ScheduledList kind="message" />}
      </div>
    </div>
  );
}

function ScheduledList({ kind }: { kind: 'message' | 'reminder' }) {
  const { scheduled } = useWorkspace();
  const items = scheduled.filter((s) => s.kind === kind);
  if (!items.length) {
    return kind === 'reminder' ? (
      <EmptyState title="No reminders" body="Use ⋯ → Remind me about this on any message, or type “/remind me in 1h to …” in a message box." />
    ) : (
      <EmptyState title="No scheduled messages" body="Write a message and click the clock next to Send to pick when it goes out." />
    );
  }
  return (
    <ul className={styles.list} data-testid={kind === 'reminder' ? 'reminders-list' : 'scheduled-list'}>
      {items.map((i) => (
        <ScheduledRow key={i.id} item={i} />
      ))}
    </ul>
  );
}

function ScheduledRow({ item }: { item: ScheduledItem }) {
  const me = useMe();
  const { users, channelsById } = useWorkspace();
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ch = item.channelId ? channelsById.get(item.channelId) : undefined;
  const where = ch ? (ch.type === 'dm' ? channelTitle(ch, me.id, users) : `#${ch.name}`) : 'a conversation you left';
  const failed = item.status === 'failed';
  const isMessage = item.kind === 'message';
  const messageHref =
    item.channelId && (isMessage ? item.threadParentId : item.messageId)
      ? item.threadParentId
        ? `/c/${item.channelId}/t/${item.threadParentId}`
        : `/c/${item.channelId}?m=${item.messageId}`
      : isMessage && item.channelId
        ? `/c/${item.channelId}`
        : null;

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const saveEdit = () =>
    run(async () => {
      const draft = (editing ?? '').trim();
      if (!draft) throw new Error('The message can’t be empty.');
      // Keep the original mentions as mentions (the names shown in the editor map back to them).
      const picked = new Map<string, string>([
        ...(item.mentions ?? []).filter((m) => !m.startsWith('!')).map((id) => [id, users.get(id)?.displayName ?? 'unknown'] as [string, string]),
        ...(ch?.type === 'dm' ? [] : BROADCASTS.map((b) => [broadcastKey(b), b] as [string, string])),
      ]);
      const body = displayToMentions(draft, picked);
      await editScheduledText(me.id, item.id, body, extractMentions(body));
      setEditing(null);
    });

  return (
    <li data-testid="scheduled-item">
      <div className={styles.item}>
        <span className={`${styles.icon} ${failed ? styles.danger : ''}`}>
          <ClockIcon size={20} />
        </span>
        <span className={styles.text}>
          <span className={styles.line}>
            {failed ? (
              <span className={tabStyles.failed}>Not sent: {item.error}</span>
            ) : (
              <strong>{formatWhen(item.sendAt.toMillis())}</strong>
            )}
            {isMessage && (
              <>
                {' '}
                · to {messageHref ? <Link to={messageHref}>{where}</Link> : where}
                {item.threadParentId ? ' (thread reply)' : ''}
              </>
            )}
            {!isMessage && item.messageId && messageHref && (
              <>
                {' '}
                · about <Link to={messageHref}>a message in {where}</Link>
              </>
            )}
          </span>
          {editing == null ? (
            <span className={styles.preview}>{isMessage ? plainPreview(item.text, users, 300) : item.text}</span>
          ) : (
            <span className={tabStyles.edit}>
              <textarea aria-label="Edit scheduled message" value={editing} onChange={(e) => setEditing(e.target.value)} rows={3} autoFocus />
              <span className={tabStyles.editRow}>
                <button className="btn btn-ghost" onClick={() => setEditing(null)}>
                  Cancel
                </button>
                <button className="btn btn-primary" disabled={busy} onClick={saveEdit}>
                  Save
                </button>
              </span>
            </span>
          )}
          {error && (
            <span className={tabStyles.failed} role="alert">
              {error}
            </span>
          )}
        </span>
      </div>
      <span className={tabStyles.actions}>
        {isMessage && editing == null && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => setEditing(mentionsToDisplay(item.text, users))}>
            Edit
          </button>
        )}
        <span className={styles.anchor}>
          <button className="btn btn-ghost" disabled={busy} onClick={() => setPicking(true)}>
            {failed ? 'Retry' : 'Reschedule'}
          </button>
          {picking && (
            <SchedulePicker
              title={failed ? 'Try again at' : 'New time'}
              presets={isMessage ? [...reminderPresets().slice(1, 3), ...messagePresets()] : reminderPresets()}
              confirmLabel="Save"
              placement="below"
              onPick={(at) => reschedule(me.id, item.id, at)}
              onClose={() => setPicking(false)}
            />
          )}
        </span>
        {isMessage && ch && !ch.archived && (
          <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => sendScheduledNow(me.id, item, ch, users))}>
            Send now
          </button>
        )}
        <button className="btn btn-ghost" disabled={busy} onClick={() => run(() => cancelScheduled(me.id, item.id))} aria-label={isMessage ? 'Delete scheduled message' : 'Delete reminder'}>
          Delete
        </button>
      </span>
    </li>
  );
}
