import { test, expect, type Page } from '@playwright/test';
import { emu, open, signIn, users, PASSWORD } from '../helpers.ts';

const INVITE_TOKEN = 'seed-invite-token-0001';

async function createAccount(page: Page, email: string) {
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Password').fill(PASSWORD);
  await page.getByRole('button', { name: 'Create account' }).click();
}

test.describe('invite-only sign-in', () => {
  test.beforeEach(() => {
    emu.seed();
  });

  test('an uninvited email cannot create an account @cross', async ({ page }) => {
    await open(page, '/login');
    await createAccount(page, users.outsider);
    await expect(page.getByRole('alert')).toContainText('has not been invited');
    await expect(page.getByTestId('app-shell')).toHaveCount(0);
  });

  test('invite link → sign up → lands in #general as a member @mobile', async ({ page }) => {
    await open(page, `/invite/${INVITE_TOKEN}`);
    await expect(page.getByTestId('invite-summary')).toContainText('Ada Admin invited invitee@flack.test');
    await expect(page.getByLabel('Email')).toHaveValue(users.invitee);
    await createAccount(page, users.invitee);
    await expect(page.getByTestId('app-shell')).toBeVisible();

    const invite = emu.get<{ status: string; acceptedBy: string }>('invites/seedInvite');
    expect(invite?.status).toBe('accepted');
    const profile = emu.get<{ role: string; status: string }>(`users/${invite!.acceptedBy}`);
    expect(profile).toMatchObject({ role: 'member', status: 'active' });
    const general = emu.get<{ memberIds: string[] }>('channels/cGeneral');
    expect(general?.memberIds).toContain(invite!.acceptedBy);
    expect(emu.get<{ memberIds: string[] }>('channels/cRandom')?.memberIds).toContain(invite!.acceptedBy);
  });

  test('desktop: new member lands on #general with no admin link', async ({ page }) => {
    await open(page, `/invite/${INVITE_TOKEN}`);
    await createAccount(page, users.invitee);
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await expect(page.getByRole('link', { name: 'People & invites' })).toHaveCount(0);
  });

  test('expired invites are rejected', async ({ page }) => {
    emu.set('invites/seedInvite', { expiresAt: { __ts: Date.now() - 1000 } });
    await open(page, `/invite/${INVITE_TOKEN}`);
    await expect(page.getByTestId('invite-error')).toContainText('expired');
    await open(page, '/login');
    await createAccount(page, users.invitee);
    await expect(page.getByRole('alert')).toContainText('has not been invited');
  });

  test('revoked invites are rejected', async ({ page }) => {
    emu.set('invites/seedInvite', { status: 'revoked' });
    await open(page, `/invite/${INVITE_TOKEN}`);
    await expect(page.getByTestId('invite-error')).toContainText('revoked');
    await open(page, '/login');
    await createAccount(page, users.invitee);
    await expect(page.getByRole('alert')).toContainText('has not been invited');
  });

  test('unknown invite tokens show an error', async ({ page }) => {
    await open(page, '/invite/not-a-real-token');
    await expect(page.getByTestId('invite-error')).toContainText("isn't valid");
  });

  test('deactivated users cannot sign in', async ({ page }) => {
    await open(page, '/login');
    await page.getByLabel('Email').fill(users.deactivated);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByRole('alert')).toContainText('deactivated');
  });

  test('deep links survive the sign-in redirect', async ({ page }) => {
    await open(page, '/c/cRandom');
    await expect(page).toHaveURL(/\/login\?next=/);
    await page.getByLabel('Email').fill(users.member);
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(page.getByTestId('channel-title')).toHaveText('random');
  });
});

test.describe('first admin bootstrap', () => {
  test('the configured first email becomes admin and gets default channels', async ({ page }) => {
    emu.seed({ bootstrapped: false });
    await open(page, '/login');
    await createAccount(page, 'someone@flack.test');
    await expect(page.getByRole('alert')).toContainText('has not been invited');

    await createAccount(page, 'boss@flack.test');
    await expect(page.getByTestId('channel-title')).toHaveText('general');
    await expect(page.getByRole('link', { name: 'People & invites' })).toBeVisible();
    const cfg = emu.get<{ bootstrapped: boolean; defaultChannelIds: string[] }>('config/app');
    expect(cfg).toMatchObject({ bootstrapped: true, defaultChannelIds: ['general', 'random'] });

    // Once bootstrapped, the first-admin email is no longer special.
    await page.getByTestId('user-menu').click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await expect(page).toHaveURL(/\/login/);
  });

  test('signing in again keeps the admin role claim', async ({ page }) => {
    emu.seed();
    await signIn(page, users.admin);
    await expect(page.getByRole('link', { name: 'People & invites' })).toBeVisible();
  });
});
