import { useEffect, useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { notifyLevel, useWorkspace } from '../data/workspace';
import { setNotifyLevel } from '../data/channelPrefs';
import { friendlyError } from '../lib/errors';
import type { Channel, NotifyLevel } from '../data/types';
import styles from './NotifyLevelPicker.module.css';

const OPTIONS: { level: NotifyLevel; label: string; hint: string; dm?: boolean; channel?: boolean }[] = [
  { level: 'all', label: 'All new messages', hint: 'A notification for every message.', dm: true, channel: true },
  { level: 'mentions', label: 'Mentions & thread replies', hint: '@you, @channel, @here and replies in your threads.', channel: true },
  { level: 'none', label: 'Nothing (mute)', hint: 'No notifications. The conversation is dimmed and never shown as unread.', dm: true, channel: true },
];

/** Radio group for my per-channel notification setting. */
export function NotifyLevelPicker({ channel }: { channel: Channel }) {
  const me = useMe();
  const { prefs } = useWorkspace();
  const saved = notifyLevel(channel, prefs);
  // Show the choice immediately; the saved value catches up via the prefs listener.
  const [pending, setPending] = useState<NotifyLevel | null>(null);
  const current = pending ?? saved;
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (pending === saved) setPending(null);
  }, [pending, saved]);
  const isDm = channel.type === 'dm';
  const name = isDm ? 'this conversation' : `#${channel.name}`;

  return (
    <fieldset className={styles.group} data-testid="notify-level">
      <legend className={styles.legend}>Notify me about {name}</legend>
      {OPTIONS.filter((o) => (isDm ? o.dm : o.channel)).map((o) => (
        <label key={o.level} className={`${styles.option} ${current === o.level ? styles.selected : ''}`}>
          <input
            type="radio"
            name={`notify-${channel.id}`}
            value={o.level}
            checked={current === o.level}
            onChange={() => {
              setError(null);
              setPending(o.level);
              setNotifyLevel(me.id, channel, o.level).catch((err) => {
                setPending(null);
                setError(friendlyError(err));
              });
            }}
          />
          <span>
            <strong>
              {o.label}
              {o.level === (isDm ? 'all' : 'mentions') && <span className={styles.default}> · default</span>}
            </strong>
            <span className="field-hint">{o.hint}</span>
          </span>
        </label>
      ))}
      {error && <p className="error-text">{error}</p>}
    </fieldset>
  );
}
