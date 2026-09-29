import { defineConfig, devices } from '@playwright/test';

// Runs against the Emulator Suite (started by `npm run e2e` via emulators:exec) and the
// Vite dev server in emulator mode. Specs share one emulator, so they run serially.
export default defineConfig({
  testDir: './tests',
  globalSetup: './global-setup.ts',
  outputDir: './artifacts/results',
  fullyParallel: false,
  workers: 1,
  // One retry on CI runners (slower, shared machines); a test that needs it shows as flaky.
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { outputFolder: './artifacts/report', open: 'never' }]],
  use: {
    baseURL: 'http://127.0.0.1:5317',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], viewport: { width: 1280, height: 800 } }, grep: /@cross/ },
    { name: 'iphone', use: { ...devices['iPhone 13'] }, grep: /@mobile/ },
    { name: 'pixel', use: { ...devices['Pixel 7'] }, grep: /@mobile/ },
  ],
  webServer: [
    {
      command: 'npm run dev -w web',
      cwd: '..',
      url: 'http://127.0.0.1:5317',
      reuseExistingServer: true,
      env: { VITE_USE_EMULATORS: 'true' },
      timeout: 60_000,
    },
    {
      // Production build in emulator mode: real service worker + precache, for the PWA spec.
      command: 'npm run build:emu -w web && npm run preview:emu -w web',
      cwd: '..',
      url: 'http://127.0.0.1:5318',
      reuseExistingServer: true,
      timeout: 180_000,
    },
  ],
});
