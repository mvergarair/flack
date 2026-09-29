import { describe, expect, it } from 'vitest';
import { loadKey, p75, pctOf, sizeBucket, volumeBucket } from './buckets.js';

describe('buckets', () => {
  it('bucket sizes and volumes', () => {
    expect([0, 1, 10, 11, 50, 51, 100, 101, 500, 501].map(sizeBucket)).toEqual(['0', '1-10', '1-10', '11-50', '11-50', '51-100', '51-100', '101-500', '101-500', '500+']);
    expect([0, 100, 101, 1000, 1001, 10001].map(volumeBucket)).toEqual(['0', '1-100', '101-1000', '101-1000', '1001-10000', '10000+']);
  });
  it('bucket page loads and find the p75', () => {
    expect([400, 1000, 2600, 9000].map(loadKey)).toEqual(['lt1s', 'lt2_5s', 'lt4s', 'gte4s']);
    expect(p75({})).toBeNull();
    expect(p75({ lt1s: 80, lt2_5s: 20 })).toBe('lt1s');
    expect(p75({ lt1s: 50, lt2_5s: 30, lt4s: 20 })).toBe('lt2_5s');
    expect(p75({ gte4s: 1 })).toBe('gte4s');
  });
  it('percent of quota', () => {
    expect(pctOf(25_000, 50_000)).toBe(50);
    expect(pctOf(null, 50_000)).toBeNull();
  });
});
