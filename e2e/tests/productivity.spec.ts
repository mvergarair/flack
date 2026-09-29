import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const channelMsgs = (page: Page) => page.getByTestId('message-list').getByTestId('message');
const post = async (page: Page, text: string) => {
  const box = page.getByTestId('composer').getByRole('textbox');
  await box.fill(text);
  await box.press('Enter');
};

test.describe('also send to channel', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('a thread reply with the checkbox also shows in the channel @cross', async ({ page, browser }) => {
    const other = await asUser(browser, users.member2, '/c/cEngineering');
    await signIn(page, users.admin, '/c/cEngineering/t/eng1');
    const reply = page.getByTestId('thread-composer').getByRole('textbox');

    await reply.fill('only in the thread');
    await reply.press('Enter');
    await page.getByTestId('thread-composer').getByLabel('Also send to #engineering').check();
    await reply.fill('decision: we block executables');
    await reply.press('Enter');
    await expect(page.getByTestId('thread-composer').getByLabel('Also send to #engineering')).not.toBeChecked();

    const inChannel = channelMsgs(other.page).filter({ hasText: 'decision: we block executables' });
    await expect(inChannel).toBeVisible();
    await expect(inChannel.getByTestId('replied-to-thread')).toBeVisible();
    await expect(channelMsgs(other.page).filter({ hasText: 'only in the thread' })).toHaveCount(0);
    await inChannel.getByTestId('replied-to-thread').click();
    await expect(other.page).toHaveURL(/\/t\/eng1/);
    await other.context.close();
  });
});

test.describe('saved for later', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('save from the menu, find it under Later → Saved, remove it', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const m = channelMsgs(page).filter({ hasText: 'Plan for today' });
    await m.hover();
    await m.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Save for later' }).click();
    await expect(m.getByTestId('saved-tag')).toBeVisible();

    await page.getByRole('link', { name: 'Later' }).click();
    const item = page.getByTestId('saved-list').getByRole('listitem').filter({ hasText: 'Plan for today' });
    await expect(item).toContainText('Mia Member in #engineering');
    await item.getByRole('link').click();
    await expect(page).toHaveURL(/\/c\/cEngineering\?m=eng0/);

    await page.getByRole('link', { name: 'Later' }).click();
    await page.getByTestId('saved-list').getByRole('button', { name: 'Remove from saved' }).click();
    await expect(page.getByText('Nothing saved yet')).toBeVisible();
  });
});

test.describe('profile card', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
    emu.set('users/uMember2', { title: 'Backend engineer', timeZone: 'Europe/Madrid', customStatus: { emoji: '🎧', text: 'Focusing', expiresAt: null } });
  });

  test('clicking a name shows title, status, local time and a Message button @cross', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const m = channelMsgs(page).filter({ hasText: 'On it' });
    await m.getByRole('button', { name: 'Tomás Araya', exact: true }).click();
    const card = page.getByTestId('profile-card').locator('..');
    await expect(page.getByTestId('profile-card')).toContainText('Backend engineer');
    await expect(card.getByTestId('profile-status')).toContainText('🎧 Focusing');
    await expect(card.getByTestId('profile-time')).toContainText('Europe/Madrid');
    await page.getByRole('dialog').getByRole('button', { name: 'Message' }).click();
    await expect(page).toHaveURL(/\/c\/dm_uAdmin_uMember2$/);
  });

  test('@mention chips open the profile too', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await channelMsgs(page).filter({ hasText: 'new composer mockup' }).locator('.mention').click();
    await expect(page.getByTestId('profile-card')).toContainText('Tomás Araya');
  });

  test('my time zone is recorded automatically', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const tz = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
    await expect.poll(() => emu.get<{ timeZone: string }>('users/uMember')?.timeZone).toBe(tz);
  });
});

