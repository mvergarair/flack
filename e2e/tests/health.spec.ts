import { test, expect } from '../fixtures.ts';
import { emu, signIn, users } from '../helpers.ts';

test.describe('health and anonymous statistics', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('admins see the daily health snapshot, what was sent, and can turn statistics off @cross', async ({ page }) => {
    emu.runDaily();
    await signIn(page, users.admin, '/admin');

    const health = page.getByTestId('health-card');
    await expect(health).toContainText('Messages');
    await expect(health).toContainText('Active this week');
    await expect(health).toContainText('of 3');

    // One-time notice after updating: dismiss it.
    const notice = page.getByTestId('telemetry-notice');
    await expect(notice).toContainText('no messages, names or emails');
    await notice.getByRole('button', { name: 'OK' }).click();
    await expect(notice).toHaveCount(0);

    const card = page.getByTestId('telemetry-card');
    await expect(card).toContainText('Never messages, names, emails');
    await card.getByRole('button', { name: 'See exactly what was sent' }).click();
    const report = card.getByTestId('telemetry-report');
    await expect(report).toContainText('"schema": 1');
    await expect(report).not.toContainText('Ada');

    await card.getByRole('switch', { name: 'Share anonymous usage statistics' }).uncheck();
    await expect(card).toContainText('Off');
    expect(emu.get<{ enabled: boolean }>('config/telemetry')!.enabled).toBe(false);
    emu.runDaily();
    expect(emu.get<{ lastReport: unknown }>('config/telemetry')!.lastReport).toBeNull();
  });

  test('members see neither', async ({ page }) => {
    emu.runDaily();
    await signIn(page, users.member, '/admin');
    await expect(page.getByTestId('health-card')).toHaveCount(0);
    await expect(page.getByTestId('telemetry-card')).toHaveCount(0);
  });
});
