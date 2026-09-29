// Public aggregate statistics from the latest report of each install seen in the last 30 days.
import type { Report } from './validate.js';

export interface PublicStats {
  updatedAt: string;
  installs30d: number;
  versions: Record<string, number>;
  regions: Record<string, number>;
  teamSize: Record<string, number>;
  messagesPerDay: Record<string, number>;
  /** Share of installs (0–100) using each feature. */
  features: Record<'api' | 'scheduling' | 'customized' | 'push', number>;
  health: { installsWithErrorsPct: number | null; medianFunctionP95Ms: number | null; pageLoadP75: Record<string, number> };
  cost: { medianReadsPctOfFree: number | null; installsOverFreeReadsPct: number | null };
  /** Installs active in the 30 days up to each date (oldest first). */
  history: { date: string; installs30d: number }[];
}

const tally = (values: string[]) => values.reduce<Record<string, number>>((acc, v) => ((acc[v] = (acc[v] ?? 0) + 1), acc), {});
const pct = (n: number, total: number) => (total ? Math.round((n / total) * 100) : 0);
function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

export function aggregate(latest: Report[], history: { date: string; installs30d: number }[], now = new Date()): PublicStats {
  const n = latest.length;
  const withHealth = latest.filter((r) => r.health.functionErrors24h !== null);
  const reads = latest.map((r) => r.cost.readsPctOfFree).filter((x): x is number => x !== null);
  return {
    updatedAt: now.toISOString(),
    installs30d: n,
    versions: tally(latest.map((r) => r.version)),
    regions: tally(latest.map((r) => r.region)),
    teamSize: tally(latest.map((r) => r.size.activeMembers7d)),
    messagesPerDay: tally(latest.map((r) => r.activity.messages24h)),
    features: {
      api: pct(latest.filter((r) => r.features.api).length, n),
      scheduling: pct(latest.filter((r) => r.features.scheduling).length, n),
      customized: pct(latest.filter((r) => r.features.customized).length, n),
      push: pct(latest.filter((r) => r.features.push).length, n),
    },
    health: {
      installsWithErrorsPct: withHealth.length ? pct(withHealth.filter((r) => (r.health.functionErrors24h ?? 0) > 0).length, withHealth.length) : null,
      medianFunctionP95Ms: median(latest.map((r) => r.health.functionP95Ms).filter((x): x is number => x !== null)),
      pageLoadP75: tally(latest.map((r) => r.health.pageLoadP75).filter((x): x is string => x !== null)),
    },
    cost: {
      medianReadsPctOfFree: median(reads),
      installsOverFreeReadsPct: reads.length ? pct(reads.filter((x) => x > 100).length, reads.length) : null,
    },
    history,
  };
}
