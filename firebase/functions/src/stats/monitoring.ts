// Last-24h metrics from Cloud Monitoring and Error Reporting, read with the functions' own
// service account. Best effort: anything the account can't read (or any API error) is null.
import { logger } from 'firebase-functions/v2';
import { app, projectId } from '../lib/admin.js';
import type { GcpMetrics } from './report.js';

const NONE: GcpMetrics = { reads: null, writes: null, deletes: null, requests: null, errors: null, p95Ms: null, errorsByFunction: null };

async function token(): Promise<string | null> {
  try {
    return (await app.options.credential?.getAccessToken())?.access_token ?? null;
  } catch {
    return null;
  }
}

async function getJson(url: string, auth: string): Promise<Record<string, unknown> | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${auth}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) {
    logger.warn('Metrics request failed', { status: res.status, api: new URL(url).host });
    return null;
  }
  return (await res.json()) as Record<string, unknown>;
}

interface Point {
  value: { int64Value?: string; doubleValue?: number };
}

async function series(auth: string, filter: string, aligner: string, reducer: string, start: Date, end: Date): Promise<number | null> {
  const q = new URLSearchParams({
    filter,
    'interval.startTime': start.toISOString(),
    'interval.endTime': end.toISOString(),
    'aggregation.alignmentPeriod': `${Math.round((end.getTime() - start.getTime()) / 1000)}s`,
    'aggregation.perSeriesAligner': aligner,
    'aggregation.crossSeriesReducer': reducer,
  });
  const json = await getJson(`https://monitoring.googleapis.com/v3/projects/${projectId}/timeSeries?${q}`, auth);
  if (!json) return null;
  const points = ((json.timeSeries as Array<{ points?: Point[] }> | undefined) ?? []).flatMap((s) => s.points ?? []);
  if (!points.length) return 0;
  const v = points[0].value;
  return v.doubleValue ?? Number(v.int64Value ?? 0);
}

export async function gcpMetrics(end = new Date()): Promise<GcpMetrics> {
  const auth = await token();
  if (!auth) return NONE;
  const start = new Date(end.getTime() - 86_400_000);
  const sum = (filter: string) => series(auth, filter, 'ALIGN_SUM', 'REDUCE_SUM', start, end).catch(() => null);
  const run = 'resource.type="cloud_run_revision"';
  const [reads, writes, deletes, requests, errors, p95Ms, errorsByFunction] = await Promise.all([
    sum('metric.type="firestore.googleapis.com/document/read_count"'),
    sum('metric.type="firestore.googleapis.com/document/write_count"'),
    sum('metric.type="firestore.googleapis.com/document/delete_count"'),
    sum(`metric.type="run.googleapis.com/request_count" AND ${run}`),
    sum(`metric.type="run.googleapis.com/request_count" AND ${run} AND metric.labels.response_code_class="5xx"`),
    series(auth, `metric.type="run.googleapis.com/request_latencies" AND ${run}`, 'ALIGN_DELTA', 'REDUCE_PERCENTILE_95', start, end).catch(() => null),
    errorGroups(auth).catch(() => null),
  ]);
  return { reads, writes, deletes, requests, errors, p95Ms, errorsByFunction };
}

/** Error Reporting groups from the last day, as counts per function (messages are never read). */
async function errorGroups(auth: string): Promise<{ service: string; count: number }[] | null> {
  const json = await getJson(
    `https://clouderrorreporting.googleapis.com/v1beta1/projects/${projectId}/groupStats?timeRange.period=PERIOD_1_DAY&pageSize=100`,
    auth,
  );
  if (!json) return null;
  const byService = new Map<string, number>();
  for (const g of (json.errorGroupStats as Array<{ count?: string; representative?: { serviceContext?: { service?: string } } }> | undefined) ?? []) {
    const service = g.representative?.serviceContext?.service ?? 'unknown';
    byService.set(service, (byService.get(service) ?? 0) + Number(g.count ?? 0));
  }
  return [...byService].map(([service, count]) => ({ service, count })).sort((a, b) => b.count - a.count);
}
