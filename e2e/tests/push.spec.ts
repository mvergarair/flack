import { test, expect, type Browser } from '@playwright/test';
import { emu, signIn, users } from '../helpers.ts';

type Push = { uid: string; kind: string; title: string; body: string; link: string };
const pushes = () => emu.query<Push>('_debug/pushes/items');

async function withNotifications(browser: Browser, email: string, path = '/') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  // Headless Chromium always reports notifications as denied; stand in for the browser's
  // permission prompt (the rest of the flow — token, storage, function — is real).
  await context.addInitScript(() => {
    const KEY = 'test:notificationPermission';
    Object.defineProperty(Notification, 'permission', { get: () => (localStorage.getItem(KEY) as NotificationPermission) ?? 'default' });
    Notification.requestPermission = async () => {
      localStorage.setItem(KEY, 'granted');
      return 'granted';
    };
  });
  const page = await context.newPage();
  await signIn(page, email, path);
  return { context, page };
}

test.describe('push notifications', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('turning notifications on registers this device; DMs and mentions are pushed', async ({ browser, page }) => {
    test.skip(test.info().project.name !== 'chromium', 'uses Chromium permission grants');
    const tomas = await withNotifications(browser, users.member2, '/c/cGeneral');
    await tomas.page.getByTestId('user-menu').click();
    await tomas.page.getByTestId('dnd-menuitem').click();
    await tomas.page.getByRole('dialog').getByRole('button', { name: 'Turn on' }).click();
    await expect(tomas.page.getByTestId('push-status')).toHaveText('On');
    await expect.poll(() => Object.keys(emu.get<{ tokens: object }>('users/uMember2/private/tokens')?.tokens ?? {})).toEqual([expect.stringMatching(/^emulator-/)]);
    await tomas.page.keyboard.press('Escape');

    // A DM while Tomás is looking at #general → pushed.
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    const box = page.getByTestId('composer').getByRole('textbox');
    await box.fill('quick question about **the deploy**');
    await box.press('Enter');
    await expect.poll(() => pushes().filter((p) => p.uid === 'uMember2'), { timeout: 30_000 }).toHaveLength(1);
    expect(pushes()[0]).toMatchObject({ kind: 'dm', title: 'Ada Admin', body: 'quick question about the deploy' });
    expect(pushes()[0].link).toMatch(/\/c\/dm_uAdmin_uMember2\?m=/);

    // Nothing is pushed for the conversation Tomás has open.
    await tomas.page.goto('/c/dm_uAdmin_uMember2?memcache');
    await expect(tomas.page.getByTestId('channel-title')).toHaveText('Ada Admin');
    await tomas.page.waitForTimeout(1500);
    await box.fill('are you there?');
    await box.press('Enter');
    await page.waitForTimeout(4000);
    expect(pushes().filter((p) => p.body === 'are you there?')).toHaveLength(0);

    // Mentions in channels are pushed with context.
    await tomas.page.goto('/c/cGeneral?memcache');
    await expect(tomas.page.getByTestId('channel-title')).toHaveText('general');
    await tomas.page.waitForTimeout(1500);
    await page.goto('/c/cEngineering?memcache');
    const eng = page.getByTestId('composer').getByRole('textbox');
    await eng.pressSequentially('@Tom');
    await eng.press('Enter');
    await eng.pressSequentially('can you look?');
    await eng.press('Enter');
    await expect
      .poll(() => pushes().find((p) => p.body.includes('can you look?'))?.title, { timeout: 30_000 })
      .toBe('Ada Admin mentioned you in #engineering');

    // Turning it off removes the device.
    await tomas.page.getByTestId('user-menu').click();
    await tomas.page.getByTestId('dnd-menuitem').click();
    await tomas.page.getByRole('dialog').getByRole('button', { name: 'Turn off' }).click();
    await expect(tomas.page.getByTestId('push-status')).toHaveText('Off');
    await expect.poll(() => Object.keys(emu.get<{ tokens: object }>('users/uMember2/private/tokens')?.tokens ?? {})).toEqual([]);
    await tomas.context.close();
  });

  test('people without a registered device get no push', async ({ page }) => {
    test.skip(test.info().project.name !== 'chromium', 'chromium only');
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    const box = page.getByTestId('composer').getByRole('textbox');
    await box.fill('nobody will be pinged');
    await box.press('Enter');
    await page.waitForTimeout(4000);
    expect(pushes()).toHaveLength(0);
  });

  test('iPhone in Safari: asked to add to Home Screen first @mobile', async ({ page }) => {
    test.skip(test.info().project.name !== 'iphone', 'iPhone only');
    await signIn(page, users.member2);
    await expect(page.getByTestId('push-prompt')).toContainText('Add Flack to your Home Screen');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('dnd-menuitem').click();
    await expect(page.getByTestId('push-install-hint')).toContainText('Add to Home Screen');
  });
});
