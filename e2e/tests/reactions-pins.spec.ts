import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const msg = (page: Page, text: string) => page.getByTestId('message-list').getByTestId('message').filter({ hasText: text });

async function openMore(page: Page, text: string) {
  const m = msg(page, text);
  await m.hover();
  await m.getByRole('button', { name: 'More actions' }).click();
  return m;
}

test.describe('reactions', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('quick reactions and chips toggle, live for everyone @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');

    const target = msg(page, 'Plan for today');
    await target.hover();
    await target.getByRole('button', { name: 'React with 👍' }).click();
    const chip = (p: Page) => msg(p, 'Plan for today').getByTestId('reactions').getByRole('button', { name: /^👍/ });
    await expect(chip(page)).toHaveAttribute('aria-pressed', 'true');
    await expect(chip(other.page)).toContainText('1');
    await expect(chip(other.page)).toHaveAttribute('aria-pressed', 'false');

    await chip(other.page).click();
    await expect(chip(page)).toContainText('2');
    await expect(chip(page)).toHaveAttribute('aria-label', /reacted by Tomás Araya and You|reacted by You and Tomás Araya/);

    await chip(page).click(); // toggle mine off
    await expect(chip(other.page)).toContainText('1');
    expect(emu.get<{ reactions: Record<string, string[]> }>('channels/cEngineering/messages/eng0')?.reactions).toEqual({ uAdmin: [], uMember2: ['👍'] });
    await other.context.close();
  });

  test('the picker adds any reaction', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const target = msg(page, 'On it');
    await target.hover();
    await target.getByRole('button', { name: 'Add reaction' }).first().click();
    await page.getByTestId('emoji-picker').getByLabel('Search emoji').fill('rocket');
    await page.getByTestId('emoji-picker').getByRole('option', { name: 'rocket' }).click();
    await expect(target.getByTestId('reactions')).toContainText('🚀');
  });

  test('quick reactions are customizable per user', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Edit profile' }).click();
    await page.getByRole('button', { name: /Quick reaction 1/ }).click();
    await page.getByTestId('emoji-picker').getByRole('option', { name: 'fire' }).click();
    await expect(page.getByTestId('quick-reactions')).toContainText('🔥');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => emu.get<{ quickReactions: string[] }>('users/uMember2')?.quickReactions).toEqual(['🔥', '✅', '👀']);

    const target = msg(page, 'Plan for today');
    await target.hover();
    await expect(target.getByRole('button', { name: 'React with 🔥' })).toBeVisible();
    await expect(target.getByRole('button', { name: 'React with 👍' })).toHaveCount(0);
  });
});

test.describe('overflow menu: mark unread and pins', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('mark unread keeps the channel unread until I leave it', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    await openMore(page, 'Plan for today');
    await page.getByRole('menuitem', { name: 'Mark unread' }).click();

    const eng = page.getByTestId('channel-list').getByRole('link', { name: /engineering/ });
    await expect(page.getByTestId('new-divider')).toBeVisible();
    await page.waitForTimeout(1500); // auto-read would normally fire by now
    await expect(eng).toHaveAttribute('data-unread', 'true');

    await page.getByTestId('channel-list').getByRole('link', { name: 'general' }).click();
    await expect(eng).toHaveAttribute('data-unread', 'true');
    await eng.click();
    await expect(page.getByTestId('new-divider')).toBeVisible();
    await expect(eng).not.toHaveAttribute('data-unread', { timeout: 10_000 });
  });

  test('pin and unpin; the pinned bar is shared and deleted messages drop out @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');

    await openMore(page, 'Plan for today');
    await page.getByRole('menuitem', { name: 'Pin to channel' }).click();
    await expect(page.getByTestId('pinned-bar')).toContainText('1 pinned message');
    await expect(msg(page, 'Plan for today').getByTestId('pinned-tag')).toBeVisible();
    await expect(other.page.getByTestId('pinned-bar')).toContainText('1 pinned message');

    await other.page.getByTestId('pinned-bar').click();
    const panel = other.page.getByTestId('pinned-panel');
    await expect(panel).toContainText('Plan for today');
    await panel.getByRole('button', { name: /Plan for today/ }).click();
    await expect(other.page).toHaveURL(/\?m=eng0/);

    await openMore(page, 'Plan for today');
    await page.getByRole('menuitem', { name: 'Unpin from channel' }).click();
    await expect(other.page.getByTestId('pinned-bar')).toHaveCount(0);

    // Pin my own message, then delete it: the function unpins it.
    const box = page.getByTestId('composer').getByRole('textbox');
    await box.fill('temporary announcement');
    await box.press('Enter');
    await expect(msg(page, 'temporary announcement')).not.toContainText('Sending…');
    await openMore(page, 'temporary announcement');
    await page.getByRole('menuitem', { name: 'Pin to channel' }).click();
    await expect(page.getByTestId('pinned-bar')).toBeVisible();
    const m = msg(page, 'temporary announcement');
    await m.hover();
    await m.getByRole('button', { name: 'Delete message' }).click();
    await m.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(page.getByTestId('pinned-bar')).toHaveCount(0, { timeout: 30_000 });
    await other.context.close();
  });
});

test.describe('last online', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('DM header shows Active now, then when they were last online', async ({ page, browser }) => {
    const other = await asUser(browser, users.member2, '/c/cGeneral');
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    await expect(page.getByTestId('last-online')).toHaveText('Active now');
    await other.context.close();
    await expect(page.getByTestId('last-online')).toHaveText('Last online just now', { timeout: 20_000 });

    // Also in the channel members list.
    await page.goto('/c/cEngineering?memcache');
    await page.getByRole('button', { name: /members/ }).click();
    await page.getByRole('tab', { name: /Members/ }).click();
    await expect(page.getByRole('dialog').getByRole('listitem').filter({ hasText: 'Tomás Araya' })).toContainText('Last online just now');
  });
});
