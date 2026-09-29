import { describe, expect, it } from 'vitest';
import { aggregate } from './aggregate.js';
import { validateReport, type Report } from './validate.js';

const NOW = new Date('2026-09-29T05:00:00Z');
const report = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  schema: 1,
  installId: '6f1c2a9e-3b7d-4c1a-9e2f-0a1b2c3d4e5f',
  date: '2026-09-29',
  version: '1.5.0',
  region: 'us-central1',
  size: { activeMembers7d: '11-50', members: '11-50', channels: '1-10' },
  activity: { messages24h: '101-1000' },
  features: { api: true, scheduling: false, customized: true, push: true },
  health: { functionRequests24h: '1001-10000', functionErrors24h: 3, errorsByFunction: [{ service: 'api', count: 3 }], functionP95Ms: 812, pageLoadP75: 'lt1s' },
  cost: { readsPctOfFree: 42, writesPctOfFree: 16 },
  ...extra,
});

describe('validateReport', () => {
  it('accepts exactly schema 1 from today or yesterday', () => {
    expect(validateReport(report(), NOW)).not.toBeNull();
    expect(validateReport(report({ date: '2026-09-28' }), NOW)).not.toBeNull();
    expect(validateReport(report({ date: '2026-09-20' }), NOW)).toBeNull();
    expect(validateReport(report({ region: 'unknown' }), NOW)).not.toBeNull();
  });

  it('rejects anything extra or free-form, so nothing else can be stored', () => {
    const bad = [
      report({ email: 'a@b.co' }),
      report({ schema: 2 }),
      report({ installId: 'acme-corp' }),
      report({ version: '1.5.0; drop' }),
      report({ region: 'Acme HQ' }),
      report({ size: { activeMembers7d: '17', members: '11-50', channels: '1-10' } }),
      report({ size: { activeMembers7d: '11-50', members: '11-50', channels: '1-10', names: ['Ana'] } }),
      report({ features: { api: 'yes', scheduling: false, customized: true, push: true } }),
      report({ health: { ...(report().health as object), errorsByFunction: [{ service: 'Error: Ana said hi', count: 1 }] } }),
      report({ health: { ...(report().health as object), functionErrors24h: -1 } }),
      report({ cost: { readsPctOfFree: 'lots', writesPctOfFree: 1 } }),
      null,
      'hello',
    ];
    for (const b of bad) expect(validateReport(b, NOW)).toBeNull();
  });
});

describe('aggregate', () => {
  it('computes public numbers from the latest report of each install', () => {
    const a = validateReport(report(), NOW)!;
    const b = validateReport(
      report({
        installId: '7f1c2a9e-3b7d-4c1a-9e2f-0a1b2c3d4e5f',
        version: '1.4.1',
        features: { api: false, scheduling: true, customized: false, push: true },
        health: { functionRequests24h: null, functionErrors24h: 0, errorsByFunction: [], functionP95Ms: 400, pageLoadP75: null },
        cost: { readsPctOfFree: 120, writesPctOfFree: 10 },
      }),
      NOW,
    )!;
    const s = aggregate([a, b] as Report[], [{ date: '2026-09-29', installs30d: 2 }], NOW);
    expect(s).toMatchObject({
      installs30d: 2,
      versions: { '1.5.0': 1, '1.4.1': 1 },
      teamSize: { '11-50': 2 },
      features: { api: 50, scheduling: 50, customized: 50, push: 100 },
      health: { installsWithErrorsPct: 50, medianFunctionP95Ms: 606, pageLoadP75: { lt1s: 1 } },
      cost: { medianReadsPctOfFree: 81, installsOverFreeReadsPct: 50 },
    });
    // No install ids in the public numbers.
    expect(JSON.stringify(s)).not.toContain('6f1c2a9e');
  });

  it('handles no installs', () => {
    expect(aggregate([], [], NOW)).toMatchObject({ installs30d: 0, health: { installsWithErrorsPct: null, medianFunctionP95Ms: null } });
  });
});
