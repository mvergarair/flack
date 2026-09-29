import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';

/**
 * Why a scheduled message can't be posted any more (null = fine). Checked at send time, since
 * a lot can change between scheduling and sending.
 */
export function cannotSend(p: {
  uid: string;
  user: UserDoc | undefined;
  channel: ChannelDoc | undefined;
  threadParentId: string | null;
  parent: MessageDoc | undefined;
}): string | null {
  if (!p.user || p.user.status !== 'active') return 'Your account is not active.';
  if (!p.channel) return 'The conversation no longer exists.';
  if (!p.channel.memberIds.includes(p.uid)) return 'You are no longer a member of this conversation.';
  if (p.channel.archived) return 'The channel was archived.';
  if (p.threadParentId && (!p.parent || p.parent.threadParentId)) return 'The thread no longer exists.';
  return null;
}

