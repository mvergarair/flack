import { test, expect } from '../fixtures.ts';
import { emu, users, PASSWORD } from '../helpers.ts';

// The production build (emulator mode) served by `vite preview`, with the real service worker.
const PROD = 'http://127.0.0.1:5318';

test.describe('installable PWA', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'service worker checks run in Chromium');

  test('manifest and icons are valid @mobile', async ({ request }) => {
    const res = await request.get(`${PROD}/manifest.webmanifest`);
    expect(res.ok()).toBe(true);
    const m = await res.json();
    expect(m).toMatchObject({ name: 'Flack', short_name: 'Flack', display: 'standalone', start_url: '/' });
    for (const icon of m.icons) {
      const r = await request.get(`${PROD}${icon.src}`);
      expect(r.ok(), icon.src).toBe(true);
      expect(r.headers()['content-type']).toContain('image/png');
    }
    expect(m.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    expect((await request.get(`${PROD}/icons/apple-touch-icon.png`)).ok()).toBe(true);
  });

  test('the app shell loads offline once installed', async ({ page, context }) => {
    await page.goto(`${PROD}/login?memcache`);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.reload(); // now controlled by the service worker
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Sign in to Flack' })).toBeVisible();
    await page.goto(`${PROD}/invite/some-token`);
    await expect(page.getByRole('heading', { name: "You're invited" })).toBeVisible();
    await context.setOffline(false);
  });

  test('signed-in users see cached channels and messages while offline', async ({ page, context }) => {
    emu.seed({ demo: true });
    await page.goto(`${PROD}/login?next=%2Fc%2FcEngineering`);
    await page.getByLabel('Email').fill(users.member2);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('message-list')).toContainText('On it');
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await page.waitForTimeout(1500); // let IndexedDB persistence settle

    await context.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('channel-title')).toHaveText('engineering', { timeout: 20_000 });
    await expect(page.getByTestId('message-list')).toContainText('On it');
    await context.setOffline(false);
  });
});
