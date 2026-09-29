import { describe, expect, it } from 'vitest';
import { Timestamp } from 'firebase/firestore';
import { sidebarOrder, stepChannel, stepUnread } from './navigation';
import type { Channel } from '../data/types';

const ch = (id: string, type: Channel['type'], name: string, last = 0, archived = false): Channel => ({
  id,
  name,
  type,
  memberIds: [],
  createdBy: 'x',
  archived,
  lastMessageAt: Timestamp.fromMillis(last),
});

const channels = [
  ch('r', 'public', 'random'),
  ch('g', 'public', 'general'),
  ch('old', 'public', 'archived-room', 0, true),
  ch('d1', 'dm', '', 100),
  ch('d2', 'dm', '', 200),
];

describe('keyboard channel navigation', () => {
  const order = sidebarOrder(channels);

  it('follows sidebar order: channels A→Z, then DMs newest first, no archived', () => {
    expect(order.map((c) => c.id)).toEqual(['g', 'r', 'd2', 'd1']);
  });

  it('steps up and down, wrapping at the ends', () => {
    expect(stepChannel(order, 'g', 1)?.id).toBe('r');
    expect(stepChannel(order, 'g', -1)?.id).toBe('d1');
    expect(stepChannel(order, 'd1', 1)?.id).toBe('g');
    expect(stepChannel(order, undefined, 1)?.id).toBe('g');
    expect(stepChannel(order, undefined, -1)?.id).toBe('d1');
  });

  it('jumps to the next or previous unread channel', () => {
    const unread = new Set(['r', 'd1']);
    const isUnread = (c: Channel) => unread.has(c.id);
    expect(stepUnread(order, 'g', 1, isUnread)?.id).toBe('r');
    expect(stepUnread(order, 'r', 1, isUnread)?.id).toBe('d1');
    expect(stepUnread(order, 'd1', 1, isUnread)?.id).toBe('r');
    expect(stepUnread(order, 'g', -1, isUnread)?.id).toBe('d1');
    expect(stepUnread(order, undefined, 1, isUnread)?.id).toBe('r');
  });

  it('returns nothing when there is no other unread channel', () => {
    expect(stepUnread(order, 'r', 1, (c) => c.id === 'r')).toBeUndefined();
    expect(stepUnread(order, 'g', 1, () => false)).toBeUndefined();
  });
});
