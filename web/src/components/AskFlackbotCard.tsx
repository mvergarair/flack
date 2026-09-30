import { useEffect, useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { AI_DEFAULTS, AI_MODELS, checkFlackbotAi, saveAiSettings, useAiSettings, useAiStatus, useAiUsage, type AiSettings } from '../data/ai';
import { app } from '../firebase';
import { friendlyError } from '../lib/errors';
import { SparkleIcon } from './icons';
import styles from './FlackbotCard.module.css';

const modelGarden = (model: string) => `https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/${model}?project=${app.options.projectId ?? ''}`;

/** Admins: turn Ask Flackbot on, pick the model and set limits; see this month's cost. */
export function AskFlackbotCard() {
  const me = useMe();
  const saved = useAiSettings();
  const usage = useAiUsage();
  const status = useAiStatus();
  const [form, setForm] = useState<AiSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [check, setCheck] = useState<{ running: boolean; result?: { ok: boolean; error?: string } }>({ running: false });

  useEffect(() => {
    if (saved && !form) setForm(saved);
  }, [saved, form]);
  if (!form || !saved) return null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  const save = async (next: AiSettings) => {
    setBusy(true);
    setError(null);
    setNote(null);
    try {
      await saveAiSettings(me.id, next);
      setNote(next.enabled ? 'Saved. Everyone now sees Ask Flackbot.' : 'Saved.');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };
  const runCheck = async () => {
    setCheck({ running: true });
    try {
      setCheck({ running: false, result: await checkFlackbotAi() });
    } catch (err) {
      setCheck({ running: false, result: { ok: false, error: friendlyError(err) } });
    }
  };

  const spent = usage?.costUsd ?? 0;
  return (
    <section className={styles.card} aria-labelledby="ask-title" data-testid="ask-flackbot-card">
      <div className={styles.head}>
        <span className={styles.badge}>
          <SparkleIcon size={20} />
        </span>
        <div>
          <h2 id="ask-title">Ask Flackbot (AI)</h2>
          <p>
            People ask Flackbot questions about their team's conversations. It searches and reads only the channels and messages
            the person asking can see, and answers with links to them. It uses Claude on Vertex AI in this Google Cloud project,
            billed with the rest of Flack; messages go to the model only to answer the question.
          </p>
        </div>
        <label className={styles.switch}>
          <input
            type="checkbox"
            role="switch"
            checked={form.enabled}
            disabled={busy}
            onChange={(e) => {
              const next = { ...form, enabled: e.target.checked };
              setForm(next);
              void save(next);
            }}
            aria-label="Ask Flackbot on"
          />
          <span>{form.enabled ? 'On' : 'Off'}</span>
        </label>
      </div>

      <ol className={styles.steps}>
        <li>
          Enable <strong>{AI_MODELS.find((m) => m.id === form.model)?.label.replace(/ \(.*\)$/, '')}</strong> in Vertex AI Model Garden (once; Google asks you to
          accept Anthropic's terms):{' '}
          <a href={modelGarden(form.model)} target="_blank" rel="noreferrer">
            open Model Garden
          </a>
        </li>
        <li>
          <button className={styles.linkBtn} onClick={runCheck} disabled={check.running}>
            {check.running ? 'Checking…' : 'Check the connection'}
          </button>
          {check.result && (
            <span className={check.result.ok ? styles.ok : styles.bad} role="status" data-testid="ai-check">
              {check.result.ok ? ' ✓ Flackbot can reach Claude.' : ` ${check.result.error}`}
            </span>
          )}
          {!check.result && status?.error && <span className={styles.bad}> Last problem: {status.error}</span>}
        </li>
      </ol>

      <div className={styles.grid}>
        <label className="field">
          Model
          <select className="input" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value as AiSettings['model'] })}>
            {AI_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Questions per person per day
          <input className="input" type="number" min={1} max={500} value={form.dailyLimit} onChange={(e) => setForm({ ...form, dailyLimit: Math.round(Number(e.target.value) || AI_DEFAULTS.dailyLimit) })} />
        </label>
        <label className="field">
          Monthly budget (US$, 0 = no cap)
          <input className="input" type="number" min={0} max={10000} value={form.monthlyBudgetUsd} onChange={(e) => setForm({ ...form, monthlyBudgetUsd: Math.max(0, Math.round(Number(e.target.value) || 0)) })} />
        </label>
      </div>

      <p className={styles.muted} data-testid="ai-usage">
        This month: {usage?.questions ?? 0} question{usage?.questions === 1 ? '' : 's'}, about US${spent.toFixed(2)}
        {saved.monthlyBudgetUsd > 0 ? ` of US$${saved.monthlyBudgetUsd}` : ''}. A typical question costs 2–5¢ with Sonnet.
      </p>

      <div className={styles.actions}>
        <button className="btn btn-primary" disabled={!dirty || busy} onClick={() => void save(form)}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
      {note && !dirty && (
        <p className={styles.muted} role="status">
          {note}
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
