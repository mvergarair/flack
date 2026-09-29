import { describe, expect, it } from 'vitest';
import { isActivityKind, notificationBody, notificationTargets, notificationTitle, pushRecipients } from './recipients.js';

const base = { memberIds: ['a', 'b', 'c', 'd'], authorId: 'a', mentions: [] as string[], thread: null, inactive: new Set<string>() };

describe('notificationTargets', () => {
  it('notifies every other DM member', () => {
    const t = notificationTargets({ ...base, channelType: 'dm', memberIds: ['a', 'b', 'c'] });
    expect([...t]).toEqual([
      ['b', 'dm'],
      ['c', 'dm'],
    ]);
  });

  it('notifies mentioned channel members only, never the author', () => {
    const t = notificationTargets({ ...base, channelType: 'public', mentions: ['a', 'b', 'zz'] });
    expect([...t]).toEqual([['b', 'mention']]);
  });

  it('notifies the thread parent author and previous repliers', () => {
    const t = notificationTargets({ ...base, channelType: 'public', authorId: 'c', thread: { parentAuthorId: 'a', replyUserIds: ['b', 'c'] } });
    expect(Object.fromEntries(t)).toEqual({ a: 'reply', b: 'reply' });
  });

  it('a mention beats a thread reply for the same person', () => {
    const t = notificationTargets({ ...base, channelType: 'public', authorId: 'c', mentions: ['a'], thread: { parentAuthorId: 'a', replyUserIds: [] } });
    expect(t.get('a')).toBe('mention');
  });

  it('skips deactivated people', () => {
    const t = notificationTargets({ ...base, channelType: 'dm', inactive: new Set(['b']) });
    expect([...t.keys()]).toEqual(['c', 'd']);
  });

  it('plain channel messages notify nobody', () => {
    expect(notificationTargets({ ...base, channelType: 'public' }).size).toBe(0);
  });
});

describe('notification copy', () => {
  it('titles by reason', () => {
    expect(notificationTitle('dm', 'Ana', 'a direct message')).toBe('Ana');
    expect(notificationTitle('mention', 'Ana', '#eng')).toBe('Ana mentioned you in #eng');
    expect(notificationTitle('reply', 'Ana', '#eng')).toBe('Ana replied in a thread in #eng');
  });

  it('bodies resolve mentions and strip markdown', () => {
    expect(notificationBody('**hi** <@b> see `x`', new Map([['b', 'Bea']]), 0)).toBe('hi @Bea see x');
    expect(notificationBody('', new Map(), 2)).toBe('Sent 2 files');
    expect(notificationBody('x'.repeat(500), new Map(), 0)).toHaveLength(180);
  });
});

describe('@channel and @here', () => {
  it('@channel notifies every active member except the author', () => {
    const t = notificationTargets({ ...base, channelType: 'public', mentions: ['!channel'], inactive: new Set(['d']) });
    expect(Object.fromEntries(t)).toEqual({ b: 'mention', c: 'mention' });
  });

  it('@here notifies only members who are online', () => {
    const t = notificationTargets({ ...base, channelType: 'public', mentions: ['!here'], online: new Set(['a', 'c', 'zz']) });
    expect(Object.fromEntries(t)).toEqual({ c: 'mention' });
  });

  it('is ignored in DMs (everyone there is already notified)', () => {
    const t = notificationTargets({ ...base, channelType: 'dm', memberIds: ['a', 'b'], mentions: ['!channel'] });
    expect(Object.fromEntries(t)).toEqual({ b: 'dm' });
  });

  it('push bodies show @channel / @here', () => {
    expect(notificationBody('<!channel> standup in 5', new Map(), 0)).toBe('@channel standup in 5');
  });
});

describe('per-channel notification settings', () => {
  it('"All new messages" subscribers hear about plain top-level messages', () => {
    const t = notificationTargets({ ...base, channelType: 'public', allSubscribers: ['b', 'a', 'zz'] });
    expect(Object.fromEntries(t)).toEqual({ b: 'message' });
    expect(notificationTitle('message', 'Ana', '#eng')).toBe('Ana in #eng');
  });

  it('a mention still wins over a plain message', () => {
    const t = notificationTargets({ ...base, channelType: 'public', mentions: ['b'], allSubscribers: ['b', 'c'] });
    expect(Object.fromEntries(t)).toEqual({ b: 'mention', c: 'message' });
  });

  it('"All" does not include other people\'s thread replies', () => {
    const t = notificationTargets({ ...base, channelType: 'public', authorId: 'c', thread: { parentAuthorId: 'a', replyUserIds: [] }, allSubscribers: ['b'] });
    expect(Object.fromEntries(t)).toEqual({ a: 'reply' });
  });

  it('muting removes pushes, even for mentions and DMs', () => {
    const t = notificationTargets({ ...base, channelType: 'dm', memberIds: ['a', 'b', 'c'], mentions: ['b'] });
    expect(pushRecipients(t, new Set(['b']))).toEqual([['c', 'dm']]);
  });

  it('only mentions and thread replies become Activity items', () => {
    expect(['mention', 'reply', 'dm', 'message'].filter((k) => isActivityKind(k as never))).toEqual(['mention', 'reply']);
  });
});

