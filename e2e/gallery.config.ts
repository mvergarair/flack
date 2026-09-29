import { defineConfig } from '@playwright/test';
import base from './playwright.config.ts';

// `npx playwright test -c gallery.config.ts` — captures docs/screenshots/*.png for review.
export default defineConfig({
  ...base,
  testDir: './gallery',
  projects: [{ name: 'gallery', use: { browserName: 'chromium' } }],
  reporter: [['list']],
});
