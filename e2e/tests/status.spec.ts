import { test, expect } from '../fixtures.ts';
import { asUser, emu, signIn, users } from '../helpers.ts';

test.describe('custom status', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('set from a preset; others see it on messages, DMs and members @cross', async ({ page, browser }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('status-menuitem').click();
    const dialog = page.getByRole('dialog', { name: 'Set a status' });
    await dialog.getByRole('listitem').filter({ hasText: 'On vacation' }).click();
    await expect(dialog.getByLabel('Status text')).toHaveValue('On vacation');
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => emu.get<{ customStatus: { emoji: string; text: string } }>('users/uMember2')?.customStatus).toMatchObject({
      emoji: '🌴',
      text: 'On vacation',
      expiresAt: null,
    });
    await expect(page.getByTestId('user-menu')).toContainText('🌴 On vacation');

    const admin = await asUser(browser, users.admin, '/c/cEngineering');
    const tomasMsg = admin.page.getByTestId('message-list').getByTestId('message').filter({ hasText: 'On it' });
    await expect(tomasMsg.getByTestId('status-emoji')).toHaveText('🌴');
    await expect(admin.page.getByTestId('dm-list').getByRole('link', { name: /Tomás Araya/ })).toContainText('🌴');
    await admin.page.getByTestId('dm-list').getByRole('link', { name: /Tomás Araya/ }).click();
    await expect(admin.page.getByTestId('last-online')).toContainText('🌴 On vacation');
    await admin.context.close();
  });

  test('custom text with "clear after", then clear it', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('status-menuitem').click();
    const dialog = page.getByRole('dialog', { name: 'Set a status' });
    await dialog.getByLabel('Status text').fill('Deep work, ping if urgent');
    await dialog.getByLabel('Clear after').selectOption('1h');
    await dialog.getByRole('button', { name: 'Save' }).click();
    const stored = () => emu.get<{ customStatus: { text: string; expiresAt: { _seconds: number } | null } | null }>('users/uMember')?.customStatus;
    await expect.poll(() => stored()?.text).toBe('Deep work, ping if urgent');
    const expires = stored()!.expiresAt!._seconds * 1000;
    expect(expires - Date.now()).toBeGreaterThan(55 * 60_000);
    expect(expires - Date.now()).toBeLessThan(61 * 60_000);

    await page.getByTestId('user-menu').click();
    await page.getByTestId('status-menuitem').click();
    await page.getByRole('dialog', { name: 'Set a status' }).getByRole('button', { name: 'Clear status' }).click();
    await expect.poll(() => stored()).toBeNull();
    await expect(page.getByTestId('user-menu')).not.toContainText('Deep work');
  });

  test('expired statuses are hidden', async ({ page }) => {
    emu.set('users/uMember2', { customStatus: { emoji: '📅', text: 'In a meeting', expiresAt: { __ts: Date.now() - 60_000 } } });
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    await expect(page.getByTestId('channel-title')).toHaveText('Tomás Araya');
    await expect(page.getByTestId('dm-list').getByTestId('status-emoji')).toHaveCount(0);
    await expect(page.getByText('In a meeting')).toHaveCount(0);
  });
});
