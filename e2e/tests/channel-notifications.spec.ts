import { test, expect } from '../fixtures.ts';
import type { Browser, Page } from '@playwright/test';
import { emu, signIn, users } from '../helpers.ts';

type Push = { uid: string; kind: string; title: string; body: string };
const pushesFor = (uid: string) => emu.query<Push>('_debug/pushes/items').filter((p) => p.uid === uid);

/** Signed-in user with push turned on (Notification API stubbed; see push.spec.ts). */
async function withPush(browser: Browser, email: string, path: string) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
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
  await page.getByTestId('user-menu').click();
  await page.getByTestId('dnd-menuitem').click();
  await page.getByRole('dialog').getByRole('button', { name: 'Turn on' }).click();
  await expect(page.getByTestId('push-status')).toHaveText('On');
  await page.keyboard.press('Escape');
  return { context, page };
}

async function setLevel(page: Page, label: RegExp) {
  await page.getByTestId('notify-button').click();
  await page.getByTestId('notify-level').getByLabel(label).check();
  await page.keyboard.press('Escape');
}

async function post(page: Page, text: string) {
  const box = page.getByTestId('composer').getByRole('textbox');
  await box.fill(text);
  await box.press('Enter');
}

test.describe('per-channel notification settings', () => {
  test.skip(({ browserName }) => browserName !== 'chromium', 'Chromium only');
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('"All new messages" pushes plain messages in that channel', async ({ browser, page }) => {
    const tomas = await withPush(browser, users.member2, '/c/cEngineering');
    await setLevel(tomas.page, /All new messages/);
    await expect(tomas.page.getByTestId('notify-button')).toHaveAttribute('data-level', 'all');
    await expect.poll(() => emu.get<{ level: string }>('users/uMember2/channelPrefs/cEngineering')?.level).toBe('all');
    await tomas.page.goto('/c/cGeneral?memcache'); // look elsewhere so the push isn't suppressed
    await expect(tomas.page.getByTestId('channel-title')).toHaveText('general');

    await signIn(page, users.admin, '/c/cEngineering');
    await post(page, 'deploy window moved to 3pm');
    await expect.poll(() => pushesFor('uMember2').map((p) => [p.kind, p.title, p.body]), { timeout: 30_000 }).toEqual([
      ['message', 'Ada Admin in #engineering', 'deploy window moved to 3pm'],
    ]);
    await tomas.context.close();
  });

  test('muting stops pushes (even mentions), keeps Activity, and dims the channel', async ({ browser, page }) => {
    const tomas = await withPush(browser, users.member2, '/c/cEngineering');
    await setLevel(tomas.page, /Nothing \(mute\)/);
    await expect(tomas.page.getByTestId('notify-button')).toHaveAttribute('data-level', 'none');
    await tomas.page.goto('/c/cGeneral?memcache');
    const eng = tomas.page.getByTestId('channel-list').getByRole('link', { name: /engineering/ });
    await expect(eng).toHaveAttribute('data-muted', 'true');

    await signIn(page, users.admin, '/c/cEngineering');
    const box = page.getByTestId('composer').getByRole('textbox');
    await box.pressSequentially('@Tom');
    await box.press('Enter');
    await box.pressSequentially('are you around?');
    await box.press('Enter');

    await expect
      .poll(() => emu.query<{ preview: string }>('users/uMember2/activity').some((a) => a.preview.includes('are you around?')), { timeout: 30_000 })
      .toBe(true);
    expect(pushesFor('uMember2')).toHaveLength(0);
    await expect(eng).not.toHaveAttribute('data-unread');
    await tomas.context.close();
  });

  test('DMs offer "all" or "mute"; picking the default clears the stored setting', async ({ page }) => {
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    await page.getByTestId('notify-button').click();
    const options = page.getByTestId('notify-level').getByRole('radio');
    await expect(options).toHaveCount(2);
    await page.getByTestId('notify-level').getByLabel(/Nothing \(mute\)/).check();
    await expect.poll(() => emu.get<{ level: string }>('users/uAdmin/channelPrefs/dm_uAdmin_uMember2')?.level).toBe('none');
    await page.getByTestId('notify-level').getByLabel(/All new messages/).check();
    await expect.poll(() => emu.get('users/uAdmin/channelPrefs/dm_uAdmin_uMember2')).toBeNull();
  });
});
