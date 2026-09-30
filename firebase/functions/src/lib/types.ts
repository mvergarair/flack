import type { Timestamp } from 'firebase-admin/firestore';

export type Role = 'admin' | 'member';
export type UserStatus = 'active' | 'deactivated';

export interface UserDoc {
  displayName: string;
  email: string;
  emailLower: string;
  photoURL: string | null;
  title: string;
  role: Role;
  status: UserStatus;
  createdAt: Timestamp;
  deactivatedAt?: Timestamp | null;
}

export type InviteStatus = 'pending' | 'accepted' | 'revoked' | 'expired';

export interface InviteDoc {
  email: string;
  emailLower: string;
  role: Role;
  invitedBy: string;
  invitedByName: string;
  token: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: InviteStatus;
  acceptedBy?: string;
  acceptedAt?: Timestamp;
}

export interface Attachment {
  name: string;
  size: number;
  contentType: string;
  storagePath: string;
  thumbPath?: string | null;
  width?: number | null;
  height?: number | null;
}

export interface MessageDoc {
  text: string;
  authorId: string;
  createdAt: Timestamp;
  threadParentId: string | null;
  attachments: Attachment[];
  mentions: string[];
  replyCount: number;
  replyUserIds: string[];
  deleted?: boolean;
  /** Flackbot messages: what the app links to (the message a reminder is about, etc.). */
  botRef?: {
    kind: 'reminder' | 'schedule-failed' | 'welcome' | 'ai';
    text?: string;
    channelId?: string;
    messageId?: string;
    threadParentId?: string | null;
    /** Ask Flackbot answers: the messages cited as [n]. */
    sources?: { n: number; channelId: string; messageId: string; threadParentId: string | null; label: string }[];
  };
  /** Ask Flackbot questions and answers: which conversation they belong to. */
  ai?: { conversationId: string; questionId?: string };
  /** Emulator seed data only. */
  seeded?: boolean;
}

export interface ChannelDoc {
  name: string;
  type: 'public' | 'private' | 'dm';
  memberIds: string[];
  createdBy: string;
  archived: boolean;
}

/**
 * users/{uid}/scheduled/{id}: a scheduled message or a reminder. The 10-minute sweep sends
 * due items: messages are posted (with id = this doc's id) and the doc is deleted; reminders
 * become a message in the person's Flackbot DM (bot/bot.ts). Items that can't be sent stay here as status 'failed'.
 */
export interface ScheduledDoc {
  kind: 'message' | 'reminder';
  sendAt: Timestamp;
  status: 'pending' | 'failed';
  createdAt: Timestamp;
  text: string;
  /** Message: where to post. Reminder: the message it's about (optional). */
  channelId: string | null;
  threadParentId: string | null;
  /** Message only. */
  mentions?: string[];
  alsoToChannel?: boolean;
  /** Reminder about a message. */
  messageId?: string | null;
  /** Set by the sweep when status is 'failed'. */
  error?: string;
}
