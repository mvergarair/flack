import { useEffect, useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { listenBotSettings, saveBotSettings, type AutoResponse, type BotSettings } from '../data/bot';
import { FLACKBOT } from '../lib/bot';
import { friendlyError } from '../lib/errors';
import { Avatar } from './Avatar';
import styles from './FlackbotCard.module.css';

const MAX = 50;

/** Admins: Flackbot's welcome message and its automatic answers to common questions. */
export function FlackbotCard() {
  const me = useMe();
  const [saved, setSaved] = useState<BotSettings | null>(null);
  const [welcome, setWelcome] = useState('');
  const [responses, setResponses] = useState<AutoResponse[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(
    () =>
      listenBotSettings((s) => {
        setSaved((prev) => {
          // Take the stored values the first time (and after saving); don't clobber edits.
          if (!prev) {
            setWelcome(s.welcome);
            setResponses(s.responses);
          }
          return s;
        });
      }),
    [],
  );
  if (!saved) return null;

  const dirty = welcome !== saved.welcome || JSON.stringify(responses) !== JSON.stringify(saved.responses);
  const update = (i: number, patch: Partial<AutoResponse>) => setResponses((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const save = async () => {
    setBusy(true);
    setError(null);
    setStatus(null);
    try {
      const clean = responses.map((r) => ({ trigger: r.trigger.trim(), reply: r.reply.trim() })).filter((r) => r.trigger && r.reply);
      await saveBotSettings(me.id, { welcome, responses: clean });
      setResponses(clean);
      setWelcome(welcome.trim());
      setSaved({ welcome: welcome.trim(), responses: clean });
      setStatus('Saved. Changes reach Flackbot within a few minutes.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={styles.card} aria-labelledby="flackbot-title" data-testid="flackbot-card">
      <div className={styles.head}>
        <Avatar user={FLACKBOT} size={36} />
        <div>
          <h2 id="flackbot-title">Flackbot</h2>
          <p>
            Flackbot sends reminders and notices, welcomes new members, and answers common questions in any channel when a message
            contains one of your phrases.
          </p>
        </div>
      </div>

      <label className="field">
        Welcome message
        <textarea
          className={`input ${styles.area}`}
          value={welcome}
          onChange={(e) => setWelcome(e.target.value)}
          maxLength={2000}
          rows={4}
          placeholder="Leave empty for Flackbot's built-in welcome (tips for getting started)."
          data-testid="bot-welcome"
        />
        <span className="field-hint">Sent to each person's Flackbot DM the first time they open Flack.</span>
      </label>

      <h3 className={styles.h3}>Automatic answers</h3>
      {responses.length === 0 && <p className={styles.muted}>None yet. Example: when someone says "wifi password", reply with where to find it.</p>}
      <ul className={styles.list} data-testid="bot-responses">
        {responses.map((r, i) => (
          <li key={i} className={styles.response}>
            <label className="field">
              When a message says
              <input className="input" value={r.trigger} maxLength={100} onChange={(e) => update(i, { trigger: e.target.value })} placeholder="wifi password" aria-label={`Phrase ${i + 1}`} />
            </label>
            <label className="field">
              Flackbot replies
              <textarea className={`input ${styles.area}`} rows={2} value={r.reply} maxLength={2000} onChange={(e) => update(i, { reply: e.target.value })} aria-label={`Reply ${i + 1}`} />
            </label>
            <button className="btn btn-ghost" onClick={() => setResponses((rs) => rs.filter((_, j) => j !== i))} aria-label={`Remove answer ${i + 1}`}>
              Remove
            </button>
          </li>
        ))}
      </ul>
      <p className="field-hint">Phrases match whole words, ignoring case, accents and punctuation. Flackbot answers in the same channel or thread.</p>

      <div className={styles.actions}>
        <button className="btn" disabled={responses.length >= MAX} onClick={() => setResponses((rs) => [...rs, { trigger: '', reply: '' }])}>
          Add an answer
        </button>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={save}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {status && !dirty && (
        <p className={styles.muted} role="status">
          {status}
        </p>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
