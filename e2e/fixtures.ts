import { test as base, expect } from '@playwright/test';

/**
 * Every spec imports `test` from here instead of '@playwright/test'. It adds one automatic check:
 * after each test, the page must not have tripped the app's runaway-listener tripwire
 * (web/src/lib/listenerWatch.ts), which catches effects that write what they watch, a bug that
 * works fine on screen while burning database reads.
 */
export const test = base.extend<{ loopGuard: void }>({
  loopGuard: [
    async ({ page }, use) => {
      await use();
      const loops = await page.evaluate(() => window.__flackLoops ?? []).catch(() => [] as string[]);
      expect(loops, `Runaway listeners (fired over and over) on: ${loops.join(', ')}`).toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };

declare global {
  interface Window {
    __flackLoops?: string[];
  }
}
