import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const composer = (page: Page) => page.getByTestId('composer').getByRole('textbox');
const dmList = (page: Page) => page.getByTestId('dm-list');

async function newMessage(page: Page, people: string[]) {
  await page.getByRole('button', { name: 'New message' }).first().click();
  const dialog = page.getByRole('dialog', { name: 'New message' });
  for (const p of people) {
    await dialog.getByPlaceholder('Search by name or email').fill(p);
    await dialog.getByRole('option').first().click();
  }
  await dialog.getByRole('button', { name: /Start/ }).click();
}

test.describe('direct messages', () => {
  test.beforeEach(() => {
    emu.seed();
  });

  test('start a DM; the recipient gets it unread with a count @cross', async ({ page, browser }) => {
    const other = await asUser(browser, users.member2, '/c/cGeneral');
    await signIn(page, users.member);
    await newMessage(page, ['Tomás']);
    await expect(page).toHaveURL(/\/c\/dm_uMember_uMember2$/);
    await expect(page.getByTestId('channel-title')).toHaveText('Tomás Araya');
    await composer(page).fill('hey, got a minute?');
    await composer(page).press('Enter');
    await composer(page).fill('second one');
    await composer(page).press('Enter');

    const row = dmList(other.page).getByRole('link', { name: /Mia Member/ });
    await expect(row).toHaveAttribute('data-unread', 'true');
    await expect(row.locator('.badge')).toHaveText('2');
    await row.click();
    await expect(other.page.getByTestId('message-list')).toContainText('hey, got a minute?');
    await expect(row).not.toHaveAttribute('data-unread');
    await expect(row.locator('.badge')).toHaveCount(0);
    await other.context.close();
  });

  test('opening the same DM twice reuses one conversation', async ({ page }) => {
    await signIn(page, users.member);
    await newMessage(page, ['Tomás']);
    await expect(page).toHaveURL(/\/c\/dm_uMember_uMember2$/);
    await composer(page).fill('first');
    await composer(page).press('Enter');
    await page.keyboard.press('ControlOrMeta+k');
    await page.getByPlaceholder('Search messages, channels and people').fill('Tomás');
    await page.getByTestId('quick-persons').getByRole('button', { name: /Tomás Araya/ }).click();
    await expect(page).toHaveURL(/\/c\/dm_uMember_uMember2$/);
    await expect(page.getByTestId('message-list')).toContainText('first');
    // (Everyone also has a Flackbot DM.)
    const dms = emu.query<{ id: string; type: string }>('channels').filter((c) => c.type === 'dm' && !c.id.includes('flackbot'));
    expect(dms.map((d) => d.id)).toEqual(['dm_uMember_uMember2']);
  });

  test('group DMs are visible only to their members', async ({ page, browser }) => {
    await signIn(page, users.member);
    await newMessage(page, ['Tomás', 'Ada']);
    await expect(page).toHaveURL(/\/c\/dm_uAdmin_uMember_uMember2$/);
    await expect(page.getByTestId('channel-title')).toHaveText(/Ada Admin, Tomás Araya|Tomás Araya, Ada Admin/);
    await composer(page).fill('group hello');
    await composer(page).press('Enter');

    const admin = await asUser(browser, users.admin);
    await expect(dmList(admin.page)).toContainText('Mia Member, Tomás Araya');
    await admin.context.close();

    const res = emu.get<{ memberIds: string[] }>('channels/dm_uAdmin_uMember_uMember2');
    expect(res?.memberIds).toEqual(['uAdmin', 'uMember', 'uMember2']);
  });

  test('a DM with yourself works as a notes space', async ({ page }) => {
    await signIn(page, users.member);
    await page.getByRole('link', { name: /Search/ }).first().click();
    await page.getByPlaceholder('Search messages, channels and people').fill('Mia');
    await page.getByTestId('quick-persons').getByRole('button', { name: /Mia Member \(you\)/ }).click();
    await expect(page).toHaveURL(/\/c\/dm_uMember$/);
    await expect(page.getByText('This is your space.')).toBeVisible();
  });

  test('phone: the DMs tab lists conversations with a preview @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    emu.seed({ demo: true });
    await signIn(page, users.admin);
    await page.getByRole('navigation', { name: 'Main' }).getByRole('link', { name: 'DMs' }).click();
    const row = dmList(page).getByRole('link', { name: /Tomás Araya/ });
    await expect(row).toContainText('Sounds good, merging after lunch');
    await row.click();
    await expect(page.getByTestId('channel-title')).toHaveText('Tomás Araya');
  });
});
