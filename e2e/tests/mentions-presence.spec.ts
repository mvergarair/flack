import { test, expect } from '../fixtures.ts';
import type { Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const composer = (page: Page) => page.getByTestId('composer').getByRole('textbox');
const messages = (page: Page) => page.getByTestId('message-list').getByTestId('message');

test.describe('mentions, unreads and activity', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('@-autocomplete inserts a mention that notifies the person @cross', async ({ page, browser }) => {
    const other = await asUser(browser, users.member2, '/c/cGeneral');
    await signIn(page, users.admin, '/c/cEngineering');

    await composer(page).pressSequentially('ping @Tom');
    const list = page.getByRole('listbox', { name: 'Mention someone' });
    await expect(list.getByRole('option')).toHaveCount(1);
    await expect(list).toContainText('Tomás Araya');
    await composer(page).press('Enter');
    await expect(composer(page)).toHaveValue('ping @Tomás Araya ');
    await composer(page).pressSequentially('please review');
    await composer(page).press('Enter');

    const sent = messages(page).last();
    await expect(sent.locator('.mention')).toHaveText('@Tomás Araya');
    const stored = emu.query<{ text: string; mentions: string[] }>('channels/cEngineering/messages').find((m) => m.text.includes('please review'));
    expect(stored).toMatchObject({ text: 'ping <@uMember2> please review', mentions: ['uMember2'] });

    // The mentioned person: channel badge, activity badge and an Activity entry that links back.
    const eng = other.page.getByTestId('channel-list').getByRole('link', { name: /engineering/ });
    await expect(eng.locator('.badge')).toHaveText(/\d/, { timeout: 30_000 });
    await expect(other.page.getByTestId('activity-badge')).toBeVisible({ timeout: 30_000 });
    await other.page.getByRole('link', { name: /Activity/ }).click();
    const item = other.page.getByTestId('activity-list').getByRole('listitem').filter({ hasText: 'please review' });
    await expect(item).toContainText('Ada Admin mentioned you in #engineering', { timeout: 30_000 });
    await item.getByRole('link').click();
    await expect(other.page).toHaveURL(/\/c\/cEngineering\?m=/);
    await expect(messages(other.page).filter({ hasText: 'please review' }).locator('.mention')).toHaveAttribute('data-me', 'true');
    await expect(eng.locator('.badge')).toHaveCount(0);
    await other.context.close();
  });

  test('thread replies show up in the parent author’s activity', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering/t/eng1');
    const reply = page.getByTestId('thread-composer').getByRole('textbox');
    await reply.fill('added the non-member test');
    await reply.press('Enter');
    await expect
      .poll(() => emu.query<{ kind: string; preview: string }>('users/uAdmin/activity').find((a) => a.preview.includes('non-member test'))?.kind, {
        timeout: 30_000,
      })
      .toBe('reply');
    // Previous repliers hear about it too; the author of the reply does not.
    await expect
      .poll(() => emu.query<{ preview: string }>('users/uMember/activity').some((a) => a.preview.includes('non-member test')), { timeout: 30_000 })
      .toBe(true);
    expect(emu.query<{ preview: string }>('users/uMember2/activity').some((a) => a.preview.includes('non-member test'))).toBe(false);
  });

  test('phone: the Activity tab shows a dot for new items @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2);
    const tab = page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: /Activity/ });
    await expect(tab.getByLabel('New activity')).toBeVisible();
    await tab.click();
    await expect(page.getByTestId('activity-list')).toContainText('mentioned you in #engineering');
    await expect(tab.getByLabel('New activity')).toHaveCount(0, { timeout: 5000 });
  });
});

test.describe('@channel and @here', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('@channel reaches every member; @here only those online', async ({ page, browser }) => {
    // Tomás is online (elsewhere); Mia is a member of #engineering but offline.
    const tomas = await asUser(browser, users.member2, '/c/cGeneral');
    await signIn(page, users.admin, '/c/cEngineering');

    await composer(page).pressSequentially('@cha');
    const list = page.getByRole('listbox', { name: 'Mention someone' });
    await expect(list.getByRole('option').first()).toContainText('@channel');
    await composer(page).press('Enter');
    await composer(page).pressSequentially('standup in 5');
    await composer(page).press('Enter');
    await expect(messages(page).last().locator('.mention')).toHaveText('@channel');

    const activity = (uid: string) => emu.query<{ preview: string }>(`users/${uid}/activity`);
    await expect.poll(() => activity('uMember2').some((a) => a.preview.includes('standup in 5')), { timeout: 30_000 }).toBe(true);
    await expect.poll(() => activity('uMember').some((a) => a.preview.includes('standup in 5')), { timeout: 30_000 }).toBe(true);

    // Typed (not picked) @here still counts, but only reaches people online.
    await composer(page).fill('@here deploy is done');
    await composer(page).press('Enter');
    await expect.poll(() => activity('uMember2').some((a) => a.preview.includes('deploy is done')), { timeout: 30_000 }).toBe(true);
    await page.waitForTimeout(2000);
    expect(activity('uMember').some((a) => a.preview.includes('deploy is done'))).toBe(false);

    // The recipient sees the channel badge and a highlighted message.
    const eng = tomas.page.getByTestId('channel-list').getByRole('link', { name: /engineering/ });
    // 1 seeded @mention of Tomás + @channel + @here.
    await expect(eng.locator('.badge')).toHaveText('3', { timeout: 15_000 });
    await eng.click();
    await expect(messages(tomas.page).filter({ hasText: 'deploy is done' }).locator('.mention')).toHaveAttribute('data-broadcast', 'here');
    await tomas.context.close();
  });
});

