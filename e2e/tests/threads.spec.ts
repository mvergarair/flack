import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const channelMessages = (page: Page) => page.getByTestId('message-list').getByTestId('message');
const threadPanel = (page: Page) => page.getByTestId('thread-panel');
const threadComposer = (page: Page) => page.getByTestId('thread-composer').getByRole('textbox');

test.describe('threads', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('open a thread from its summary and reply; others see the count update @cross', async ({ page, browser }) => {
    const other = await asUser(browser, users.member2, '/c/cEngineering');
    await signIn(page, users.admin, '/c/cEngineering');

    await page.getByTestId('thread-summary').first().click();
    await expect(page).toHaveURL(/\/c\/cEngineering\/t\/eng1/);
    await expect(threadPanel(page).getByTestId('thread-replies').getByTestId('message')).toHaveCount(3);

    await threadComposer(page).fill('Tests are in, **all green**.');
    await threadComposer(page).press('Enter');
    await expect(threadPanel(page).getByTestId('thread-replies').getByTestId('message')).toHaveCount(4);
    await expect(threadPanel(page).getByTestId('thread-reply-count')).toHaveText('4 replies');

    // The other person sees the summary update live without opening the thread…
    await expect(other.page.getByTestId('thread-summary').first()).toContainText('4 replies');
    // …and the reply does not appear in the main channel list.
    await expect(channelMessages(other.page).filter({ hasText: 'all green' })).toHaveCount(0);
    await other.context.close();
  });

  test('start a new thread from the hover action', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const target = channelMessages(page).filter({ hasText: 'On it' });
    await target.hover();
    await target.getByRole('link', { name: 'Reply in thread' }).click();
    await expect(threadPanel(page)).toContainText('0 replies');
    await threadComposer(page).fill('first reply');
    await threadComposer(page).press('Enter');
    await expect(target.getByTestId('thread-summary')).toContainText('1 reply');
    await page.getByRole('link', { name: 'Close thread' }).click();
    await expect(threadPanel(page)).toHaveCount(0);
  });

  test('deleting a parent with replies keeps the thread readable', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering/t/eng1');
    const parent = threadPanel(page).getByTestId('message').first();
    await parent.hover();
    await parent.getByRole('button', { name: 'Delete message' }).click();
    await parent.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(parent).toContainText('This message was deleted.');
    await expect(threadPanel(page).getByTestId('thread-replies').getByTestId('message')).toHaveCount(3);
    await expect(channelMessages(page).filter({ hasText: 'This message was deleted.' })).toHaveCount(1);
  });

  test('phone: threads open full screen with a back button @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2, '/c/cEngineering');
    await page.getByTestId('thread-summary').first().click();
    await expect(threadPanel(page)).toBeVisible();
    await expect(page.getByTestId('message-list')).toHaveCount(0);
    await threadComposer(page).fill('reply from phone');
    await page.getByTestId('thread-composer').getByRole('button', { name: 'Send' }).click();
    await expect(threadPanel(page)).toContainText('reply from phone');
    await page.getByRole('link', { name: 'Back to channel' }).click();
    await expect(page.getByTestId('thread-summary').first()).toContainText('4 replies');
  });
});
