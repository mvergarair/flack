import type Anthropic from '@anthropic-ai/sdk';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';
import { searchAs } from '../search/callable.js';
import { BOT_ID, botDmId } from '../bot/rules.js';

/**
 * Flackbot's tools. Every one runs as the person asking: it only returns channels and messages
 * they're a member of (the same checks the app's rules make), and never writes anything.
 */
export const TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_messages',
    description:
      'Search messages in the channels and direct messages the person belongs to, newest first (up to 15 results). Matches all the given words (accents and case ignored; words match their beginnings). Optionally narrow by channel, author or date.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'A few distinctive words, e.g. "pricing launch". Not a full sentence.' },
        channel: { type: 'string', description: 'Optional channel name (e.g. "general") or a channel id from list_channels.' },
        from_person: { type: 'string', description: "Optional: only messages by this person (part of their name)." },
        after: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD): only messages on or after this day.' },
        before: { type: 'string', description: 'Optional ISO date (YYYY-MM-DD): only messages before this day.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_channel',
    description: "Read the latest messages in a channel or direct message the person belongs to (oldest first), or the ones before a date. Use it for questions like \"what's new in #engineering\" or to see context around a search result.",
    input_schema: {
      type: 'object',
      properties: {
        channel: { type: 'string', description: 'Channel name (e.g. "general") or a channel id from list_channels.' },
        before: { type: 'string', description: 'Optional ISO date or date-time: read messages before this moment.' },
        limit: { type: 'integer', description: 'How many messages, 1-40 (default 25).' },
      },
      required: ['channel'],
    },
  },
  {
    name: 'read_thread',
    description: 'Read a whole thread: the message with this ref number and all its replies.',
    input_schema: {
      type: 'object',
      properties: { ref: { type: 'integer', description: 'The ref number of any message in the thread.' } },
      required: ['ref'],
    },
  },
  {
    name: 'list_channels',
    description: 'List the channels and direct messages the person belongs to, with topics and member counts.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'find_people',
    description: "Look people up by name: their name, title and time zone. Leave the name empty to list everyone.",
    input_schema: {
      type: 'object',
      properties: { name: { type: 'string', description: 'Part of a name.' } },
    },
  },
];

export interface Source {
  n: number;
  channelId: string;
  messageId: string;
  threadParentId: string | null;
  label: string;
}

/** Everything the tools have shown this question, numbered for citations. */
export class Refs {
  private list: Source[] = [];
  private byMessage = new Map<string, number>();
  add(s: Omit<Source, 'n'>): number {
    const key = `${s.channelId}/${s.messageId}`;
    const existing = this.byMessage.get(key);
    if (existing) return existing;
    const n = this.list.length + 1;
    this.list.push({ ...s, n });
    this.byMessage.set(key, n);
    return n;
  }
  get(n: number): Source | undefined {
    return this.list[n - 1];
  }
  /** The sources an answer actually cites, in order of first mention. */
  cited(text: string): Source[] {
    const seen = new Set<number>();
    for (const m of text.matchAll(/\[(\d{1,3})\]/g)) seen.add(Number(m[1]));
    return [...seen].map((n) => this.get(n)).filter((s): s is Source => !!s).slice(0, 12);
  }
}

/** What the tools need about the asker, loaded once per question. */
export interface ToolContext {
  uid: string;
  refs: Refs;
  users: Map<string, UserDoc>;
  channels: Map<string, ChannelDoc & { id: string }>;
}

export async function toolContext(uid: string, refs: Refs): Promise<ToolContext> {
  const [users, channels] = await Promise.all([
    db.collection('users').get(),
    db.collection('channels').where('memberIds', 'array-contains', uid).get(),
  ]);
  return {
    uid,
    refs,
    users: new Map(users.docs.map((d) => [d.id, d.data() as UserDoc])),
    channels: new Map(channels.docs.map((d) => [d.id, { id: d.id, ...(d.data() as ChannelDoc) }])),
  };
}

const MAX_TEXT = 400;

