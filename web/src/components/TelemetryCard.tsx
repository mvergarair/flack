import { useEffect, useState } from 'react';
import { dismissTelemetryNotice, setTelemetryEnabled, useTelemetry } from '../data/health';
import { friendlyError } from '../lib/errors';
import { formatRelative } from '../lib/time';
import styles from './TelemetryCard.module.css';

export const TELEMETRY_DOCS = `https://github.com/${__FLACK_UPDATE_REPO__ || 'mvergarair/flack'}/blob/main/TELEMETRY.md`;

/** Admins: the anonymous usage statistics switch, and exactly what was last sent. */
export function TelemetryCard() {
  const t = useTelemetry();
  const [error, setError] = useState<string | null>(null);
  const [showing, setShowing] = useState(false);
  // Flip right away; the saved value takes over once it arrives (or we roll back on error).
  const [pending, setPending] = useState<boolean | null>(null);
  const saved = t ? t.enabled !== false && t.disabledBy !== 'env' : false;
  useEffect(() => {
    if (pending !== null && pending === saved) setPending(null);
  }, [pending, saved]);
  if (!t) return null;
  const on = pending ?? saved;

  const toggle = (enabled: boolean) => {
    setPending(enabled);
    setError(null);
    setTelemetryEnabled(enabled).catch((err) => {
      setPending(null);
      setError(friendlyError(err));
    });
  };

  return (
    <section className={styles.card} aria-labelledby="telemetry-title" data-testid="telemetry-card">
      <div className={styles.row}>
        <div>
          <h2 id="telemetry-title">Anonymous usage statistics</h2>
          <p>
            Once a day, Flack sends its maintainers a small anonymous report (version, size ranges, which features are used, error
            counts and speed) so they can see what to fix and improve. <strong>Never messages, names, emails, channel names,
            files or anything anyone wrote.</strong>{' '}
            <a href={TELEMETRY_DOCS} target="_blank" rel="noreferrer">
              What's collected and why
            </a>
          </p>
        </div>
        <label className={styles.switch}>
          <input type="checkbox" role="switch" checked={on} disabled={t.disabledBy === 'env'} onChange={(e) => toggle(e.target.checked)} aria-label="Share anonymous usage statistics" />
          <span>{on ? 'On' : 'Off'}</span>
        </label>
      </div>
      {t.disabledBy === 'env' && <p className={styles.muted}>Turned off for this install with FLACK_TELEMETRY=off.</p>}
      {on && (
        <p className={styles.muted}>
          {t.lastSentAt ? `Last sent ${formatRelative(t.lastSentAt)}.` : 'The first report goes out with the next daily run (04:30 UTC).'}{' '}
          {t.lastReport && (
            <button className={styles.link} onClick={() => setShowing((s) => !s)} aria-expanded={showing}>
              {showing ? 'Hide' : 'See exactly what was sent'}
            </button>
          )}
        </p>
      )}
      {showing && t.lastReport && (
        <pre className={styles.report} data-testid="telemetry-report">
          {JSON.stringify(t.lastReport, null, 2)}
        </pre>
      )}
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
    </section>
  );
}

/** One-time notice for admins after updating to a version with statistics on by default. */
export function TelemetryNotice() {
  const t = useTelemetry();
  if (!t || t.noticeSeen || t.enabled === false || t.disabledBy === 'env') return null;
  return (
    <div className={styles.notice} role="status" data-testid="telemetry-notice">
      <span>
        <strong>New:</strong> Flack now shares anonymous usage statistics with its maintainers: no messages, names or emails,
        ever. You can turn it off below.{' '}
        <a href={TELEMETRY_DOCS} target="_blank" rel="noreferrer">
          Details
        </a>
      </span>
      <span className={styles.noticeActions}>
        <button className="btn btn-ghost" onClick={() => setTelemetryEnabled(false).then(dismissTelemetryNotice)}>
          Turn off
        </button>
        <button className="btn" onClick={() => dismissTelemetryNotice()}>
          OK
        </button>
      </span>
    </div>
  );
}
