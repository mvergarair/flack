import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const channelMsgs = (page: Page) => page.getByTestId('message-list').getByTestId('message');
const composer = (page: Page) => page.getByTestId('composer');

test.describe('Flackbot', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('welcomes you in its DM and answers there @cross', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const link = page.getByTestId('dm-list').getByRole('link', { name: /Flackbot/ });
    await link.click();
    await expect(page).toHaveURL(/\/c\/dm_flackbot_uMember$/);

    // No member count or channel settings for a bot DM.
    await expect(page.getByRole('button', { name: /members$/ })).toHaveCount(0);
    const welcome = channelMsgs(page).first();
    await expect(welcome).toContainText("I'm Flackbot");
    await expect(welcome.getByTestId('bot-tag')).toHaveText('bot');

    await composer(page).locator('textarea').fill('hello there');
    await composer(page).locator('textarea').press('Enter');
    await expect(channelMsgs(page).filter({ hasText: "I'm a simple bot for now" })).toBeVisible();

    // Its profile card has no email or presence, and opens the DM.
    await welcome.getByRole('button', { name: 'Flackbot', exact: true }).click();
    const card = page.getByRole('dialog');
    await expect(card).toContainText('Reminders, notices and answers');
    await expect(card).not.toContainText('Email');
    await card.getByRole('button', { name: 'Open Flackbot' }).click();
    await expect(page).toHaveURL(/\/c\/dm_flackbot_uMember$/);
  });

  test('is not a person: not in people lists, mentions or the new-message picker', async ({ page }) => {
    await signIn(page, users.admin, '/admin');
    await expect(page.getByTestId('people-list')).not.toContainText('Flackbot');
    await page.goto('/c/cGeneral');
    await composer(page).locator('textarea').fill('@Flack');
    await expect(page.getByRole('listbox')).toHaveCount(0);
  });

  test('admins write a welcome and automatic answers; Flackbot answers in channels and threads', async ({ page, browser }) => {
    await signIn(page, users.admin, '/admin');
    const card = page.getByTestId('flackbot-card');
    await card.getByTestId('bot-welcome').fill('Welcome to Acme! Ask me about the wifi.');
    await card.getByRole('button', { name: 'Add an answer' }).click();
    await card.getByLabel('Phrase 1').fill('WiFi password');
    await card.getByLabel('Reply 1').fill('It is on the fridge.');
    await card.getByRole('button', { name: 'Save' }).click();
    await expect(card.getByRole('status')).toContainText('Saved');
    await page.reload();
    await expect(page.getByTestId('flackbot-card').getByLabel('Phrase 1')).toHaveValue('WiFi password');

    // A new member's welcome uses the admin's text.
    const member = await asUser(browser, users.member2, '/c/cGeneral');
    await member.page.getByTestId('dm-list').getByRole('link', { name: /Flackbot/ }).click();
    await expect(channelMsgs(member.page).first()).toContainText('Welcome to Acme! Ask me about the wifi.');

    await member.page.goto('/c/cGeneral');
    await composer(member.page).locator('textarea').fill("what's the wifi password?");
    await composer(member.page).locator('textarea').press('Enter');
    const answer = channelMsgs(member.page).filter({ hasText: 'It is on the fridge.' });
    await expect(answer).toBeVisible();
    // Everyone in the channel sees it.
    await page.goto('/c/cGeneral');
    await expect(channelMsgs(page).filter({ hasText: 'It is on the fridge.' })).toBeVisible();
    await member.context.close();
  });
});
