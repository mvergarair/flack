// The 10-minute sweep (sendscheduled): posts scheduled messages, fires reminders, and marks
// items that can no longer be sent as failed.
import { beforeEach, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../../../', import.meta.url));
const cli = (...args: string[]) => execFileSync(`${ROOT}node_modules/.bin/tsx`, ['scripts/emu-cli.ts', ...args], { cwd: ROOT, encoding: 'utf8' });
const set = (path: string, data: unknown) => cli('set', path, JSON.stringify(data));
const get = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('get', path)) as T | null;
const query = <T = Record<string, unknown>>(path: string) => JSON.parse(cli('query', path)) as (T & { id: string })[];

const past = () => ({ __ts: Date.now() - 120_000 });
const future = () => ({ __ts: Math.ceil((Date.now() + 3_600_000) / 600_000) * 600_000 });
const item = (extra: Record<string, unknown>) => ({ status: 'pending', createdAt: { __ts: Date.now() }, threadParentId: null, ...extra });

beforeEach(() => {
  cli('seed', JSON.stringify({ demo: true }));
});

describe('sendscheduled', () => {
  it('posts due messages as the author (channel + thread), once, and leaves future ones', async () => {
    set('users/uMember/scheduled/sm1', item({ kind: 'message', sendAt: past(), text: 'morning <@uAdmin>', channelId: 'cGeneral', mentions: ['uAdmin'] }));
    set('users/uMember/scheduled/sm2', item({ kind: 'message', sendAt: past(), text: 'thread follow-up', channelId: 'cEngineering', threadParentId: 'eng0', mentions: [], alsoToChannel: true }));
    set('users/uMember/scheduled/later', item({ kind: 'message', sendAt: future(), text: 'not yet', channelId: 'cGeneral', mentions: [] }));
    const before = get<{ replyCount: number }>('channels/cEngineering/messages/eng0')!.replyCount;

    cli('run-scheduled');

    const m1 = get<{ authorId: string; text: string; mentions: string[] }>('channels/cGeneral/messages/sm1');
    expect(m1).toMatchObject({ authorId: 'uMember', text: 'morning <@uAdmin>', mentions: ['uAdmin'] });
    expect(get('channels/cGeneral')).toMatchObject({ lastMessage: { text: 'morning @Ada Admin', authorId: 'uMember' } });
    expect(get('channels/cEngineering/messages/sm2')).toMatchObject({ threadParentId: 'eng0', alsoToChannel: true });
    expect(get<{ replyCount: number; replyUserIds: string[] }>('channels/cEngineering/messages/eng0')).toMatchObject({ replyCount: before + 1 });
    expect(get('users/uMember/scheduled/sm1')).toBeNull();
    expect(get('users/uMember/scheduled/later')).toMatchObject({ status: 'pending' });
    expect(get('channels/cGeneral/messages/later')).toBeNull();

    // The normal pipeline runs: the mentioned admin gets an Activity item.
    await expect.poll(() => get('users/uAdmin/activity/sm1'), { timeout: 10_000 }).toMatchObject({ kind: 'mention' });

    // Running again doesn't post twice.
    cli('run-scheduled');
    expect(query('channels/cGeneral/messages').filter((m) => m.id === 'sm1')).toHaveLength(1);
  }, 60_000);

  it('marks messages that can no longer be sent as failed and tells the author in their Flackbot DM', async () => {
    set('users/uMember2/scheduled/nope', item({ kind: 'message', sendAt: past(), text: 'secret plans', channelId: 'cSecret', mentions: [] }));
    set('channels/cRandom', { archived: true });
    set('users/uMember/scheduled/arch', item({ kind: 'message', sendAt: past(), text: 'to archived', channelId: 'cRandom', mentions: [] }));

    cli('run-scheduled');

    expect(get('channels/cSecret/messages/nope')).toBeNull();
    expect(get('users/uMember2/scheduled/nope')).toMatchObject({ status: 'failed', error: expect.stringMatching(/no longer a member/) });
    expect(get('users/uMember/scheduled/arch')).toMatchObject({ status: 'failed', error: expect.stringMatching(/archived/) });
    const notice = query<{ authorId: string; text: string; botRef: { kind: string } }>('channels/dm_flackbot_uMember/messages').filter((m) => m.botRef?.kind !== 'welcome');
    expect(notice).toHaveLength(1);
    expect(notice[0]).toMatchObject({ authorId: 'flackbot', botRef: { kind: 'schedule-failed' } });
    expect(notice[0].text).toMatch(/in #random couldn't be sent: .*archived[\s\S]*to archived/);
  }, 60_000);

  it('sends reminders to your Flackbot DM (pushed like a DM), about a message or free text, once', async () => {
    set('users/uMember/private/tokens', { tokens: { tok1: true } });
    set('users/uMember/scheduled/r1', item({ kind: 'reminder', sendAt: past(), text: 'call Ana', channelId: null, messageId: null }));
    set('users/uMember/scheduled/r2', item({ kind: 'reminder', sendAt: past(), text: 'Look at the upload flow', channelId: 'cEngineering', messageId: 'eng0' }));

    cli('run-scheduled');

    expect(get('users/uMember/scheduled/r1')).toBeNull();
    expect(get('channels/dm_flackbot_uMember')).toMatchObject({ type: 'dm', memberIds: ['flackbot', 'uMember'] });
    expect(get('channels/dm_flackbot_uMember/messages/r_r1')).toMatchObject({ authorId: 'flackbot', text: '⏰ Reminder: call Ana', botRef: { kind: 'reminder' } });
    expect(get('channels/dm_flackbot_uMember/messages/r_r2')).toMatchObject({
      text: '⏰ Reminder: Look at the upload flow',
      botRef: { kind: 'reminder', channelId: 'cEngineering', messageId: 'eng0', threadParentId: null },
    });
    await expect
      .poll(() => query<{ title: string; body: string }>('_debug/pushes/items').filter((p) => p.title === 'Flackbot').map((p) => p.body).sort(), { timeout: 15_000 })
      .toEqual(['⏰ Reminder: Look at the upload flow', '⏰ Reminder: call Ana']);

    // The DM didn't exist yet, so Flackbot's welcome comes first (and sends no push).
    expect(get('channels/dm_flackbot_uMember/messages/welcome_uMember')).toMatchObject({ authorId: 'flackbot', botRef: { kind: 'welcome' }, text: expect.stringMatching(/I'm Flackbot/) });

    cli('run-scheduled');
    expect(query('channels/dm_flackbot_uMember/messages')).toHaveLength(3);
  }, 60_000);

  it('holds reminder pushes during Do Not Disturb (the DM still gets them)', async () => {
    set('users/uMember/private/tokens', { tokens: { tok1: true } });
    set('users/uMember', { dnd: { until: { __ts: Date.now() + 3_600_000 } } });
    set('users/uMember/scheduled/r3', item({ kind: 'reminder', sendAt: past(), text: 'quiet one', channelId: null, messageId: null }));

    cli('run-scheduled');

    expect(get('channels/dm_flackbot_uMember/messages/r_r3')).toMatchObject({ text: '⏰ Reminder: quiet one' });
    await new Promise((r) => setTimeout(r, 3000));
    expect(query<{ body: string }>('_debug/pushes/items').filter((p) => p.body.includes('quiet one'))).toHaveLength(0);
  }, 60_000);

  it('skips reminders for people who were deactivated', async () => {
    set('users/uGone/scheduled/r4', item({ kind: 'reminder', sendAt: past(), text: 'too late', channelId: null, messageId: null }));
    cli('run-scheduled');
    expect(get('users/uGone/scheduled/r4')).toBeNull();
    expect(get('channels/dm_flackbot_uGone')).toBeNull();
  }, 60_000);
});
