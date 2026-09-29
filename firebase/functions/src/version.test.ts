import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { FLACK_VERSION } from './version.js';

describe('version.ts', () => {
  it('matches the root package.json (run the functions build to update it)', () => {
    const { version } = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8')) as { version: string };
    expect(FLACK_VERSION).toBe(version);
  });
});
