import type { Timestamp } from 'firebase/firestore';

export type Role = 'admin' | 'member';

/** Per-channel notification setting. Channels default to 'mentions', DMs to 'all'. */
export type NotifyLevel = 'all' | 'mentions' | 'none';

export interface CustomStatus {
  emoji: string;
  text: string;
  expiresAt: Timestamp | null;
}

export interface UserProfile {
  id: string;
  displayName: string;
  email: string;
  photoURL: string | null;
  title?: string;
  role: Role;
  /** 'bot' is Flackbot (lib/bot.ts), which the app adds itself; it's not a user document. */
  status: 'active' | 'deactivated' | 'bot';
  bot?: true;
  /** Three emoji shown in the message hover bar (defaults to 👍 ✅ 👀). */
  quickReactions?: string[];
  /** Custom status ("🌴 On vacation"); hidden once expiresAt has passed. */
  customStatus?: CustomStatus | null;
  /** IANA time zone, recorded by the app (for local time and DND schedules). */
  timeZone?: string;
  dnd?: DndSettings | null;
  createdAt?: Timestamp;
}

export type ChannelType = 'public' | 'private' | 'dm';

export interface Channel {
  id: string;
  name: string;
  type: ChannelType;
  memberIds: string[];
  createdBy: string;
  archived: boolean;
  topic?: string;
  createdAt?: Timestamp;
  lastMessageAt?: Timestamp;
  lastMessage?: { text: string; authorId: string };
  /** Pinned message ids (newest last). */
  pinnedIds?: string[];
  /** Secret RTDB key for typing indicators (see data/typing.ts). */
  typingKey?: string;
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

export interface Message {
  id: string;
  text: string;
  authorId: string;
  createdAt: Timestamp | null; // null while the server timestamp is pending
  editedAt?: Timestamp | null;
  threadParentId: string | null;
  attachments: Attachment[];
  mentions: string[];
  replyCount: number;
  lastReplyAt?: Timestamp | null;
  replyUserIds: string[];
  deleted?: boolean;
  pending?: boolean;
  /** { uid: [emoji, ...] } — each person owns their own entry. */
  reactions?: Record<string, string[]>;
  /** Thread reply that was also posted to the channel. */
  alsoToChannel?: boolean;
  /** Written by the unfurl function. */
  linkPreviews?: LinkPreview[];
  /** Flackbot messages: what they refer to (the message a reminder is about, etc.). */
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
}

export interface SavedItem {
  id: string; // message id
  channelId: string;
  messageId: string;
  threadParentId: string | null;
  savedAt: Timestamp | null;
}

export interface LinkPreview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

/** Do Not Disturb settings on the user doc. */
export interface DndSettings {
  until?: Timestamp | null;
  schedule?: { enabled: boolean; start: string; end: string } | null;
}

export interface Invite {
  id: string;
  email: string;
  role: Role;
  invitedBy: string;
  invitedByName: string;
  token: string;
  createdAt: Timestamp;
  expiresAt: Timestamp;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
}

export interface ActivityItem {
  id: string;
  /** reminder / schedule-failed are written by the 10-minute scheduled-items sweep. */
  kind: 'mention' | 'reply' | 'dm' | 'reminder' | 'schedule-failed';
  channelId: string | null;
  messageId: string | null;
  /** schedule-failed: why the message couldn't be sent. */
  error?: string;
  threadParentId: string | null;
  authorId: string;
  preview: string;
  createdAt: Timestamp;
}

/** users/{uid}/scheduled/{id}: a scheduled message or a reminder (see lib/schedule.ts). */
export interface ScheduledItem {
  id: string;
  kind: 'message' | 'reminder';
  sendAt: Timestamp;
  status: 'pending' | 'failed';
  createdAt: Timestamp | null;
  text: string;
  channelId: string | null;
  threadParentId: string | null;
  mentions?: string[];
  alsoToChannel?: boolean;
  messageId?: string | null;
  error?: string;
}
