import { useState } from 'react';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { isDndActive } from '../lib/dnd';
import { friendlyError } from '../lib/errors';
import { useNow } from '../lib/hooks';
import styles from './NotificationSettings.module.css';

const PAUSES: { label: string; until: (now: Date) => number }[] = [
  { label: '30 minutes', until: (n) => n.getTime() + 30 * 60_000 },
  { label: '1 hour', until: (n) => n.getTime() + 3_600_000 },
  { label: '2 hours', until: (n) => n.getTime() + 2 * 3_600_000 },
  { label: 'Until tomorrow', until: (n) => new Date(n.getFullYear(), n.getMonth(), n.getDate() + 1, 8, 0).getTime() },
];

/** Pause notifications for a while, and/or a daily quiet-hours schedule (in my time zone). */
export function DndSettings() {
  const me = useMe();
  const now = useNow(30_000);
  const dnd = me.dnd ?? {};
  const [schedule, setSchedule] = useState(dnd.schedule ?? { enabled: false, start: '22:00', end: '08:00' });
  const [error, setError] = useState<string | null>(null);
  const pausedUntil = dnd.until && dnd.until.toMillis() > now ? dnd.until.toMillis() : null;
  const active = isDndActive(me.dnd, me.timeZone, now);

  const save = (patch: { until?: Timestamp | null; schedule?: typeof schedule }) => {
    setError(null);
    updateDoc(doc(db, 'users', me.id), { dnd: { until: dnd.until ?? null, schedule: dnd.schedule ?? schedule, ...patch } }).catch((err) => setError(friendlyError(err)));
  };

  return (
    <section className={styles.box} data-testid="dnd-settings" aria-labelledby="dnd-h">
      <strong id="dnd-h">
        Do Not Disturb {active && <span data-testid="dnd-active">· 🌙 on now</span>}
      </strong>
      {pausedUntil ? (
        <div className={styles.dndRow}>
          <span data-testid="dnd-until">
            Paused until{' '}
            {new Date(pausedUntil).toDateString() === new Date(now).toDateString()
              ? new Date(pausedUntil).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
              : new Date(pausedUntil).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' })}
          </span>
          <button className="btn" onClick={() => save({ until: null })}>
            Resume notifications
          </button>
        </div>
      ) : (
        <div className={styles.pauses} role="group" aria-label="Pause notifications">
          <span className="field-hint">Pause notifications for</span>
          {PAUSES.map((p) => (
            <button key={p.label} className="btn" onClick={() => save({ until: Timestamp.fromMillis(p.until(new Date())) })}>
              {p.label}
            </button>
          ))}
        </div>
      )}
      <label className={styles.scheduleToggle}>
        <input
          type="checkbox"
          checked={schedule.enabled}
          onChange={(e) => {
            const next = { ...schedule, enabled: e.target.checked };
            setSchedule(next);
            save({ schedule: next });
          }}
        />
        Pause every day from
        <input
          type="time"
          className={`input ${styles.time}`}
          value={schedule.start}
          aria-label="Quiet hours start"
          onChange={(e) => setSchedule({ ...schedule, start: e.target.value })}
          onBlur={() => save({ schedule })}
        />
        to
        <input
          type="time"
          className={`input ${styles.time}`}
          value={schedule.end}
          aria-label="Quiet hours end"
          onChange={(e) => setSchedule({ ...schedule, end: e.target.value })}
          onBlur={() => save({ schedule })}
        />
      </label>
      <span className="field-hint">Times are in your time zone{me.timeZone ? ` (${me.timeZone.replace(/_/g, ' ')})` : ''}. Mentions still show up in Activity.</span>
      {error && <p className="error-text">{error}</p>}
    </section>
  );
}
