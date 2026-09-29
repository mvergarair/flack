// Strict validation of anonymous reports from Flack installs (schema 1, see TELEMETRY.md and
// firebase/functions/src/stats/report.ts). Anything unexpected — an extra field, free text, a
// wrong type — rejects the whole report, so nothing else can ever be stored.

export interface Report {
  schema: 1;
  installId: string;
  date: string;
  version: string;
  region: string;
  size: { activeMembers7d: string; members: string; channels: string };
  activity: { messages24h: string };
  features: { api: boolean; scheduling: boolean; customized: boolean; push: boolean };
  health: {
    functionRequests24h: string | null;
    functionErrors24h: number | null;
    errorsByFunction: { service: string; count: number }[] | null;
    functionP95Ms: number | null;
    pageLoadP75: string | null;
  };
  cost: { readsPctOfFree: number | null; writesPctOfFree: number | null };
}

const SIZE = ['0', '1-10', '11-50', '51-100', '101-500', '500+'];
const VOLUME = ['0', '1-100', '101-1000', '1001-10000', '10000+'];
const LOAD = ['lt1s', 'lt2_5s', 'lt4s', 'gte4s'];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (o: Obj, allowed: string[]) => Object.keys(o).length === allowed.length && allowed.every((k) => k in o);
const oneOf = (v: unknown, list: string[]) => typeof v === 'string' && list.includes(v);
const count = (v: unknown, max = 1e9) => typeof v === 'number' && Number.isInteger(v) && v >= 0 && v <= max;
const orNull = (v: unknown, test: (x: unknown) => boolean) => v === null || test(v);

/** The report if it's exactly schema 1 and dated today or yesterday (UTC); otherwise null. */
export function validateReport(body: unknown, now = new Date()): Report | null {
  if (!isObj(body) || !keys(body, ['schema', 'installId', 'date', 'version', 'region', 'size', 'activity', 'features', 'health', 'cost'])) return null;
  const b = body;
  if (b.schema !== 1) return null;
  if (typeof b.installId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(b.installId)) return null;
  const today = now.toISOString().slice(0, 10);
  const yesterday = new Date(now.getTime() - 86_400_000).toISOString().slice(0, 10);
  if (b.date !== today && b.date !== yesterday) return null;
  if (typeof b.version !== 'string' || !/^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(b.version)) return null;
  if (typeof b.region !== 'string' || !/^([a-z]+-[a-z]+\d{1,2}|unknown)$/.test(b.region)) return null;

  const { size, activity, features, health, cost } = b;
  if (!isObj(size) || !keys(size, ['activeMembers7d', 'members', 'channels']) || !Object.values(size).every((v) => oneOf(v, SIZE))) return null;
  if (!isObj(activity) || !keys(activity, ['messages24h']) || !oneOf(activity.messages24h, VOLUME)) return null;
  if (!isObj(features) || !keys(features, ['api', 'scheduling', 'customized', 'push']) || !Object.values(features).every((v) => typeof v === 'boolean')) return null;
  if (!isObj(health) || !keys(health, ['functionRequests24h', 'functionErrors24h', 'errorsByFunction', 'functionP95Ms', 'pageLoadP75'])) return null;
  if (!orNull(health.functionRequests24h, (v) => oneOf(v, VOLUME))) return null;
  if (!orNull(health.functionErrors24h, (v) => count(v))) return null;
  if (!orNull(health.functionP95Ms, (v) => count(v, 600_000))) return null;
  if (!orNull(health.pageLoadP75, (v) => oneOf(v, LOAD))) return null;
  if (
    !orNull(
      health.errorsByFunction,
      (v) =>
        Array.isArray(v) &&
        v.length <= 20 &&
        v.every((e) => isObj(e) && keys(e, ['service', 'count']) && typeof e.service === 'string' && /^[a-z]{3,40}$/.test(e.service) && count(e.count)),
    )
  ) {
    return null;
  }
  if (!isObj(cost) || !keys(cost, ['readsPctOfFree', 'writesPctOfFree']) || !Object.values(cost).every((v) => orNull(v, (x) => count(x, 1_000_000)))) return null;
  return body as unknown as Report;
}
