import type { Timestamp } from 'firebase/firestore';
import type { Channel } from '../data/types';

/**
 * A channel is unread when its latest message is from someone else and newer than my
 * marker. A marker I moved back with "Mark unread" (`manual`) counts whoever wrote last.
 */
export function isUnread(channel: Channel, reads: Map<string, Timestamp>, meId: string, manual?: Set<string>): boolean {
  const last = channel.lastMessageAt;
  if (!last || !channel.lastMessage) return false;
  if (channel.lastMessage.authorId === meId && !manual?.has(channel.id)) return false;
  const read = reads.get(channel.id);
  return !read || last.toMillis() > read.toMillis();
}
