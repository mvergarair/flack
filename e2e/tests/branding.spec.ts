import { test, expect } from '../fixtures.ts';
import { asUser, emu, open, signIn, users, PNG } from '../helpers.ts';

test.describe('workspace customization', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('admins set the name, logo, colors, sign-in message and default channels @cross', async ({ page, browser }) => {
    await signIn(page, users.admin, '/admin');
    await page.getByRole('button', { name: 'Customize workspace' }).click();
    const dialog = page.getByRole('dialog', { name: 'Customize workspace' });

    await dialog.getByLabel('Workspace name').fill('Acme Corp');
    await dialog.getByLabel('Sign-in message').fill('Use your @acme.com Google account.');
    await dialog.getByTestId('logo-input').setInputFiles({ name: 'acme.png', mimeType: 'image/png', buffer: PNG });
    await expect(dialog.getByAltText('Logo preview')).toBeVisible();
    await dialog.getByRole('button', { name: 'Accent color #c2185b' }).click();
    await dialog.getByLabel('Sidebar color hex').fill('#113a2e');
    // The preview follows the draft before anything is saved.
    await expect(dialog.getByTestId('branding-preview')).toContainText('Sign in to Acme Corp');
    await dialog.getByLabel('#random').uncheck();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(dialog).toHaveCount(0);

    // Applied everywhere, live.
    await expect(page.getByTestId('workspace-name')).toContainText('Acme Corp');
    await expect(page.getByTestId('workspace-name').getByTestId('brand-logo')).toBeVisible();
    await expect(page).toHaveTitle('People & invites · Acme Corp');
    const accent = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim());
    expect(accent).toBe('#c2185b');
    const sidebar = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--side-bg').trim());
    expect(sidebar).toBe('#113a2e');
    expect(emu.get<{ defaultChannelIds: string[] }>('config/app')!.defaultChannelIds).toEqual(['cGeneral']);

    // Members see it too; signed-out visitors see it on the sign-in page.
    const member = await asUser(browser, users.member, '/c/cGeneral');
    await expect(member.page.getByTestId('workspace-name')).toContainText('Acme Corp');
    await expect(member.page).toHaveTitle('#general · Acme Corp');
    await member.context.close();

    const visitor = await browser.newContext();
    const login = await visitor.newPage();
    await open(login, '/login');
    await expect(login.getByRole('heading', { name: 'Sign in to Acme Corp' })).toBeVisible();
    await expect(login.getByTestId('login-tagline')).toHaveText('Use your @acme.com Google account.');
    await expect(login.getByTestId('brand-logo')).toBeVisible();
    await visitor.close();

    // Reset brings Flack back.
    await page.getByRole('button', { name: 'Customize workspace' }).click();
    await dialog.getByRole('button', { name: 'Reset to Flack defaults' }).click();
    await dialog.getByRole('button', { name: 'Save' }).click();
    await expect(page.getByTestId('workspace-name')).toHaveText('Flack');
    await expect(page.getByTestId('brand-logo')).toHaveCount(0);
  });

  test('members cannot open the settings', async ({ page }) => {
    await signIn(page, users.member, '/admin');
    await expect(page.getByRole('button', { name: 'Customize workspace' })).toHaveCount(0);
  });
});
