import { test, expect } from '../fixtures.ts';
import { emu, signIn, users } from '../helpers.ts';

test.describe('search', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true, historyCount: 200 });
  });

  test('⌘K search: highlighted message results, jump to the message @cross', async ({ page }) => {
    await signIn(page, users.member2, '/c/cGeneral');
    await page.bringToFront();
    await expect(async () => {
      await page.keyboard.press('ControlOrMeta+k');
      await expect(page.getByPlaceholder('Search messages, channels and people')).toBeFocused({ timeout: 1000 });
    }).toPass({ timeout: 10_000 });
    await page.keyboard.type('upload flow');
    // Results arrive on their own after a short pause; no Enter needed.
    await expect(page).toHaveURL(/\/search\?q=upload\+flow|\/search\?q=upload%20flow/);

    const results = page.getByTestId('search-results').getByRole('option');
    await expect(results).toHaveCount(1);
    await expect(results.first()).toContainText('Mia Member');
    await expect(results.first()).toContainText('#engineering');
    await expect(results.first().locator('mark')).toHaveText(['upload', 'flow']);
    // Keyboard: ↓ highlights the message (no channel/person matches here), Enter opens it.
    const input = page.getByPlaceholder('Search messages, channels and people');
    await input.press('ArrowDown');
    await expect(results.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/c\/cEngineering\?m=eng0/);
  });

  test('↑/↓ walk channels, people and messages in one list; Enter opens', async ({ page }) => {
    await signIn(page, users.member, '/search');
    const input = page.getByPlaceholder('Search messages, channels and people');
    // "history" matches the #history channel and its seeded messages.
    await input.fill('history');
    await expect(page.getByTestId('quick-channels')).toContainText('history');
    const results = page.getByTestId('search-results').getByRole('option');
    await expect(results.first()).toBeVisible({ timeout: 10_000 });
    await input.press('ArrowDown'); // #history
    await expect(page.getByTestId('quick-channels').getByRole('option').first()).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowDown'); // first message
    await expect(results.first()).toHaveAttribute('aria-selected', 'true');
    await input.press('ArrowUp'); // back to #history
    await input.press('Enter');
    await expect(page.getByTestId('channel-title')).toHaveText('history');
  });

  test('filters narrow results, and older pages load on demand', async ({ page }) => {
    await signIn(page, users.member, '/search?q=history');
    const results = page.getByTestId('search-results').getByRole('option');
    await expect(results).toHaveCount(20);
    await page.getByRole('button', { name: 'Load more' }).click();
    await expect(results).toHaveCount(40);

    await page.getByLabel('From').selectOption({ label: 'Ada Admin' });
    await expect(results.first()).toContainText('Ada Admin');
    await expect(results.filter({ hasText: 'Mia Member' })).toHaveCount(0);

    await page.getByLabel('In channel').selectOption({ label: '#general' });
    await expect(page.getByText('No messages match')).toBeVisible();
  });

  test('new messages become searchable', async ({ page }) => {
    await signIn(page, users.admin, '/c/cRandom');
    const box = page.getByTestId('composer').getByRole('textbox');
    await box.fill('the kombucha fridge is broken');
    await box.press('Enter');
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page).toHaveURL(/\/search/);
    const input = page.getByPlaceholder('Search messages, channels and people');
    // Indexing happens in a function right after sending; retry the search until it's there.
    await expect(async () => {
      await input.fill('kombu');
      await page.getByRole('button', { name: 'Search', exact: true }).click();
      await page.getByTestId('search-results').getByRole('option').first().waitFor({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await expect(page.getByTestId('search-results')).toContainText('the kombucha fridge is broken');
  });

  test('channels and people show up instantly alongside messages', async ({ page }) => {
    await signIn(page, users.member, '/search');
    const input = page.getByPlaceholder('Search messages, channels and people');
    await input.fill('eng');
    await expect(page.getByTestId('quick-channels')).toContainText('engineering');
    await input.fill('tom');
    await expect(page.getByTestId('quick-persons')).toContainText('Tomás Araya');
    await expect(page.getByTestId('quick-channels')).toHaveCount(0);
    // Private channels you aren't in never show up.
    await input.fill('leader');
    await expect(page.getByTestId('quick-channels')).toHaveCount(0);
    await input.fill('Tomás');
    await input.press('ArrowDown');
    await input.press('Enter');
    await expect(page).toHaveURL(/\/c\/dm_uMember_uMember2$/);
  });

  test('phone: search from Home @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2);
    await page.getByRole('link', { name: 'Search', exact: true }).click();
    const input = page.getByPlaceholder('Search messages, channels and people');
    await input.fill('executables');
    await input.press('Enter');
    await expect(page.getByTestId('search-results')).toContainText('block executables');
  });
});
