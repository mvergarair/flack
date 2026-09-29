import { test, expect } from '@playwright/test';
import { emu, users, PASSWORD } from '../helpers.ts';

// Uses the persistent IndexedDB cache like the deployed app (no ?memcache).
test.describe('empty channels (persistent cache)', () => {
  test.beforeEach(() => {
    emu.seed();
  });

  test('an existing channel with no messages shows its intro, not a spinner @cross', async ({ page }) => {
    await page.goto('/login?next=%2Fc%2FcRandom');
    await page.getByLabel('Email').fill(users.member);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('random');
    await expect(page.getByText('Welcome to #random')).toBeVisible();
    await expect(page.getByLabel('Loading messages')).toHaveCount(0);

    // Revisit (the query now has a cached, empty result) and reload.
    await page.getByTestId('channel-list').getByRole('link', { name: 'general' }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await page.getByTestId('channel-list').getByRole('link', { name: 'random' }).click();
    await expect(page.getByText('Welcome to #random')).toBeVisible();
    await page.waitForTimeout(1500); // let IndexedDB persist the cached query
    await page.reload();
    await expect(page.getByTestId('channel-title')).toHaveText('random');
    await expect(page.getByText('Welcome to #random')).toBeVisible();
    await expect(page.getByLabel('Loading messages')).toHaveCount(0);
  });

  test('a brand-new channel shows its intro and accepts the first message', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel('Email').fill(users.member);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: 'Add channel' }).click();
    await page.getByRole('dialog').getByLabel('Name').fill('brand-new');
    await page.getByRole('dialog').getByRole('button', { name: 'Create' }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('brand-new');
    await expect(page.getByText('Welcome to #brand-new')).toBeVisible();

    const box = page.getByTestId('composer').getByRole('textbox');
    await box.fill('first!');
    await box.press('Enter');
    await expect(page.getByTestId('message-list').getByTestId('message')).toHaveCount(1);
  });
});
