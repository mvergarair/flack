import type { Channel } from '../data/types';
import { sortByRecent, sortChannels } from './channels';

/** Channels in the same order as the sidebar: channels A→Z, then DMs by most recent. */
export function sidebarOrder(channels: Channel[]): Channel[] {
  return [...sortChannels(channels.filter((c) => c.type !== 'dm' && !c.archived)), ...sortByRecent(channels.filter((c) => c.type === 'dm'))];
}

/** Next/previous channel in sidebar order, wrapping around. */
export function stepChannel(order: Channel[], currentId: string | undefined, dir: 1 | -1): Channel | undefined {
  if (!order.length) return undefined;
  const i = order.findIndex((c) => c.id === currentId);
  if (i === -1) return dir === 1 ? order[0] : order[order.length - 1];
  return order[(i + dir + order.length) % order.length];
}

/** Next/previous unread channel in sidebar order (wrapping), skipping the current one. */
export function stepUnread(order: Channel[], currentId: string | undefined, dir: 1 | -1, unread: (c: Channel) => boolean): Channel | undefined {
  const n = order.length;
  if (!n) return undefined;
  const start = order.findIndex((c) => c.id === currentId);
  for (let k = 1; k <= n; k++) {
    const idx = start === -1 ? (dir === 1 ? k - 1 : n - k) : (((start + dir * k) % n) + n) % n;
    const c = order[idx];
    if (c.id !== currentId && unread(c)) return c;
  }
  return undefined;
}