test.describe('presence and typing', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('online dots follow people coming and going @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    const dmRow = page.getByTestId('dm-list').getByRole('link', { name: /Tomás Araya/ });
    await expect(dmRow.locator('[data-online]')).toHaveAttribute('data-online', 'false');

    const other = await asUser(browser, users.member2);
    await expect(dmRow.locator('[data-online]')).toHaveAttribute('data-online', 'true');
    await other.context.close();
    await expect(dmRow.locator('[data-online]')).toHaveAttribute('data-online', 'false', { timeout: 20_000 });
  });

  test('typing indicator shows while someone types', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');
    await composer(other.page).pressSequentially('thinking about it', { delay: 30 });
    await expect(page.getByTestId('typing')).toHaveText('Tomás Araya is typing…');
    await composer(other.page).press('Enter');
    await expect(page.getByTestId('typing')).toHaveText('', { timeout: 10_000 });
    await other.context.close();
  });

  test('typing in a thread shows in that thread only', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering/t/eng1');
    const other = await asUser(browser, users.member2, '/c/cEngineering/t/eng1');
    const reply = other.page.getByTestId('thread-composer').getByRole('textbox');
    await reply.pressSequentially('drafting a reply', { delay: 30 });
    await expect(page.getByTestId('thread-typing')).toHaveText('Tomás Araya is typing…');
    await expect(page.getByTestId('typing')).toHaveText('');
    await reply.press('Enter');
    await expect(page.getByTestId('thread-typing')).toHaveText('', { timeout: 10_000 });
    await other.context.close();
  });

  test('idle people show as away and come back when active; manual away sticks', async ({ page, browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => localStorage.setItem('flack:idleMs', '2000'));
    const tomas = await ctx.newPage();
    await signIn(tomas, users.member2, '/c/cGeneral');
    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    const dot = page.getByTestId('dm-list').getByRole('link', { name: /Tomás Araya/ }).locator('[data-online]');

    await expect(dot).toHaveAttribute('data-online', 'away', { timeout: 15_000 });
    await expect(page.getByTestId('last-online')).toHaveText('Away');
    await tomas.mouse.move(200, 200);
    await tomas.mouse.move(260, 240);
    await expect(dot).toHaveAttribute('data-online', 'true');
    await expect(page.getByTestId('last-online')).toHaveText('Active now');

    // Manual away (with a long idle threshold so only the toggle matters).
    await tomas.evaluate(() => localStorage.setItem('flack:idleMs', '600000'));
    await tomas.reload();
    await tomas.getByTestId('user-menu').click();
    await tomas.getByTestId('away-toggle').click();
    await expect(dot).toHaveAttribute('data-online', 'away');
    await expect(tomas.getByTestId('user-menu')).toContainText('Away');
    await tomas.mouse.move(300, 300);
    await tomas.waitForTimeout(1000);
    await expect(dot).toHaveAttribute('data-online', 'away');
    await tomas.getByTestId('user-menu').click();
    await tomas.getByTestId('away-toggle').click();
    await expect(dot).toHaveAttribute('data-online', 'true');
    await ctx.close();
  });

  test('an idle phone does not make an active laptop look away (per-device presence)', async ({ page, browser }) => {
    // Same person, two devices: the "phone" goes idle fast, the "laptop" stays active.
    const phoneCtx = await browser.newContext({ viewport: { width: 390, height: 844 } });
    await phoneCtx.addInitScript(() => localStorage.setItem('flack:idleMs', '1500'));
    const phone = await phoneCtx.newPage();
    await signIn(phone, users.member2, '/');
    const laptop = await asUser(browser, users.member2, '/c/cGeneral');

    await signIn(page, users.admin, '/c/dm_uAdmin_uMember2');
    const dot = page.getByTestId('dm-list').getByRole('link', { name: /Tomás Araya/ }).locator('[data-online]');
    await phone.waitForTimeout(3000); // phone is idle → its device entry is "away"
    const devices = await page.evaluate(async () => {
      const r = await fetch('http://127.0.0.1:9300/status/uMember2.json?ns=demo-flack-default-rtdb', { headers: { Authorization: 'Bearer owner' } });
      return Object.values((await r.json()) as Record<string, { state: string }>).map((d) => d.state).sort();
    });
    expect(devices).toEqual(['away', 'online']);
    await expect(dot).toHaveAttribute('data-online', 'true');

    // Laptop closes → only the idle phone is left → away.
    await laptop.context.close();
    await expect(dot).toHaveAttribute('data-online', 'away', { timeout: 20_000 });
    await phoneCtx.close();
  });
});

