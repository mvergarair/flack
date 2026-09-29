// The daily snapshot kept in each install (stats/{date}, admins only) and the anonymous report
// derived from it for the Flack maintainers (TELEMETRY.md). The report is built field by field
// from buckets and flags: nothing from messages, people or channels can end up in it.
import { FREE_READS_PER_DAY, FREE_WRITES_PER_DAY, p75, pctOf, sizeBucket, volumeBucket, type LoadKey, type SizeBucket, type VolumeBucket } from './buckets.js';

/** Metrics from Google Cloud for the last 24 hours (null when unavailable). */
export interface GcpMetrics {
  reads: number | null;
  writes: number | null;
  deletes: number | null;
  requests: number | null;
  errors: number | null;
  p95Ms: number | null;
  /** Error Reporting groups per function (counts only, never messages). */
  errorsByFunction: { service: string; count: number }[] | null;
}

/** Everything the install records about a day, for its own admins. */
export interface Snapshot {
  date: string;
  version: string;
  members: { total: number; active7d: number };
  channels: number;
  messages24h: number;
  apiTokens: number;
  scheduled: number;
  pushUsers: number;
  customized: boolean;
  pageLoad: Partial<Record<LoadKey, number>>;
  gcp: GcpMetrics;
}

export const REPORT_SCHEMA = 1;

/** What the maintainers receive: buckets, flags and aggregate health, nothing else. */
export interface Report {
  schema: typeof REPORT_SCHEMA;
  installId: string;
  date: string;
  version: string;
  region: string;
  size: { activeMembers7d: SizeBucket; members: SizeBucket; channels: SizeBucket };
  activity: { messages24h: VolumeBucket };
  features: { api: boolean; scheduling: boolean; customized: boolean; push: boolean };
  health: {
    functionRequests24h: VolumeBucket | null;
    functionErrors24h: number | null;
    errorsByFunction: { service: string; count: number }[] | null;
    functionP95Ms: number | null;
    pageLoadP75: LoadKey | null;
  };
  cost: { readsPctOfFree: number | null; writesPctOfFree: number | null };
}

/** Function names are the only strings from the install that appear, and only Flack's own. */
const FUNCTION_NAME = /^[a-z]{3,40}$/;

export function buildReport(s: Snapshot, installId: string, region: string): Report {
  return {
    schema: REPORT_SCHEMA,
    installId,
    date: s.date,
    version: s.version,
    region,
    size: { activeMembers7d: sizeBucket(s.members.active7d), members: sizeBucket(s.members.total), channels: sizeBucket(s.channels) },
    activity: { messages24h: volumeBucket(s.messages24h) },
    features: { api: s.apiTokens > 0, scheduling: s.scheduled > 0, customized: s.customized, push: s.pushUsers > 0 },
    health: {
      functionRequests24h: s.gcp.requests === null ? null : volumeBucket(s.gcp.requests),
      functionErrors24h: s.gcp.errors,
      errorsByFunction: s.gcp.errorsByFunction
        ? s.gcp.errorsByFunction.filter((e) => FUNCTION_NAME.test(e.service)).slice(0, 20).map((e) => ({ service: e.service, count: Math.round(e.count) }))
        : null,
      functionP95Ms: s.gcp.p95Ms === null ? null : Math.round(s.gcp.p95Ms),
      pageLoadP75: p75(s.pageLoad),
    },
    cost: { readsPctOfFree: pctOf(s.gcp.reads, FREE_READS_PER_DAY), writesPctOfFree: pctOf(s.gcp.writes, FREE_WRITES_PER_DAY) },
  };
}
