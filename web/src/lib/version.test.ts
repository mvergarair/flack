import { describe, expect, it } from 'vitest';
import { isNewer, parseVersion } from './version';

describe('versions', () => {
  it('parses plain versions with or without a v', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('10.0.1')).toEqual([10, 0, 1]);
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('v1.2.3-beta')).toBeNull();
  });
  it('compares numerically, part by part', () => {
    expect(isNewer('v1.1.0', '1.0.9')).toBe(true);
    expect(isNewer('v1.10.0', '1.9.0')).toBe(true);
    expect(isNewer('v2.0.0', '1.99.99')).toBe(true);
    expect(isNewer('v1.1.0', '1.1.0')).toBe(false);
    expect(isNewer('v1.0.0', '1.1.0')).toBe(false);
    expect(isNewer('nightly', '1.1.0')).toBe(false);
  });
});
