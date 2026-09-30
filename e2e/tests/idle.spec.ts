import { test, expect } from '../fixtures.ts';
import type { Page } from '@playwright/test';
import { emu, signIn, users } from '../helpers.ts';

// Idle screens must be quiet: once a screen has loaded and nobody does anything, no listener
// should keep firing. The fixture's loop guard already checks every test; this one visits each
// main screen and sits still long enough for a loop to trip the wire (20 snapshots in 10s).
// It catches effects that write what they watch, like the Ask Flackbot pane marking its DM as
// read over and over, which looked fine on screen but used ~45% of the free daily reads.
const IDLE_MS = 6000;
const CONVERSATION = '0123456789abcdef01234567';

async function idle(page: Page, what: string) {
  await page.waitForTimeout(IDLE_MS);
  const loops = await page.evaluate(() => window.__flackLoops ?? []);
  expect(loops, `${what}: listeners fired over and over while idle`).toEqual([]);
}

function seedAskConversation() {
  const now = Date.now();
  const at = (minAgo: number) => ({ __ts: now - minAgo * 60_000 });
  const base = { threadParentId: null, attachments: [], mentions: [], replyCount: 0, replyUserIds: [], seeded: true };
  const dm = 'dm_flackbot_uMember';
  emu.set('config/ai', { enabled: true, model: 'claude-sonnet-5-5', dailyLimit: 30, monthlyBudgetUsd: 20 });
  emu.set(`channels/${dm}`, { name: '', type: 'dm', memberIds: ['flackbot', 'uMember'], createdBy: 'flackbot', archived: false, createdAt: at(60), lastMessageAt: at(1), lastMessage: { text: 'Answer', authorId: 'flackbot' } });
  emu.set(`channels/${dm}/messages/q1`, { ...base, text: 'What did we decide about uploads?', authorId: 'uMember', createdAt: at(2), ai: { conversationId: CONVERSATION } });
  emu.set(`channels/${dm}/messages/ai_q1`, {
    ...base,
    text: 'Storage rules limit uploads to channel members [1].',
    authorId: 'flackbot',
    createdAt: at(1),
    ai: { conversationId: CONVERSATION, questionId: 'q1' },
    botRef: { kind: 'ai', sources: [{ n: 1, channelId: 'cEngineering', messageId: 'eng1', threadParentId: null, label: '#engineering · Ada Admin' }] },
  });
}

test.describe('idle screens', () => {
  test.beforeEach(() => {
    emu.seed({ demo: true });
  });

  test('stay quiet: no listener keeps firing while nothing happens', async ({ page }) => {
    test.skip(!!test.info().project.name.match(/iphone|pixel/), 'desktop layout');
    test.setTimeout(120_000); // seven screens, each watched for a few idle seconds
    seedAskConversation();
    await page.addInitScript((id) => localStorage.setItem('flack:flackbot:conversation', id), CONVERSATION);
    await signIn(page, users.member, '/c/cGeneral');

    await expect(page.getByTestId('message-list')).toBeVisible();
    await idle(page, 'channel');

    await page.goto('/c/cEngineering/t/eng1?memcache');
    await expect(page.getByTestId('thread-panel')).toBeVisible();
    await idle(page, 'thread');

    // The Ask Flackbot pane with an answered, unread question (the case that looped).
    await page.getByTestId('ask-flackbot').click();
    await expect(page.getByTestId('flackbot-answer')).toBeVisible();
    await idle(page, 'Ask Flackbot pane');

    await page.goto('/c/dm_flackbot_uMember?memcache');
    await expect(page.getByTestId('message-list')).toContainText('Storage rules');
    await idle(page, 'Flackbot DM');

    for (const [path, name] of [
      ['/activity', 'Activity'],
      ['/later', 'Later'],
      ['/search?q=upload', 'Search'],
    ] as const) {
      await page.goto(`${path}${path.includes('?') ? '&' : '?'}memcache`);
      await expect(page.getByTestId('app-shell')).toBeVisible();
      await idle(page, name);
    }
  });

  test('admin page stays quiet too', async ({ page }) => {
    test.skip(!!test.info().project.name.match(/iphone|pixel/), 'desktop layout');
    await signIn(page, users.admin, '/admin');
    await expect(page.getByTestId('people-list')).toBeVisible();
    await idle(page, 'admin');
  });
});
