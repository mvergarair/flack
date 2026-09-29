// Coarse buckets for everything that leaves an install (see TELEMETRY.md): exact numbers stay
// in the install's own project; the shared report only says which range a value falls in.

export type SizeBucket = '0' | '1-10' | '11-50' | '51-100' | '101-500' | '500+';
export function sizeBucket(n: number): SizeBucket {
  if (n <= 0) return '0';
  if (n <= 10) return '1-10';
  if (n <= 50) return '11-50';
  if (n <= 100) return '51-100';
  if (n <= 500) return '101-500';
  return '500+';
}

export type VolumeBucket = '0' | '1-100' | '101-1000' | '1001-10000' | '10000+';
export function volumeBucket(n: number): VolumeBucket {
  if (n <= 0) return '0';
  if (n <= 100) return '1-100';
  if (n <= 1000) return '101-1000';
  if (n <= 10000) return '1001-10000';
  return '10000+';
}

/** Page load (largest contentful paint) histogram keys, in order. */
export const LOAD_KEYS = ['lt1s', 'lt2_5s', 'lt4s', 'gte4s'] as const;
export type LoadKey = (typeof LOAD_KEYS)[number];
export function loadKey(ms: number): LoadKey {
  if (ms < 1000) return 'lt1s';
  if (ms < 2500) return 'lt2_5s';
  if (ms < 4000) return 'lt4s';
  return 'gte4s';
}

/** The bucket containing the 75th percentile of a histogram (null without samples). */
export function p75(hist: Partial<Record<LoadKey, number>>): LoadKey | null {
  const total = LOAD_KEYS.reduce((s, k) => s + (hist[k] ?? 0), 0);
  if (!total) return null;
  let seen = 0;
  for (const k of LOAD_KEYS) {
    seen += hist[k] ?? 0;
    if (seen >= total * 0.75) return k;
  }
  return 'gte4s';
}

/** Share of a free daily quota, rounded to whole percent (null if unknown). */
export function pctOf(n: number | null, quota: number): number | null {
  return n === null ? null : Math.round((n / quota) * 100);
}

/** Firebase's free daily Firestore quotas (Blaze). */
export const FREE_READS_PER_DAY = 50_000;
export const FREE_WRITES_PER_DAY = 20_000;
