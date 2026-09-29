import { test, expect } from '@playwright/test';
import { asUser, callFunction, emu, open, signIn, users, PASSWORD } from '../helpers.ts';

test.describe('admin screen', () => {
  test.beforeEach(() => {
    emu.seed();
  });

  test('invite → copy link → the invitee joins with it @mobile', async ({ page, browser }) => {
    await signIn(page, users.admin, '/admin');
    await page.getByRole('button', { name: 'Invite people' }).click();
    await page.getByLabel('Email addresses').fill('newbie@flack.test');
    await page.getByRole('dialog').getByRole('combobox').selectOption('member');
    await page.getByRole('button', { name: 'Create invite' }).click();

    const results = page.getByTestId('invite-results');
    await expect(results).toContainText('newbie@flack.test');
    const link = await results.locator('[data-copy-text]').first().getAttribute('data-copy-text');
    expect(link).toMatch(/\/invite\/[\w-]{20,}$/);
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByTestId('invite-newbie@flack.test')).toBeVisible();

    const ctx = await browser.newContext();
    const invitee = await ctx.newPage();
    await open(invitee, new URL(link!).pathname);
    await expect(invitee.getByTestId('invite-summary')).toContainText('newbie@flack.test');
    await invitee.getByLabel('Password').fill(PASSWORD);
    await invitee.getByRole('button', { name: 'Create account' }).click();
    await expect(invitee.getByTestId('app-shell')).toBeVisible();
    await ctx.close();

    // Accepted invites leave the pending list; the new person shows up under People.
    await expect(page.getByTestId('invite-newbie@flack.test')).toHaveCount(0);
    await expect(page.getByTestId('person-newbie@flack.test')).toBeVisible();
  });

  test('inviting an existing member is refused', async ({ page }) => {
    await signIn(page, users.admin, '/admin');
    await page.getByRole('button', { name: 'Invite people' }).click();
    await page.getByLabel('Email addresses').fill(users.member);
    await page.getByRole('button', { name: 'Create invite' }).click();
    await expect(page.getByTestId('invite-results')).toContainText('already a member');
  });

  test('revoking an invite removes it and kills the link', async ({ page }) => {
    await signIn(page, users.admin, '/admin');
    const row = page.getByTestId(`invite-${users.invitee}`);
    await row.getByRole('button', { name: 'Revoke' }).click();
    await page.getByRole('button', { name: 'Revoke invite' }).click();
    await expect(row).toHaveCount(0);
    expect(emu.get<{ status: string }>('invites/seedInvite')?.status).toBe('revoked');
  });

  test('promoting a member gives them the admin screen live', async ({ page, browser }) => {
    const member = await asUser(browser, users.member);
    await expect(member.page.getByRole('link', { name: 'People & invites' })).toHaveCount(0);

    await signIn(page, users.admin, '/admin');
    await page.getByTestId(`person-${users.member}`).getByLabel(/Role for/).selectOption('admin');
    await expect(member.page.getByRole('link', { name: 'People & invites' })).toBeVisible({ timeout: 15_000 });

    // And demoting takes it away again.
    await page.getByTestId(`person-${users.member}`).getByLabel(/Role for/).selectOption('member');
    await expect(member.page.getByRole('link', { name: 'People & invites' })).toHaveCount(0, { timeout: 15_000 });
    await member.context.close();
  });

  test('the last admin cannot be demoted or deactivated', async ({ page }) => {
    await signIn(page, users.admin, '/admin');
    const me = page.getByTestId(`person-${users.admin}`);
    await expect(me.getByLabel(/Role for/)).toBeDisabled();
    await expect(me.getByRole('button', { name: 'Deactivate' })).toBeDisabled();
  });

  test('deactivating signs the person out everywhere; reactivating lets them back', async ({ page, browser }) => {
    const member = await asUser(browser, users.member2);
    await signIn(page, users.admin, '/admin');
    await page.getByTestId(`person-${users.member2}`).getByRole('button', { name: 'Deactivate' }).click();
    await page.getByRole('button', { name: 'Deactivate', exact: true }).last().click();
    await expect(page.getByTestId(`person-${users.member2}`)).toContainText('Deactivated');

    await expect(member.page).toHaveURL(/\/login/, { timeout: 15_000 });
    await expect(member.page.getByRole('alert')).toContainText(/deactivated|session has ended/);
    await member.page.getByLabel('Email').fill(users.member2);
    await member.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(member.page.getByRole('alert')).toContainText('deactivated');

    await page.getByTestId(`person-${users.member2}`).getByRole('button', { name: 'Reactivate' }).click();
    await page.getByRole('button', { name: 'Reactivate', exact: true }).last().click();
    await expect(page.getByTestId(`person-${users.member2}`)).not.toContainText('Deactivated');
    await member.page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(member.page.getByTestId('app-shell')).toBeVisible();
    await member.context.close();
  });

  test('members cannot open the admin screen or call admin functions', async ({ page }) => {
    await signIn(page, users.member, '/admin');
    await expect(page).not.toHaveURL(/\/admin/);
    const res = await callFunction(users.member, 'createinvite', { email: 'sneaky@flack.test', role: 'admin' });
    expect(res.body.error?.status).toBe('PERMISSION_DENIED');
    expect(emu.query<{ email: string }>('invites').map((i) => i.email)).not.toContain('sneaky@flack.test');
  });
});
