/** Pure notification targeting (unit-tested in recipients.test.ts). */

export type NotifyKind = 'dm' | 'mention' | 'reply' | 'message';

/** Per-channel notification setting (users/{uid}/channelPrefs/{channelId}). */
export type NotifyLevel = 'all' | 'mentions' | 'none';

export interface TargetInput {
  channelType: 'public' | 'private' | 'dm';
  memberIds: string[];
  authorId: string;
  mentions: string[];
  /** For thread replies: the parent's author and previous repliers. */
  thread?: { parentAuthorId: string; replyUserIds: string[] } | null;
  /** Users who are deactivated (never notified). */
  inactive: Set<string>;
  /** Users currently online (RTDB presence), for @here. */
  online?: Set<string>;
  /** Members who chose "All new messages" for this channel. */
  allSubscribers?: string[];
}

const PRIORITY: Record<NotifyKind, number> = { mention: 4, dm: 3, reply: 2, message: 1 };

/**
 * Who gets notified and why. One entry per person; the strongest reason wins
 * (mention > dm > thread reply > plain message). The author and non-members are never
 * notified. Mutes are applied later, to pushes only (see pushRecipients).
 */
export function notificationTargets(input: TargetInput): Map<string, NotifyKind> {
  const out = new Map<string, NotifyKind>();
  const members = new Set(input.memberIds);
  const add = (uid: string, kind: NotifyKind) => {
    if (uid === input.authorId || !members.has(uid) || input.inactive.has(uid)) return;
    const cur = out.get(uid);
    if (!cur || PRIORITY[kind] > PRIORITY[cur]) out.set(uid, kind);
  };
  if (input.channelType === 'dm') input.memberIds.forEach((u) => add(u, 'dm'));
  if (input.thread) {
    add(input.thread.parentAuthorId, 'reply');
    input.thread.replyUserIds.forEach((u) => add(u, 'reply'));
  }
  for (const m of input.mentions) {
    if (m === '!channel' && input.channelType !== 'dm') input.memberIds.forEach((u) => add(u, 'mention'));
    else if (m === '!here' && input.channelType !== 'dm') input.memberIds.filter((u) => input.online?.has(u)).forEach((u) => add(u, 'mention'));
    else if (!m.startsWith('!')) add(m, 'mention');
  }
  // "All new messages" covers top-level channel messages, not every thread reply.
  if (input.channelType !== 'dm' && !input.thread) input.allSubscribers?.forEach((u) => add(u, 'message'));
  return out;
}

/** Who actually gets a push: everyone targeted except people who muted this channel. */
export function pushRecipients(targets: Map<string, NotifyKind>, muted: Set<string>): [string, NotifyKind][] {
  return [...targets].filter(([uid]) => !muted.has(uid));
}

/** Only mentions and thread replies go to the Activity feed (and they do even when muted). */
export const isActivityKind = (k: NotifyKind) => k === 'mention' || k === 'reply';

export function notificationTitle(kind: NotifyKind, authorName: string, channelLabel: string): string {
  switch (kind) {
    case 'dm':
      return authorName;
    case 'mention':
      return `${authorName} mentioned you in ${channelLabel}`;
    case 'reply':
      return `${authorName} replied in a thread in ${channelLabel}`;
    case 'message':
      return `${authorName} in ${channelLabel}`;
  }
}

/** Plain-text body for a push: mentions resolved, markdown stripped, capped. */
export function notificationBody(text: string, names: Map<string, string>, attachmentCount: number, max = 180): string {
  let t = text
    .replace(/<@([A-Za-z0-9]{1,128})>/g, (_, uid: string) => `@${names.get(uid) ?? 'someone'}`)
    .replace(/<!(channel|here)>/g, '@$1')
    .replace(/```[\s\S]*?```/g, '[code]')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/(\*\*|__|~~|\*|_)(.+?)\1/g, '$2')
    .replace(/\s+/g, ' ')
    .trim();
  if (!t && attachmentCount) t = attachmentCount === 1 ? 'Sent a file' : `Sent ${attachmentCount} files`;
  return t.length > max ? t.slice(0, max - 1) + '…' : t;
}
