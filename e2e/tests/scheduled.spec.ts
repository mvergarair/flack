import { test, expect, type Page } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

const channelMsgs = (page: Page) => page.getByTestId('message-list').getByTestId('message');
const composer = (page: Page) => page.getByTestId('composer');
const tomorrow = () => {
  const d = new Date(Date.now() + 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test.describe('scheduled messages', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('schedule from the composer; it posts when the 10-minute sweep runs @cross', async ({ page, browser }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const box = composer(page).locator('textarea');
    await box.fill('Standup notes are in the doc @Ada Admin');

    await composer(page).getByRole('button', { name: 'Schedule message' }).click();
    const picker = page.getByRole('dialog', { name: 'Schedule message' });
    await expect(picker.getByRole('menuitem', { name: /^Tomorrow/ })).toBeVisible();
    // Custom times only come in 10-minute steps.
    await picker.getByRole('menuitem', { name: 'Custom time…' }).click();
    await picker.getByLabel('Date').fill(tomorrow());
    const options = await picker.getByLabel('Time').locator('option').allTextContents();
    expect(options).toHaveLength(144);
    await picker.getByLabel('Time').selectOption('16:20');
    await picker.getByRole('button', { name: 'Schedule' }).click();

    await expect(box).toHaveValue('');
    await expect(composer(page).getByRole('status')).toContainText(/Scheduled for Tomorrow at 4:20/);
    await expect(composer(page).getByTestId('scheduled-bar')).toContainText('1 scheduled message here');
    await expect(channelMsgs(page).filter({ hasText: 'Standup notes' })).toHaveCount(0);

    await composer(page).getByTestId('scheduled-bar').getByRole('link', { name: 'See all' }).click();
    const item = page.getByTestId('scheduled-list').getByTestId('scheduled-item');
    await expect(item).toContainText(/Tomorrow at 4:20/);
    await expect(item).toContainText('to #general');
    await expect(item).toContainText('Standup notes are in the doc @Ada Admin');

    // Time passes: the sweep posts it as me, with the mention intact.
    emu.runScheduled({ backdate: true });
    await expect(page.getByTestId('scheduled-list')).toHaveCount(0);
    await expect(page.getByText('No scheduled messages')).toBeVisible();

    const admin = await asUser(browser, users.admin, '/c/cGeneral');
    const posted = channelMsgs(admin.page).filter({ hasText: 'Standup notes are in the doc' });
    await expect(posted).toContainText('Mia Member');
    await expect(posted.getByText('@Ada Admin')).toBeVisible();
    await admin.context.close();
  });

  test('scheduled thread replies post into the thread', async ({ page }) => {
    await signIn(page, users.member, '/c/cEngineering/t/eng1');
    const reply = page.getByTestId('thread-composer');
    await reply.locator('textarea').fill('following up tomorrow');
    await reply.getByRole('button', { name: 'Schedule message' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click();
    // Typing straight away is never wiped when the scheduling write completes.
    await reply.locator('textarea').fill('typed right away');
    await expect(reply.getByTestId('scheduled-bar')).toContainText('1 scheduled message in this thread');
    await page.waitForTimeout(500);
    await expect(reply.locator('textarea')).toHaveValue('typed right away');
    await expect(composer(page).getByTestId('scheduled-bar')).toHaveCount(0);

    emu.runScheduled({ backdate: true });
    await expect(page.getByTestId('thread-panel').getByText('following up tomorrow')).toBeVisible();
    await expect(reply.getByTestId('scheduled-bar')).toHaveCount(0);
  });

  test('edit, reschedule, send now and delete from Later', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const box = composer(page).locator('textarea');
    for (const text of ['first draft', 'second one']) {
      await box.fill(text);
      await composer(page).getByRole('button', { name: 'Schedule message' }).click();
      await page.getByRole('menuitem', { name: /^Next Monday/ }).click();
      await expect(box).toHaveValue('');
    }
    await page.getByRole('link', { name: 'Later' }).click();
    await page.getByRole('tab', { name: /Scheduled/ }).click();
    const items = page.getByTestId('scheduled-item');
    await expect(items).toHaveCount(2);

    await items.filter({ hasText: 'first draft' }).getByRole('button', { name: 'Edit' }).click();
    const editing = items.filter({ has: page.getByLabel('Edit scheduled message') });
    await editing.getByLabel('Edit scheduled message').fill('first, improved');
    await editing.getByRole('button', { name: 'Save' }).click();
    await expect(items.filter({ hasText: 'first, improved' })).toBeVisible();

    const improved = items.filter({ hasText: 'first, improved' });
    await improved.getByRole('button', { name: 'Reschedule' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click();
    await expect(improved).toContainText(/Tomorrow at 9:00/);

    await improved.getByRole('button', { name: 'Send now' }).click();
    await expect(items).toHaveCount(1);
    await items.getByRole('button', { name: 'Delete scheduled message' }).click();
    await expect(page.getByText('No scheduled messages')).toBeVisible();

    await page.goto('/c/cGeneral');
    await expect(channelMsgs(page).filter({ hasText: 'first, improved' })).toBeVisible();
    await expect(channelMsgs(page).filter({ hasText: 'second one' })).toHaveCount(0);
  });

  test('a message that can no longer be sent shows as not sent', async ({ page }) => {
    await signIn(page, users.member, '/c/cRandom');
    await composer(page).locator('textarea').fill('for the random crowd');
    await composer(page).getByRole('button', { name: 'Schedule message' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click();
    await expect(composer(page).getByTestId('scheduled-bar')).toBeVisible();

    emu.set('channels/cRandom', { archived: true });
    emu.runScheduled({ backdate: true });

    await page.getByRole('link', { name: 'Activity' }).first().click();
    await expect(page.getByTestId('activity-list')).toContainText("wasn't sent: The channel was archived.");
    await page.getByTestId('activity-list').getByRole('link', { name: /wasn't sent/ }).click();
    const item = page.getByTestId('scheduled-item');
    await expect(item).toContainText('Not sent: The channel was archived.');
    await expect(item.getByRole('button', { name: 'Retry' })).toBeVisible();
  });

  test('phone: schedule from the composer tools @mobile', async ({ page }) => {
    test.skip(!test.info().project.name.match(/iphone|pixel/), 'phone layout only');
    await signIn(page, users.member, '/c/cGeneral');
    await composer(page).locator('textarea').fill('from my phone');
    await composer(page).getByRole('button', { name: 'Schedule message' }).click();
    await page.getByRole('menuitem', { name: /^Tomorrow/ }).click();
    await expect(composer(page).getByTestId('scheduled-bar')).toContainText('1 scheduled message here');
  });
});

test.describe('reminders', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('/remind sets a reminder; it lands in Activity; snooze and done @cross', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const box = composer(page).locator('textarea');

    await box.fill('/remind me to call Ana sometime');
    await box.press('Enter');
    await expect(composer(page).getByRole('alert')).toContainText("couldn't tell when");
    await expect(box).toHaveValue('/remind me to call Ana sometime');

    await box.fill('/remind me in 1h to call Ana');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(composer(page).getByRole('status')).toContainText('Reminder set for');
    await expect(composer(page).getByRole('status')).toContainText('call Ana');
    await expect(channelMsgs(page).filter({ hasText: 'call Ana' })).toHaveCount(0); // not posted

    await composer(page).getByRole('status').getByRole('link', { name: 'View' }).click();
    await expect(page.getByTestId('reminders-list')).toContainText('call Ana');

    emu.runScheduled({ backdate: true });
    await expect(page.getByText('No reminders')).toBeVisible();

    await page.getByRole('link', { name: 'Activity' }).first().click();
    const reminder = page.getByTestId('reminder-item').filter({ hasText: 'call Ana' });
    await expect(reminder).toContainText('Reminder');
    await reminder.getByRole('button', { name: 'Snooze' }).click();
    await page.getByRole('menuitem', { name: /^In 1 hour/ }).click();
    await expect(reminder).toHaveCount(0);

    await page.getByRole('link', { name: 'Later' }).click();
    await page.getByRole('tab', { name: /Reminders/ }).click();
    await expect(page.getByTestId('reminders-list')).toContainText('call Ana');
    emu.runScheduled({ backdate: true });
    await page.getByRole('link', { name: 'Activity' }).first().click();
    await page.getByTestId('reminder-item').getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('reminder-item')).toHaveCount(0);
  });

  test('remind me about a message from its ⋯ menu', async ({ page }) => {
    await signIn(page, users.member2, '/c/cEngineering');
    const m = channelMsgs(page).filter({ hasText: 'Plan for today' });
    await m.hover();
    await m.getByRole('button', { name: 'More actions' }).click();
    await page.getByRole('menuitem', { name: 'Remind me about this' }).click();
    await page.getByRole('dialog', { name: 'Remind me about this' }).getByRole('menuitem', { name: /^Tomorrow/ }).click();

    await page.getByRole('link', { name: 'Later' }).click();
    await page.getByRole('tab', { name: /Reminders/ }).click();
    const item = page.getByTestId('reminders-list').getByTestId('scheduled-item');
    await expect(item).toContainText(/Tomorrow at 9:00/);
    await expect(item).toContainText('about a message in #engineering');
    await expect(item).toContainText('Mia Member: Plan for today');

    emu.runScheduled({ backdate: true });
    await page.getByRole('link', { name: 'Activity' }).first().click();
    const reminder = page.getByTestId('reminder-item');
    await expect(reminder).toContainText('Reminder about a message in #engineering');
    await reminder.getByRole('link').click();
    await expect(page).toHaveURL(/\/c\/cEngineering\?m=eng0/);
  });
});

test.describe('/ commands', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('typing / offers /remind and /schedule; /schedule posts later @cross', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const box = composer(page).locator('textarea');
    await box.click();
    await box.pressSequentially('/');
    const menu = composer(page).getByRole('listbox', { name: 'Commands' });
    await expect(menu.getByRole('option')).toHaveText([/\/remind.*reminder/, /\/schedule.*Schedule a message/]);

    // Esc closes it; keep typing to filter; Enter picks.
    await box.press('Escape');
    await expect(menu).toHaveCount(0);
    await box.fill('');
    await box.pressSequentially('/sch');
    await expect(menu.getByRole('option')).toHaveCount(1);
    await box.press('Enter');
    await expect(box).toHaveValue('/schedule ');
    await expect(composer(page).getByTestId('command-hint')).toContainText('/schedule tomorrow 9am');

    await box.pressSequentially('tomorrow 9am Standup notes are in the doc');
    await box.press('Enter');
    await expect(box).toHaveValue('');
    await expect(composer(page).getByRole('status')).toContainText(/Scheduled for Tomorrow at 9:00/);
    await expect(composer(page).getByTestId('scheduled-bar')).toContainText('1 scheduled message here');
    await expect(channelMsgs(page).filter({ hasText: 'Standup notes' })).toHaveCount(0);

    emu.runScheduled({ backdate: true });
    await expect(channelMsgs(page).filter({ hasText: 'Standup notes are in the doc' })).toBeVisible();
  });

  test('/schedule without a time asks for one; arrows pick /remind', async ({ page }) => {
    await signIn(page, users.member, '/c/cGeneral');
    const box = composer(page).locator('textarea');
    await box.fill('/schedule Deploy is done');
    await box.press('Enter');
    await expect(box).toHaveValue('Deploy is done');
    await page.getByRole('dialog', { name: 'Schedule message' }).getByRole('menuitem', { name: /^Next Monday/ }).click();
    await expect(composer(page).getByTestId('scheduled-bar')).toContainText('1 scheduled message here');

    await box.click();
    await box.pressSequentially('/');
    await box.press('ArrowDown');
    await box.press('ArrowDown'); // wraps back to /remind
    await box.press('Tab');
    await expect(box).toHaveValue('/remind ');
    await box.pressSequentially('me in 20 min to stretch');
    await box.press('Enter');
    await expect(composer(page).getByRole('status')).toContainText('Reminder set for');
  });
});
