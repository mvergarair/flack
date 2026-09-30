import { test, expect } from '../fixtures.ts';
import type { Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const composer = (page: Page) => page.getByTestId('composer').getByRole('textbox');
const messages = (page: Page) => page.getByTestId('message-list').getByTestId('message');

async function send(page: Page, text: string) {
  await composer(page).fill(text);
  await composer(page).press('Enter');
}

test.describe('messages', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true, historyCount: 200 });
  });

  test('messages appear live for other members, with markdown @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');

    await send(page, 'Ship **today** with `npm run deploy`\n');
    const last = messages(other.page).last();
    await expect(last).toContainText('Ship today with npm run deploy');
    await expect(last.locator('strong')).toHaveText('today');
    await expect(last.locator('code')).toHaveText('npm run deploy');
    await expect(composer(page)).toHaveValue('');
    await other.context.close();
  });

  test('HTML and script payloads render as inert text', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');
    let dialogs = 0;
    other.page.on('dialog', (d) => {
      dialogs++;
      void d.dismiss();
    });
    await send(page, '<img src=x onerror="alert(1)"> <script>alert(2)</script> [x](javascript:alert(3))');
    const last = messages(other.page).last();
    await expect(last).toContainText('<img src=x onerror="alert(1)">');
    await expect(last.locator('img, script')).toHaveCount(0);
    await expect(last.locator('a[href^="javascript"]')).toHaveCount(0);
    expect(dialogs).toBe(0);
    await other.context.close();
  });

  test('toolbar formatting, shift+enter and code fences', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await composer(page).fill('important');
    await composer(page).selectText();
    await page.getByRole('button', { name: 'Bold' }).click();
    await expect(composer(page)).toHaveValue('**important**');
    await composer(page).press('End');
    await composer(page).press('Shift+Enter');
    await composer(page).pressSequentially('second line');
    await composer(page).press('Enter');
    const last = messages(page).last();
    await expect(last.locator('strong')).toHaveText('important');
    await expect(last).toContainText('second line');

    // Enter inside an open ``` fence adds a newline instead of sending.
    await composer(page).fill('```');
    await composer(page).press('Enter');
    await composer(page).pressSequentially('let x = 1;');
    await composer(page).press('Enter');
    await composer(page).pressSequentially('```');
    await composer(page).press('Enter');
    await expect(messages(page).last().locator('pre')).toContainText('let x = 1;');
  });

  test('editing and deleting own messages syncs to others', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cEngineering');
    await send(page, 'typo mesage');
    const typo = messages(page).filter({ hasText: 'typo mesage' });
    await expect(typo).not.toContainText('Sending…');
    const id = await typo.getAttribute('data-message-id');
    const mine = page.locator(`[data-message-id="${id}"]`);
    await mine.hover();
    await mine.getByRole('button', { name: 'Edit message' }).click();
    await mine.getByRole('textbox', { name: 'Edit message' }).fill('fixed message');
    await mine.getByRole('textbox', { name: 'Edit message' }).press('Enter');
    await expect(messages(other.page).last()).toContainText('fixed message');
    await expect(messages(other.page).last()).toContainText('(edited)');

    const edited = mine;
    await edited.hover();
    await edited.getByRole('button', { name: 'Delete message' }).click();
    await edited.getByRole('button', { name: 'Delete', exact: true }).click();
    await expect(other.page.getByText('fixed message')).toHaveCount(0);
    await other.context.close();
  });

  test("others can't edit my messages; members can't delete them", async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const theirs = messages(page).filter({ hasText: 'Plan for today' });
    await theirs.hover();
    await expect(theirs.getByRole('button', { name: 'Edit message' })).toHaveCount(0);
    await expect(theirs.getByRole('button', { name: 'Delete message' })).toHaveCount(0);
  });

  test('history loads 50 at a time as you scroll up', async ({ page }) => {
    await signIn(page, users.member, '/c/cHistory');
    await expect(messages(page).last()).toContainText('History message 199');
    await expect(messages(page)).toHaveCount(50);
    const list = page.getByTestId('message-list');
    for (let i = 0; i < 20 && (await messages(page).count()) < 200; i++) {
      await list.evaluate((el) => (el.scrollTop = 0));
      await page.waitForTimeout(500);
    }
    await list.evaluate((el) => (el.scrollTop = 0));
    await expect(page.getByText('History message 0', { exact: true })).toBeVisible();
    await expect(messages(page)).toHaveCount(200);
    await expect(page.getByText('Welcome to #history')).toBeVisible();
  });

  test('unread channels are bold until opened', async ({ page, browser }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    const other = await asUser(browser, users.member2, '/c/cRandom');
    await send(other.page, 'anyone around?');
    const random = page.getByTestId('channel-list').getByRole('link', { name: 'random' });
    await expect(random).toHaveAttribute('data-unread', 'true');
    await random.click();
    await expect(messages(page).last()).toContainText('anyone around?');
    await expect(random).not.toHaveAttribute('data-unread');
    await other.context.close();
  });

  test("a deactivated person's old messages keep their name", async ({ page }) => {
    await signIn(page, users.admin, '/c/cGeneral');
    const old = messages(page).filter({ hasText: 'An old message from someone who has left.' });
    await expect(old).toContainText('Gus Gone');
    await expect(old).toContainText('deactivated');
  });

  test('archived channels are read-only', async ({ page }) => {
    emu.set('channels/cRandom', { archived: true });
    await signIn(page, users.admin, '/c/cRandom');
    await expect(page.getByTestId('composer-archived')).toBeVisible();
  });

  test('phone: send a message from the channel screen @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2, '/c/cEngineering');
    await composer(page).fill('from my phone');
    await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
    await expect(messages(page).last()).toContainText('from my phone');
  });

  test('phone: tap a message to reveal its actions, then delete it @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member2, '/c/cEngineering');
    await composer(page).fill('delete me from my phone');
    await page.getByTestId('composer').getByRole('button', { name: 'Send' }).click();
    const msg = messages(page).filter({ hasText: 'delete me from my phone' });
    await expect(msg).not.toContainText('Sending…');
    await msg.getByTestId('message-text').tap();
    await msg.getByRole('button', { name: 'Delete message' }).tap();
    await msg.getByRole('button', { name: 'Delete', exact: true }).tap();
    await expect(msg).toHaveCount(0);
  });

  test('↑ in an empty composer edits my last message; Esc cancels, Enter saves', async ({ page }) => {
    await signIn(page, users.admin, '/c/cEngineering');
    await send(page, 'first draft');
    const mine = messages(page).filter({ hasText: 'first draft' });
    await expect(mine).not.toContainText('Sending…');

    // Typing then ↑ moves the caret as usual; only an empty composer starts editing.
    await composer(page).fill('x');
    await composer(page).press('ArrowUp');
    await expect(page.getByRole('textbox', { name: 'Edit message' })).toHaveCount(0);
    await composer(page).fill('');

    await composer(page).press('ArrowUp');
    const editor = page.getByRole('textbox', { name: 'Edit message' });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveValue('first draft');
    await editor.press('Escape');
    await expect(editor).toHaveCount(0);
    await expect(composer(page)).toBeFocused();

    await composer(page).press('ArrowUp');
    await editor.fill('final version');
    await editor.press('Enter');
    await expect(messages(page).last()).toContainText('final version');
    await expect(messages(page).last()).toContainText('(edited)');
    await expect(composer(page)).toBeFocused();
  });

  test('↑ in the thread composer edits my last reply', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering/t/eng1');
    const reply = page.getByTestId('thread-composer').getByRole('textbox');
    await reply.fill('reply with a tpyo');
    await reply.press('Enter');
    const panel = page.getByTestId('thread-panel');
    await expect(panel.getByTestId('message').last()).toContainText('reply with a tpyo');
    await reply.press('ArrowUp');
    const editor = panel.getByRole('textbox', { name: 'Edit message' });
    await expect(editor).toHaveValue('reply with a tpyo');
    await editor.fill('reply with a typo fixed');
    await editor.press('Enter');
    await expect(panel.getByTestId('message').last()).toContainText('reply with a typo fixed');
  });
});
