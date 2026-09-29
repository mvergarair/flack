import { useState, type FormEvent } from 'react';
import { doc, Timestamp, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { friendlyError } from '../lib/errors';
import { activeStatus, CLEAR_OPTIONS, expiryFor, STATUS_PRESETS, type ClearAfter } from '../lib/status';
import { Modal } from './Modal';
import { EmojiPicker } from './EmojiPicker';
import styles from './StatusDialog.module.css';

export function StatusDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const current = activeStatus(me);
  const [emoji, setEmoji] = useState(current?.emoji || '💬');
  const [text, setText] = useState(current?.text ?? '');
  const [clear, setClear] = useState<ClearAfter>(current?.expiresAt ? 'today' : 'never');
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const write = async (value: { emoji: string; text: string; expiresAt: Timestamp | null } | null) => {
    setBusy(true);
    setError(null);
    try {
      await updateDoc(doc(db, 'users', me.id), { customStatus: value });
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  const save = (e: FormEvent) => {
    e.preventDefault();
    const expires = expiryFor(clear);
    void write({ emoji, text: text.trim(), expiresAt: expires ? Timestamp.fromMillis(expires) : null });
  };

  return (
    <Modal
      title="Set a status"
      onClose={onClose}
      footer={
        <>
          {current && (
            <button className="btn btn-ghost btn-danger" onClick={() => write(null)} disabled={busy} style={{ marginRight: 'auto' }}>
              Clear status
            </button>
          )}
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="status-form" disabled={busy || (!text.trim() && !emoji)}>
            Save
          </button>
        </>
      }
    >
      <form id="status-form" onSubmit={save} className={styles.form}>
        <div className={styles.row}>
          <span className={styles.emojiWrap}>
            <button type="button" className={`btn ${styles.emojiBtn}`} aria-label={`Status emoji ${emoji}. Change`} onClick={() => setPicking((v) => !v)}>
              {emoji}
            </button>
            {picking && <EmojiPicker align="left" onPick={setEmoji} onClose={() => setPicking(false)} />}
          </span>
          <label className={styles.textField}>
            <span className="sr-only">Status text</span>
            <input className="input" value={text} maxLength={100} placeholder="What's your status?" onChange={(e) => setText(e.target.value)} autoFocus />
          </label>
        </div>

        <label className="field">
          Clear after
          <select className="input" value={clear} onChange={(e) => setClear(e.target.value as ClearAfter)}>
            {CLEAR_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        <div className={styles.presets} role="list" aria-label="Suggestions">
          {STATUS_PRESETS.map((p) => (
            <button
              key={p.text}
              type="button"
              role="listitem"
              className={styles.preset}
              onClick={() => {
                setEmoji(p.emoji);
                setText(p.text);
                setClear(p.clear);
              }}
            >
              <span>{p.emoji}</span> {p.text}
              <span className={styles.presetClear}>{CLEAR_OPTIONS.find((o) => o.value === p.clear)?.label}</span>
            </button>
          ))}
        </div>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}
