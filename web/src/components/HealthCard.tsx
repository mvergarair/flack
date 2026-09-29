import { FREE_READS_PER_DAY, FREE_WRITES_PER_DAY, LOAD_LABELS, p75, useDailyStats } from '../data/health';
import styles from './HealthCard.module.css';

const fmt = (n: number | null | undefined) => (n === null || n === undefined ? '—' : n.toLocaleString());

/** Admins: yesterday's health (from the daily snapshot) and a 7-day message trend. */
export function HealthCard() {
  const days = useDailyStats();
  if (!days) return null;
  const today = days[0];

  return (
    <section className={styles.card} aria-labelledby="health-title" data-testid="health-card">
      <header className={styles.head}>
        <h2 id="health-title">Health</h2>
        <span>{today ? `Last 24 hours, as of ${today.date} (updated daily)` : 'The first snapshot appears after the next daily run (04:30 UTC).'}</span>
      </header>
      {today && (
        <>
          <div className={styles.grid}>
            <Tile label="Messages" value={fmt(today.messages24h)} />
            <Tile label="Active this week" value={`${fmt(today.members.active7d)} of ${fmt(today.members.total)}`} />
            <Meter label="Database reads" value={today.gcp.reads} quota={FREE_READS_PER_DAY} />
            <Meter label="Database writes" value={today.gcp.writes} quota={FREE_WRITES_PER_DAY} />
            <Tile label="Function errors" value={fmt(today.gcp.errors)} warn={!!today.gcp.errors} />
            <Tile label="Function latency (p95)" value={today.gcp.p95Ms === null ? '—' : `${Math.round(today.gcp.p95Ms)} ms`} />
            <Tile label="Page load (p75)" value={(() => {
              const k = p75(today.pageLoad);
              return k ? LOAD_LABELS[k] : '—';
            })()} />
            <Tile label="Push-enabled people" value={fmt(today.pushUsers)} />
          </div>
          {today.gcp.reads === null && (
            <p className={styles.note}>
              Cloud metrics are unavailable: the functions' service account needs the <em>Monitoring Viewer</em> and <em>Error
              Reporting Viewer</em> roles.
            </p>
          )}
          {!!today.gcp.errorsByFunction?.length && (
            <p className={styles.note}>
              Errors by function: {today.gcp.errorsByFunction.map((e) => `${e.service} (${e.count})`).join(', ')}. Details in the Google
              Cloud console → Error Reporting.
            </p>
          )}
          <div className={styles.trend} aria-label="Messages per day, last 7 days">
            {[...days].reverse().map((d) => {
              const max = Math.max(1, ...days.map((x) => x.messages24h));
              return (
                <span key={d.date} title={`${d.date}: ${d.messages24h} messages`}>
                  <i style={{ height: `${Math.max(4, (d.messages24h / max) * 100)}%` }} />
                  <em>{d.date.slice(5)}</em>
                </span>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}

function Tile({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className={`${styles.tile} ${warn ? styles.warn : ''}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function Meter({ label, value, quota }: { label: string; value: number | null; quota: number }) {
  const pct = value === null ? null : Math.round((value / quota) * 100);
  return (
    <div className={`${styles.tile} ${pct !== null && pct >= 80 ? styles.warn : ''}`}>
      <span>{label}</span>
      <strong>{value === null ? '—' : `${value.toLocaleString()}`}</strong>
      <em className={styles.meter} aria-label={pct === null ? 'unknown' : `${pct}% of the free daily quota`}>
        <b style={{ width: `${Math.min(100, pct ?? 0)}%` }} />
      </em>
      <small>{pct === null ? 'free quota: unknown' : `${pct}% of the free daily quota`}</small>
    </div>
  );
}
