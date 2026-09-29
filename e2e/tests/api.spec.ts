import { test, expect } from '@playwright/test';
import { asUser, emu, signIn, users } from '../helpers.ts';

// The dev server doesn't proxy /api (Hosting does in production), so call the function directly.
const API = 'http://127.0.0.1:5301/demo-flack/us-central1/api/v1';

test.describe('API tokens', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('create a token in the app, post through the API, see it live; revoke it @cross', async ({ page, browser, request }) => {
    await signIn(page, users.member, '/c/cGeneral');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'API tokens' }).click();
    const dialog = page.getByRole('dialog', { name: 'API tokens' });
    await dialog.getByLabel('Name').fill('Deploy bot');
    await dialog.getByRole('button', { name: 'Create token' }).click();

    const value = dialog.getByTestId('token-value');
    await expect(value).toHaveText(/^flk_[A-Za-z0-9_-]{43}$/);
    const token = (await value.textContent())!;
    await expect(dialog.getByTestId('new-token')).toContainText("You won't see it again");
    const row = dialog.getByTestId('token-list').getByRole('listitem').filter({ hasText: 'Deploy bot' });
    await expect(row).toContainText('read and post');
    await expect(row).toContainText('never used');
    await expect(row).not.toContainText(token);

    // A teammate watching #general sees the API message arrive live.
    const admin = await asUser(browser, users.admin, '/c/cGeneral');
    const auth = { Authorization: `Bearer ${token}` };
    const me = await request.get(`${API}/me`, { headers: auth });
    expect(me.status()).toBe(200);
    expect((await me.json()).user.name).toBe('Mia Member');
    const posted = await request.post(`${API}/channels/cGeneral/messages`, { headers: auth, data: { text: 'Deploy 1.2.0 finished ✅' } });
    expect(posted.status()).toBe(201);
    await expect(admin.page.getByTestId('message-list').getByTestId('message').filter({ hasText: 'Deploy 1.2.0 finished' })).toContainText('Mia Member');
    await admin.context.close();

    await expect(row).toContainText('last used');
    await row.getByRole('button', { name: 'Revoke Deploy bot' }).click();
    await expect(row).toHaveCount(0);
    expect((await request.get(`${API}/me`, { headers: auth })).status()).toBe(401);
  });

  test('read-only tokens cannot post', async ({ page, request }) => {
    await signIn(page, users.member, '/c/cGeneral');
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'API tokens' }).click();
    const dialog = page.getByRole('dialog', { name: 'API tokens' });
    await dialog.getByLabel('Name').fill('Dashboard');
    await dialog.getByLabel('Access').selectOption('read');
    await dialog.getByRole('button', { name: 'Create token' }).click();
    const token = (await dialog.getByTestId('token-value').textContent())!;
    await expect(dialog.getByTestId('token-list')).toContainText('read only');

    const r = await request.post(`${API}/channels/cGeneral/messages`, { headers: { Authorization: `Bearer ${token}` }, data: { text: 'nope' } });
    expect(r.status()).toBe(403);
    expect((await r.json()).error.code).toBe('insufficient_scope');
  });
});

test.describe('API reference', () => {
  // The production-mode preview (web/dist-emu) includes the docs, like Hosting does.
  const PREVIEW = 'http://127.0.0.1:5318';

  test('each deployment serves an interactive reference and the OpenAPI spec', async ({ page, request }) => {
    const spec = await (await request.get(`${PREVIEW}/api/openapi.json`)).json();
    expect(spec.openapi).toBe('3.1.0');
    expect(Object.keys(spec.paths)).toContain('/channels/{channelId}/messages');
    expect(spec.servers[0].url).toBe('/api/v1');

    const errors: string[] = [];
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${PREVIEW}/api/docs/`);
    await expect(page).toHaveTitle('Flack API');
    await expect(page.getByRole('heading', { name: 'Flack API', level: 1 })).toBeVisible();
    await page.goto(`${PREVIEW}/api/docs/#tag/messages/POST/channels/{channelId}/messages`);
    await expect(page.getByRole('heading', { name: 'Post a message' })).toBeVisible();
    // No Scalar extras, and nothing blocked by the page's Content-Security-Policy.
    await expect(page.getByText('Ask AI')).toHaveCount(0);
    await expect(page.getByText('Generate MCP')).toHaveCount(0);
    expect(errors.filter((e) => /Content Security Policy|Refused/.test(e))).toEqual([]);
  });
});