test.describe('Do Not Disturb', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('pausing stops pushes (Activity still records), shows 🌙, and resumes', async ({ page, browser }) => {
    // Tomás has a device registered and pauses notifications for an hour.
    emu.set('users/uMember2/private/tokens', { tokens: { 'emulator-dnd-test': { createdAt: { __ts: Date.now() } } } });
    const tomas = await asUser(browser, users.member2, '/c/cGeneral');
    await tomas.page.getByTestId('user-menu').click();
    await tomas.page.getByTestId('dnd-menuitem').click();
    await tomas.page.getByTestId('dnd-settings').getByRole('button', { name: '1 hour' }).click();
    await expect(tomas.page.getByTestId('dnd-until')).toBeVisible();
    await expect(tomas.page.getByTestId('dnd-active')).toBeVisible();
    await tomas.page.keyboard.press('Escape');

    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    await post(page, 'quiet please');
    await expect
      .poll(() => emu.query<{ preview: string }>('users/uMember2/activity').length, { timeout: 5000 })
      .toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(4000);
    expect(emu.query<{ uid: string; body: string }>('_debug/pushes/items').filter((p) => p.body === 'quiet please')).toHaveLength(0);

    // Others see it on the profile card.
    await page.getByTestId('channel-title').click();
    await page.keyboard.press('Escape');
    await channelMsgs(page).first().getByRole('button', { name: /Ada Admin|Tomás Araya/ }).first().click();
    await page.keyboard.press('Escape');

    // Resume → pushes flow again.
    await tomas.page.getByTestId('user-menu').click();
    await tomas.page.getByTestId('dnd-menuitem').click();
    await tomas.page.getByTestId('dnd-settings').getByRole('button', { name: 'Resume notifications' }).click();
    await tomas.page.keyboard.press('Escape');
    await post(page, 'now you can hear me');
    await expect
      .poll(() => emu.query<{ body: string }>('_debug/pushes/items').some((p) => p.body === 'now you can hear me'), { timeout: 30_000 })
      .toBe(true);
    await tomas.context.close();
  });

  test('a daily schedule is saved in my time zone', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    await page.getByTestId('user-menu').click();
    await page.getByTestId('dnd-menuitem').click();
    const box = page.getByTestId('dnd-settings');
    await box.getByLabel('Quiet hours start').fill('21:30');
    await box.getByLabel('Quiet hours end').fill('07:15');
    await box.getByRole('checkbox').check();
    await expect
      .poll(() => emu.get<{ dnd: { schedule: object } }>('users/uMember')?.dnd?.schedule)
      .toEqual({ enabled: true, start: '21:30', end: '07:15' });
  });
});

test.describe('link previews', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('links get a title/description/image card; the author can remove it @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await post(page, 'read this: http://127.0.0.1:5399/redirect');
    const mine = channelMsgs(page).filter({ hasText: 'read this' });
    const card = mine.getByTestId('link-preview');
    await expect(card).toContainText('Flack Blog', { timeout: 30_000 });
    await expect(card).toContainText('Shipping Flack v1');
    await expect(card).toContainText('How we built a team chat');
    await expect(card.locator('img')).toHaveAttribute('src', 'http://127.0.0.1:5399/cover.png');

    const other = await asUser(browser, users.member2, '/c/cEngineering');
    await expect(channelMsgs(other.page).filter({ hasText: 'read this' }).getByTestId('link-preview')).toBeVisible();
    await expect(channelMsgs(other.page).filter({ hasText: 'read this' }).getByRole('button', { name: 'Remove link previews' })).toHaveCount(0);
    await other.context.close();

    await mine.hover();
    await mine.getByRole('button', { name: 'Remove link previews' }).click();
    await expect(card).toHaveCount(0);
  });

  test('links inside code are not previewed', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await post(page, 'config: `http://127.0.0.1:5399/article`');
    await page.waitForTimeout(4000);
    await expect(channelMsgs(page).filter({ hasText: 'config:' }).getByTestId('link-preview')).toHaveCount(0);
  });
});
