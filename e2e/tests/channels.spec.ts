import { test, expect } from '../fixtures.ts';
import type { Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const sidebarChannels = (page: Page) => page.getByTestId('channel-list');

async function createChannel(page: Page, name: string, opts: { private?: boolean; members?: string[]; topic?: string } = {}) {
  await page.getByRole('button', { name: 'Add channel' }).click();
  const dialog = page.getByRole('dialog', { name: 'Create a channel' });
  await dialog.getByLabel('Name').fill(name);
  if (opts.topic) await dialog.getByLabel(/Topic/).fill(opts.topic);
  if (opts.private) {
    await dialog.getByText('Make private').click();
    for (const m of opts.members ?? []) {
      await dialog.getByPlaceholder('Search by name or email').fill(m);
      await dialog.getByRole('option').first().click();
    }
  }
  await dialog.getByRole('button', { name: 'Create' }).click();
}

test.describe('channels', () => {
  test.beforeEach(() => {
    emu.seed();
  });

  test('create a public channel; others browse and join it @cross', async ({ page, browser }) => {
    await signIn(page, users.member);
    await createChannel(page, 'My Design Room', { topic: 'Pixels' });
    await expect(page.getByTestId('channel-title')).toHaveText('my-design-room');
    await expect(sidebarChannels(page).getByRole('link', { name: 'my-design-room' })).toBeVisible();

    const other = await asUser(browser, users.member2);
    await expect(sidebarChannels(other.page).getByRole('link', { name: 'my-design-room' })).toHaveCount(0);
    await other.page.getByRole('button', { name: 'Browse channels' }).click();
    const dialog = other.page.getByRole('dialog', { name: 'Browse channels' });
    const row = dialog.getByRole('listitem').filter({ hasText: 'my-design-room' });
    await expect(row).toContainText('1 member');
    await row.getByRole('button', { name: 'Join' }).click();
    await expect(other.page.getByTestId('channel-title')).toHaveText('my-design-room');
    await expect(sidebarChannels(other.page).getByRole('link', { name: 'my-design-room' })).toBeVisible();

    // Member count updates live for the creator.
    await expect(page.getByRole('button', { name: '2 members' })).toBeVisible();
    await other.context.close();
  });

  test('private channels are visible only to their members', async ({ page, browser }) => {
    await signIn(page, users.member);
    await createChannel(page, 'secret-plans', { private: true, members: ['Tomás'] });
    await expect(page.getByTestId('channel-title')).toHaveText('secret-plans');

    const invited = await asUser(browser, users.member2);
    await expect(sidebarChannels(invited.page).getByRole('link', { name: 'secret-plans' })).toBeVisible();
    await invited.context.close();

    const admin = await asUser(browser, users.admin);
    await expect(sidebarChannels(admin.page).getByRole('link', { name: 'secret-plans' })).toHaveCount(0);
    await admin.page.getByRole('button', { name: 'Browse channels' }).click();
    await expect(admin.page.getByRole('dialog', { name: 'Browse channels' })).not.toContainText('secret-plans');
    await admin.page.goto('/c/' + (await page.url().split('/c/')[1]) + '?memcache');
    await expect(admin.page.getByText('Page not found')).toBeVisible();
    await admin.context.close();
  });

  test('the creator renames and sets the topic; everyone sees it', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');

    await page.getByRole('button', { name: /Channel details for engineering/ }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('eng');
    await dialog.getByLabel('Topic').fill('Ship it');
    await dialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('eng');
    await expect(other.page.getByTestId('channel-title')).toHaveText('eng');
    await expect(other.page.getByText('Ship it').first()).toBeVisible();

    // A non-creator member sees the settings read-only.
    await other.page.getByRole('button', { name: /Channel details for eng/ }).click();
    await expect(other.page.getByRole('dialog').getByLabel('Name')).toBeDisabled();
    await expect(other.page.getByRole('dialog').getByRole('button', { name: 'Save changes' })).toHaveCount(0);
    await other.context.close();
  });

  test('archiving hides the channel from the sidebar and browse list', async ({ page }) => {
    await signIn(page, users.admin, '/c/cRandom');
    await page.getByRole('button', { name: /Channel details for random/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Archive channel' }).click();
    await expect(sidebarChannels(page).getByRole('link', { name: 'random' })).toHaveCount(0);
    await expect(page.getByText('Archived', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Browse channels' }).click();
    await expect(page.getByRole('dialog', { name: 'Browse channels' })).not.toContainText('random');
  });

  test('leaving a channel removes it from the sidebar', async ({ page }) => {
    await signIn(page, users.member, '/c/cRandom');
    await page.getByRole('button', { name: /Channel details for random/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Leave channel' }).click();
    await expect(sidebarChannels(page).getByRole('link', { name: 'random' })).toHaveCount(0);
    expect(emu.get<{ memberIds: string[] }>('channels/cRandom')?.memberIds).not.toContain('uMember');
  });

  test('phone: home lists channels, tapping opens one, back returns @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member);
    await expect(page.getByRole('navigation', { name: 'Main' })).toBeVisible();
    await sidebarChannels(page).getByRole('link', { name: 'general' }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await expect(page.getByRole('navigation', { name: 'Main' })).toHaveCount(0);
    await page.getByRole('link', { name: 'Back' }).click();
    await expect(sidebarChannels(page)).toBeVisible();
  });
});
