import { test, expect, type Page } from '@playwright/test';
import { emu, signIn, users } from '../helpers.ts';

// The emulator answers with a scripted stand-in for Claude (functions ai/model.ts): it searches
// for the question's last two long words and quotes what it found, citing [refs].
const aiOn = { enabled: true, model: 'claude-sonnet-5-5', dailyLimit: 30, monthlyBudgetUsd: 20 };
const panel = (page: Page) => page.getByTestId('flackbot-panel');
const askBox = (page: Page) => panel(page).getByRole('textbox', { name: 'Ask Flackbot' });

test.describe('Ask Flackbot', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('desktop: a right-hand pane that answers with links to the messages @cross', async ({ page }) => {
    test.skip(!!test.info().project.name.match(/iphone|pixel/), 'desktop layout');
    emu.set('config/ai', aiOn);
    await signIn(page, users.member, '/c/cGeneral');
    await page.getByTestId('ask-flackbot').click();
    await expect(panel(page)).toBeVisible();
    await expect(panel(page).getByTestId('flackbot-empty')).toContainText('Mia!');

    await askBox(page).fill('anything new about the upload flow?');
    await askBox(page).press('Enter');
    await expect(panel(page).getByTestId('flackbot-question')).toHaveText('anything new about the upload flow?');
    const answer = panel(page).getByTestId('flackbot-answer');
    await expect(answer).toContainText('finish the upload flow');
    await expect(answer.getByRole('list', { name: 'Sources' })).toContainText('#engineering · Mia Member');

    // A source opens the message; the pane stays open next to it.
    await answer.getByRole('link', { name: /#engineering · Mia Member/ }).click();
    await expect(page).toHaveURL(/\/c\/cEngineering\?m=eng0/);
    await expect(panel(page)).toBeVisible();

    // It's remembered, and a new chat starts empty.
    await page.reload();
    await expect(panel(page).getByTestId('flackbot-answer')).toBeVisible();
    await panel(page).getByRole('button', { name: 'New chat' }).click();
    await expect(panel(page).getByTestId('flackbot-empty')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Close Flackbot' }).click();
    await expect(panel(page)).toHaveCount(0);
  });

  test('phone: a full-screen page from the header @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    emu.set('config/ai', aiOn);
    await signIn(page, users.member, '/');
    await page.getByTestId('ask-flackbot').click();
    await expect(page).toHaveURL(/\/flackbot$/);
    await panel(page).getByRole('button', { name: /What did I miss/ }).click();
    await expect(panel(page).getByTestId('flackbot-answer')).toBeVisible();
    await panel(page).getByRole('button', { name: 'Back' }).click();
    await expect(page).toHaveURL(/\/$/);
  });

  test('questions typed in the Flackbot DM get AI answers there too', async ({ page }) => {
    emu.set('config/ai', aiOn);
    await signIn(page, users.member, '/c/cGeneral');
    await page.goto('/c/dm_flackbot_uMember');
    const box = page.getByTestId('composer').locator('textarea');
    await box.fill('what is the plan for the upload flow');
    await box.press('Enter');
    const answer = page.getByTestId('message-list').getByTestId('message').filter({ hasText: 'I found' });
    await expect(answer).toContainText('finish the upload flow');
    await expect(answer.getByTestId('bot-sources')).toContainText('#engineering · Mia Member');
    await expect(page.getByTestId('message-list')).not.toContainText("I'm a simple bot");
  });

  test('admins turn it on and check the connection; it stays hidden for members until then', async ({ page, browser }) => {
    test.skip(!!test.info().project.name.match(/iphone|pixel/), 'desktop layout');
    const member = await browser.newContext();
    const mp = await member.newPage();
    await signIn(mp, users.member, '/c/cGeneral');
    await expect(mp.getByTestId('ask-flackbot')).toHaveCount(0);

    await signIn(page, users.admin, '/admin');
    const card = page.getByTestId('ask-flackbot-card');
    await expect(card.getByRole('link', { name: 'open Model Garden' })).toHaveAttribute('href', /model-garden\/claude-sonnet-5-5\?project=demo-flack/);
    await card.getByRole('switch', { name: 'Ask Flackbot on' }).check();
    await expect(card.getByRole('status').last()).toContainText('Everyone now sees Ask Flackbot');
    await card.getByRole('button', { name: 'Check the connection' }).click();
    await expect(card.getByTestId('ai-check')).toContainText('Flackbot can reach Claude');
    await card.getByLabel('Model').selectOption('claude-haiku-4-5');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect.poll(() => emu.get<{ model: string }>('config/ai')?.model).toBe('claude-haiku-4-5');

    await expect(mp.getByTestId('ask-flackbot')).toBeVisible();
    await member.close();
  });
});
