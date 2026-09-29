import { test, type Page, type Browser } from '@playwright/test';
import { emu, PASSWORD } from '../helpers.ts';

const OUT = new URL('../../docs/screenshots/', import.meta.url).pathname;
const only = process.env.SHOTS?.split(',');

type Shot = { name: string; path: string; as?: string; prep?: (p: Page) => Promise<void> };

const SHOTS: Shot[] = [
  { name: 'login', path: '/login' },
  { name: 'channel', path: '/c/cEngineering' },
  { name: 'thread', path: '/c/cEngineering/t/eng1' },
  { name: 'dm', path: '/c/dm_uAdmin_uMember2' },
  { name: 'admin', path: '/admin' },
  { name: 'activity', path: '/activity', as: 'member2@flack.test' },
  { name: 'home', path: '/' },
  { name: 'dms', path: '/dms', as: 'admin@flack.test' },
  { name: 'search', path: '/search?q=storage' },
  { name: 'invite', path: '/invite/seed-invite-token-0001' },
  {
    name: 'status',
    path: '/c/cGeneral',
    prep: async (p) => {
      await p.getByTestId('user-menu').click();
      await p.getByTestId('status-menuitem').click();
    },
  },
  {
    name: 'create-channel',
    path: '/c/cGeneral',
    prep: async (p) => {
      await p.getByRole('button', { name: 'Add channel' }).first().click();
    },
  },
];

const SIZES = [
  { tag: 'desktop', viewport: { width: 1440, height: 900 }, mobile: false },
  { tag: 'phone', viewport: { width: 390, height: 844 }, mobile: true },
];

async function capture(browser: Browser, shot: Shot, size: (typeof SIZES)[number], scheme: 'light' | 'dark') {
  const ctx = await browser.newContext({
    viewport: size.viewport,
    deviceScaleFactor: 2,
    isMobile: size.mobile,
    hasTouch: size.mobile,
    colorScheme: scheme,
  });
  const page = await ctx.newPage();
  if (shot.name !== 'login' && shot.name !== 'invite') {
    await page.goto(`/login?memcache&next=${encodeURIComponent(shot.path)}`);
    await page.getByLabel('Email').fill(shot.as ?? 'admin@flack.test');
    await page.getByLabel('Password').fill(PASSWORD);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByTestId('app-shell').waitFor();
  } else {
    await page.goto(`${shot.path}?memcache`);
  }
  await page.waitForTimeout(1500);
  if (shot.prep) {
    if (size.mobile && (shot.name === 'create-channel' || shot.name === 'status')) await page.goto('/?memcache');
    await shot.prep(page).catch(() => undefined);
  }
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}${shot.name}-${size.tag}-${scheme}.png` });
  await ctx.close();
}

test('gallery', async ({ browser }) => {
  test.setTimeout(300_000);
  emu.seed({ demo: true });
  // Show off reactions and a pin in the channel shots.
  emu.set('channels/cEngineering/messages/eng2', { reactions: { uMember2: ['👀', '👍'], uAdmin: ['👍'] } });
  emu.set('channels/cEngineering/messages/eng1', { reactions: { uMember: ['🔥'] } });
  emu.set('channels/cEngineering', { pinnedIds: ['eng1'] });
  for (const shot of SHOTS.filter((s) => !only || only.includes(s.name))) {
    for (const size of SIZES) {
      for (const scheme of ['light', 'dark'] as const) {
        await capture(browser, shot, size, scheme);
      }
    }
  }
});
