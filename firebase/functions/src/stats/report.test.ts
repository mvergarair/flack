import { describe, expect, it } from 'vitest';
import { buildReport, type Snapshot } from './report.js';

const snapshot = (extra: Partial<Snapshot> = {}): Snapshot => ({
  date: '2026-09-29',
  version: '1.5.0',
  members: { total: 23, active7d: 17 },
  channels: 9,
  messages24h: 412,
  apiTokens: 2,
  scheduled: 0,
  pushUsers: 11,
  customized: true,
  pageLoad: { lt1s: 40, lt2_5s: 12, lt4s: 2 },
  gcp: { reads: 21_000, writes: 3_100, deletes: 20, requests: 4_000, errors: 3, p95Ms: 812.4, errorsByFunction: [{ service: 'onmessagecreated', count: 3 }] },
  ...extra,
});

describe('the anonymous report', () => {
  it('turns the snapshot into buckets, flags and aggregate health', () => {
    expect(buildReport(snapshot(), '6f1c…', 'us-central1')).toEqual({
      schema: 1,
      installId: '6f1c…',
      date: '2026-09-29',
      version: '1.5.0',
      region: 'us-central1',
      size: { activeMembers7d: '11-50', members: '11-50', channels: '1-10' },
      activity: { messages24h: '101-1000' },
      features: { api: true, scheduling: false, customized: true, push: true },
      health: { functionRequests24h: '1001-10000', functionErrors24h: 3, errorsByFunction: [{ service: 'onmessagecreated', count: 3 }], functionP95Ms: 812, pageLoadP75: 'lt2_5s' },
      cost: { readsPctOfFree: 42, writesPctOfFree: 16 },
    });
  });

  it('never carries anything but Flack function names as free text', () => {
    const r = buildReport(
      snapshot({ gcp: { ...snapshot().gcp, errorsByFunction: [{ service: 'Error: message from Ana "secret plans"', count: 1 }, { service: 'api', count: 2 }] } }),
      'id',
      'us-central1',
    );
    expect(r.health.errorsByFunction).toEqual([{ service: 'api', count: 2 }]);
    // Every string in the report is one of the known fields.
    const strings: string[] = [];
    const walk = (v: unknown) => {
      if (typeof v === 'string') strings.push(v);
      else if (v && typeof v === 'object') Object.values(v).forEach(walk);
    };
    walk(r);
    expect(strings.sort()).toEqual(['1-10', '11-50', '11-50', '1001-10000', '101-1000', '1.5.0', '2026-09-29', 'api', 'id', 'lt2_5s', 'us-central1'].sort());
  });

  it('reports unknowns as null', () => {
    const r = buildReport(
      snapshot({ pageLoad: {}, gcp: { reads: null, writes: null, deletes: null, requests: null, errors: null, p95Ms: null, errorsByFunction: null } }),
      'id',
      'eu',
    );
    expect(r.health).toEqual({ functionRequests24h: null, functionErrors24h: null, errorsByFunction: null, functionP95Ms: null, pageLoadP75: null });
    expect(r.cost).toEqual({ readsPctOfFree: null, writesPctOfFree: null });
  });
});