function nameOf(ctx: ToolContext, uid: string): string {
  if (uid === BOT_ID) return 'Flackbot';
  return ctx.users.get(uid)?.displayName ?? 'Someone';
}

export function channelLabel(ctx: ToolContext, c: ChannelDoc & { id: string }): string {
  if (c.type !== 'dm') return `#${c.name}`;
  const others = c.memberIds.filter((m) => m !== ctx.uid);
  return others.length ? `DM with ${others.map((m) => nameOf(ctx, m)).join(', ')}` : 'Notes to self';
}

/** "general", "#general" or a channel id → one of the asker's channels. */
function resolveChannel(ctx: ToolContext, input: unknown): (ChannelDoc & { id: string }) | null {
  if (typeof input !== 'string' || !input.trim()) return null;
  const key = input.trim().replace(/^#/, '');
  if (key === botDmId(ctx.uid)) return null;
  return ctx.channels.get(key) ?? [...ctx.channels.values()].find((c) => c.type !== 'dm' && c.name.toLowerCase() === key.toLowerCase()) ?? null;
}

/** `<@uid>` mention tokens → @Name, and a length cap. */
function plain(ctx: ToolContext, text: string): string {
  const t = text.replace(/<@([A-Za-z0-9_-]+)>/g, (_, id) => `@${nameOf(ctx, id)}`).replace(/<!(channel|here)>/g, '@$1');
  return t.length > MAX_TEXT ? `${t.slice(0, MAX_TEXT)}…` : t;
}

function dateArg(v: unknown): number | undefined {
  if (typeof v !== 'string' || !v.trim()) return undefined;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? ms : undefined;
}

function describe(ctx: ToolContext, channelId: string, id: string, m: Pick<MessageDoc, 'authorId' | 'text' | 'threadParentId' | 'replyCount' | 'attachments'> & { createdAt: number }) {
  const channel = ctx.channels.get(channelId);
  const where = channel ? channelLabel(ctx, channel) : 'a channel';
  const ref = ctx.refs.add({ channelId, messageId: id, threadParentId: m.threadParentId ?? null, label: `${where} · ${nameOf(ctx, m.authorId)}` });
  return {
    ref,
    where,
    author: nameOf(ctx, m.authorId),
    at: new Date(m.createdAt).toISOString().slice(0, 16).replace('T', ' ') + ' UTC',
    text: plain(ctx, m.text ?? ''),
    ...(m.threadParentId ? { in_thread: true } : {}),
    ...(m.replyCount ? { replies: m.replyCount } : {}),
    ...(m.attachments?.length ? { files: m.attachments.map((a) => a.name).slice(0, 5) } : {}),
  };
}

const ms = (t: unknown) => (t instanceof Timestamp ? t.toMillis() : 0);

/** The live status line while a tool runs ("Searching for “pricing”"). */
export function toolStatus(name: string, input: Record<string, unknown>): string {
  switch (name) {
    case 'search_messages':
      return `Searching for “${String(input.query ?? '').slice(0, 40)}”`;
    case 'read_channel':
      return `Reading ${String(input.channel ?? 'a channel').replace(/^(?!#)/, '#').slice(0, 40)}`;
    case 'read_thread':
      return 'Reading a thread';
    case 'list_channels':
      return 'Looking at your channels';
    case 'find_people':
      return 'Looking people up';
    default:
      return 'Working';
  }
}

/** Runs one tool call. Errors come back as text for the model (never thrown). */
export async function runTool(ctx: ToolContext, name: string, input: Record<string, unknown>): Promise<{ text: string; error?: boolean }> {
  try {
    switch (name) {
      case 'search_messages': {
        const query = typeof input.query === 'string' ? input.query.slice(0, 200) : '';
        const channel = input.channel ? resolveChannel(ctx, input.channel) : null;
        if (input.channel && !channel) return { text: `No channel called "${input.channel}" that this person belongs to. Use list_channels.`, error: true };
        let authorId: string | undefined;
        if (typeof input.from_person === 'string' && input.from_person.trim()) {
          const q = input.from_person.trim().toLowerCase();
          authorId = [...ctx.users].find(([, u]) => u.displayName.toLowerCase().includes(q))?.[0];
          if (!authorId) return { text: `Nobody named "${input.from_person}". Use find_people.`, error: true };
        }
        // Its own DM (earlier questions and answers) would only echo the question back.
        const { results } = await searchAs(ctx.uid, { q: query, channelId: channel?.id, authorId, after: dateArg(input.after), before: dateArg(input.before), excludeChannelIds: [botDmId(ctx.uid)] });
        const out = results.slice(0, 15).map((r) => describe(ctx, r.channelId, r.messageId, { authorId: r.authorId, text: r.snippet, threadParentId: r.threadParentId, replyCount: 0, attachments: [], createdAt: r.createdAt }));
        return { text: JSON.stringify(out.length ? { results: out } : { results: [], note: 'Nothing matched all of those words.' }) };
      }
      case 'read_channel': {
        const channel = resolveChannel(ctx, input.channel);
        if (!channel) return { text: `No channel called "${input.channel}" that this person belongs to. Use list_channels.`, error: true };
        const limit = Math.min(40, Math.max(1, Number(input.limit) || 25));
        let q = db.collection(`channels/${channel.id}/messages`).where('threadParentId', '==', null).orderBy('createdAt', 'desc');
        const before = dateArg(input.before);
        if (before) q = q.where('createdAt', '<', Timestamp.fromMillis(before));
        const snap = await q.limit(limit).get();
        const out = snap.docs
          .map((d) => ({ id: d.id, m: d.data() as MessageDoc }))
          .filter(({ m }) => !m.deleted)
          .reverse()
          .map(({ id, m }) => describe(ctx, channel.id, id, { ...m, createdAt: ms(m.createdAt) }));
        return { text: JSON.stringify({ channel: channelLabel(ctx, channel), topic: (channel as { topic?: string }).topic ?? '', messages: out }) };
      }
      case 'read_thread': {
        const src = ctx.refs.get(Number(input.ref));
        if (!src) return { text: 'Unknown ref. Use a ref number from an earlier result.', error: true };
        const rootId = src.threadParentId ?? src.messageId;
        const [root, replies] = await Promise.all([
          db.doc(`channels/${src.channelId}/messages/${rootId}`).get(),
          db.collection(`channels/${src.channelId}/messages`).where('threadParentId', '==', rootId).orderBy('createdAt').limit(50).get(),
        ]);
        const msgs = [...(root.exists ? [root] : []), ...replies.docs]
          .map((d) => ({ id: d.id, m: d.data() as MessageDoc }))
          .filter(({ m }) => !m.deleted)
          .map(({ id, m }) => describe(ctx, src.channelId, id, { ...m, createdAt: ms(m.createdAt) }));
        return { text: JSON.stringify({ messages: msgs }) };
      }
      case 'list_channels': {
        const out = [...ctx.channels.values()]
          .filter((c) => !c.archived && !c.memberIds.includes(BOT_ID))
          .map((c) => ({ id: c.id, name: channelLabel(ctx, c), type: c.type, members: c.memberIds.length, topic: (c as { topic?: string }).topic || undefined }));
        return { text: JSON.stringify({ channels: out }) };
      }
      case 'find_people': {
        const q = typeof input.name === 'string' ? input.name.trim().toLowerCase() : '';
        const out = [...ctx.users.values()]
          .filter((u) => u.status === 'active' && (!q || u.displayName.toLowerCase().includes(q)))
          .slice(0, 30)
          .map((u) => ({ name: u.displayName, title: u.title || undefined, time_zone: (u as { timeZone?: string }).timeZone }));
        return { text: JSON.stringify({ people: out }) };
      }
      default:
        return { text: `Unknown tool ${name}.`, error: true };
    }
  } catch (err) {
    // HttpsError messages from searchAs are written for people ("Type at least one word…").
    return { text: `The tool failed: ${(err as Error).message}`, error: true };
  }
}
