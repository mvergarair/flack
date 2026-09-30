import { test, expect } from '../fixtures.ts';
import { asUser, emu, signIn, users } from '../helpers.ts';

test.describe('keyboard shortcuts', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('⌘K / Ctrl+K opens Search; arrows + Enter open a channel @cross', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    // Headless WebKit only moves DOM focus once its window is frontmost.
    await page.bringToFront();
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByPlaceholder('Search messages, channels and people')).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await expect(page).toHaveURL(/\/search$/);
    await page.keyboard.type('rand');
    await expect(page.getByTestId('quick-channels')).toContainText('random');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await expect(page.getByTestId('channel-title')).toHaveText('random');
  });

  test('⌥↑/⌥↓ move through channels in sidebar order, even from the composer', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await page.getByTestId('composer').getByRole('textbox').click();
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await page.keyboard.press('Alt+ArrowDown');
    await expect(page.getByTestId('channel-title')).toHaveText('history');
    await page.keyboard.press('Alt+ArrowUp');
    await page.keyboard.press('Alt+ArrowUp');
    await expect(page.getByTestId('channel-title')).toHaveText('engineering');
  });

  test('⌥⇧↑/⌥⇧↓ jump between unread channels', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cRandom');
    const box = other.page.getByTestId('composer').getByRole('textbox');
    await box.fill('unread in random');
    await box.press('Enter');
    await other.page.getByTestId('channel-list').getByRole('link', { name: 'general' }).click();
    await expect(other.page.getByTestId('channel-title')).toHaveText('general');
    await other.page.getByTestId('composer').getByRole('textbox').fill('unread in general');
    await other.page.getByTestId('composer').getByRole('textbox').press('Enter');
    await expect(page.getByTestId('channel-list').getByRole('link', { name: 'random' })).toHaveAttribute('data-unread', 'true');
    await expect(page.getByTestId('channel-list').getByRole('link', { name: 'general' })).toHaveAttribute('data-unread', 'true');

    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await page.keyboard.press('Alt+Shift+ArrowDown');
    await expect(page.getByTestId('channel-title')).toHaveText('random');
    await other.context.close();
  });
});
