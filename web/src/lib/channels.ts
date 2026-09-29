import type { Channel, UserProfile } from '../data/types';

/** Deterministic DM channel id: "dm_" + sorted member uids joined by "_". */
export function dmId(memberIds: string[]): string {
  return 'dm_' + sortedMembers(memberIds).join('_');
}

export function sortedMembers(memberIds: string[]): string[] {
  return [...new Set(memberIds)].sort();
}

/** Display name for any channel: "#name" style name, or the other members for DMs. */
export function channelTitle(channel: Channel, meId: string, users: Map<string, UserProfile>): string {
  if (channel.type !== 'dm') return channel.name;
  const others = channel.memberIds.filter((id) => id !== meId);
  if (others.length === 0) return `${users.get(meId)?.displayName ?? 'You'} (you)`;
  return others.map((id) => users.get(id)?.displayName ?? 'Unknown').join(', ');
}

export function dmOthers(channel: Channel, meId: string): string[] {
  const others = channel.memberIds.filter((id) => id !== meId);
  return others.length ? others : [meId];
}

const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,79}$/;

/** Normalizes user input into a valid channel name (lowercase, dashes). */
export function normalizeChannelName(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^#/, '')
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9_-]/g, '')
    .slice(0, 80);
}

export function isValidChannelName(name: string): boolean {
  return NAME_RE.test(name);
}

export function sortChannels(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => a.name.localeCompare(b.name));
}

export function sortByRecent(channels: Channel[]): Channel[] {
  return [...channels].sort((a, b) => (b.lastMessageAt?.toMillis() ?? 0) - (a.lastMessageAt?.toMillis() ?? 0));
}
