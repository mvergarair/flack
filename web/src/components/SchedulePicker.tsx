import { useEffect, useMemo, useState } from 'react';
import { daySlots, formatWhen, fromDateAndSlot, MAX_AHEAD_MS, toDateInput, toSlotInput, validSlot, type Preset } from '../lib/schedule';
import { friendlyError } from '../lib/errors';
import styles from './SchedulePicker.module.css';

interface Props {
  title: string;
  presets: Preset[];
  /** Label of the confirm button in the custom-time form. */
  confirmLabel?: string;
  onPick: (at: number) => Promise<unknown> | void;
  onClose: () => void;
  /** Where the panel opens relative to its (position: relative) anchor. */
  placement?: 'above' | 'below';
  align?: 'left' | 'right';
}

/**
 * Time picker for scheduled messages, reminders and snoozes. Only 10-minute slots are offered
 * (the server sends due items every 10 minutes): presets, or a date + slot for a custom time.
 */
export function SchedulePicker({ title, presets, confirmLabel = 'Schedule', onPick, onClose, placement = 'above', align = 'right' }: Props) {
  const now = Date.now();
  const [custom, setCustom] = useState(false);
  const [date, setDate] = useState(() => toDateInput(presets[0]?.at ?? now));
  const [slot, setSlot] = useState(() => toSlotInput(presets[0]?.at ?? now));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Today only offers slots still ahead.
  const slots = useMemo(() => daySlots().filter((s) => validSlot(fromDateAndSlot(date, s) ?? 0, now) || date !== toDateInput(now)), [date, now]);
  const at = fromDateAndSlot(date, slot);

  const pick = async (ms: number | null) => {
    if (ms == null || !validSlot(ms)) {
      setError('Pick a time in the future.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onPick(ms);
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <>
      <div className={styles.scrim} onMouseDown={(e) => e.preventDefault()} onClick={onClose} />
      <div className={`${styles.panel} ${styles[placement]} ${styles[align]}`} role="dialog" aria-label={title}>
        <div className={styles.title}>{title}</div>
        {!custom && (
          <div className={styles.options} role="menu">
            {presets.map((p) => (
              <button key={p.label} role="menuitem" disabled={busy} onClick={() => pick(p.at)}>
                <span>{p.label}</span>
                <span className={styles.when}>{formatWhen(p.at, now)}</span>
              </button>
            ))}
            <button role="menuitem" onClick={() => setCustom(true)}>
              <span>Custom time…</span>
            </button>
          </div>
        )}
        {custom && (
          <form
            className={styles.custom}
            onSubmit={(e) => {
              e.preventDefault();
              void pick(at);
            }}
          >
            <label>
              Date
              <input
                type="date"
                value={date}
                min={toDateInput(now)}
                max={toDateInput(now + MAX_AHEAD_MS)}
                onChange={(e) => setDate(e.target.value)}
                required
              />
            </label>
            <label>
              Time
              <select value={slots.includes(slot) ? slot : ''} onChange={(e) => setSlot(e.target.value)} required>
                {!slots.includes(slot) && <option value="">Choose…</option>}
                {slots.map((s) => (
                  <option key={s} value={s}>
                    {new Date(`2000-01-01T${s}`).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
                  </option>
                ))}
              </select>
            </label>
            <div className={styles.row}>
              <button type="button" className="btn btn-ghost" onClick={() => setCustom(false)}>
                Back
              </button>
              <button type="submit" className="btn btn-primary" disabled={busy || !slots.includes(slot)}>
                {confirmLabel}
              </button>
            </div>
          </form>
        )}
        {error && (
          <p className={styles.error} role="alert">
            {error}
          </p>
        )}
      </div>
    </>
  );
}
