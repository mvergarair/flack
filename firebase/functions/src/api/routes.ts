// Pure pieces of the HTTP API: routing, input validation and response shapes. No I/O here,
// so it's all unit-tested; api/http.ts does the Firestore work.
import type { Timestamp } from 'firebase-admin/firestore';
import type { Scope } from './tokens.js';

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

export type RouteName =
  | 'me'
  | 'listUsers'
  | 'getUser'
  | 'listChannels'
  | 'getChannel'
  | 'listMessages'
  | 'getMessage'
  | 'listReplies'
  | 'postMessage'
  | 'openDm'
  | 'search';

interface Route {
  method: 'GET' | 'POST';
  pattern: RegExp;
  name: RouteName;
  scope: Scope;
}

const ID = '([A-Za-z0-9_-]{1,128})';
const ROUTES: Route[] = [
  { method: 'GET', pattern: /^\/v1\/me$/, name: 'me', scope: 'read' },
  { method: 'GET', pattern: /^\/v1\/users$/, name: 'listUsers', scope: 'read' },
  { method: 'GET', pattern: new RegExp(`^/v1/users/${ID}$`), name: 'getUser', scope: 'read' },
  { method: 'GET', pattern: /^\/v1\/channels$/, name: 'listChannels', scope: 'read' },
  { method: 'GET', pattern: new RegExp(`^/v1/channels/${ID}$`), name: 'getChannel', scope: 'read' },
  { method: 'GET', pattern: new RegExp(`^/v1/channels/${ID}/messages$`), name: 'listMessages', scope: 'read' },
  { method: 'POST', pattern: new RegExp(`^/v1/channels/${ID}/messages$`), name: 'postMessage', scope: 'write' },
  { method: 'GET', pattern: new RegExp(`^/v1/channels/${ID}/messages/${ID}$`), name: 'getMessage', scope: 'read' },
  { method: 'GET', pattern: new RegExp(`^/v1/channels/${ID}/messages/${ID}/replies$`), name: 'listReplies', scope: 'read' },
  { method: 'POST', pattern: /^\/v1\/dms$/, name: 'openDm', scope: 'write' },
  { method: 'GET', pattern: /^\/v1\/search$/, name: 'search', scope: 'read' },
];

/** Hosting serves the API under /api (see firebase.json); the function alone serves it at /. */
export function normalizePath(path: string): string {
  const p = path.replace(/^\/api(?=\/|$)/, '').replace(/\/+$/, '');
  return p || '/';
}

export function matchRoute(method: string, path: string): { name: RouteName; scope: Scope; params: string[] } {
  const p = normalizePath(path);
  const byPath = ROUTES.filter((r) => r.pattern.test(p));
  if (!byPath.length) throw new ApiError(404, 'not_found', `No such endpoint: ${p}. See docs/API.md.`);
  const route = byPath.find((r) => r.method === method);
  if (!route) throw new ApiError(405, 'method_not_allowed', `Use ${byPath.map((r) => r.method).join(' or ')} for ${p}.`);
  return { name: route.name, scope: route.scope, params: p.match(route.pattern)!.slice(1) };
}

/** `?limit=` (1–100, default 50) and `?before=` (epoch ms cursor). */
export function pageParams(query: Record<string, unknown>): { limit: number; before: number | null } {
  const raw = query.limit === undefined ? 50 : Number(query.limit);
  if (!Number.isInteger(raw) || raw < 1 || raw > 100) throw new ApiError(400, 'invalid_argument', '`limit` must be a whole number from 1 to 100.');
  const before = query.before === undefined ? null : Number(query.before);
  if (before !== null && (!Number.isFinite(before) || before <= 0)) throw new ApiError(400, 'invalid_argument', '`before` must be a timestamp in milliseconds.');
  return { limit: raw, before };
}

export interface PostBody {
  text: string;
  threadId: string | null;
  alsoToChannel: boolean;
}

export function parsePostBody(body: unknown): PostBody {
  if (!body || typeof body !== 'object') throw new ApiError(400, 'invalid_argument', 'Send a JSON body like {"text": "Hello"}.');
  const b = body as Record<string, unknown>;
  if (typeof b.text !== 'string' || !b.text.trim()) throw new ApiError(400, 'invalid_argument', '`text` is required.');
  if (b.text.length > 40_000) throw new ApiError(400, 'invalid_argument', '`text` can be up to 40,000 characters.');
  if (b.threadId !== undefined && b.threadId !== null && (typeof b.threadId !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/.test(b.threadId))) {
    throw new ApiError(400, 'invalid_argument', '`threadId` must be a message id.');
  }
  if (b.alsoToChannel !== undefined && typeof b.alsoToChannel !== 'boolean') throw new ApiError(400, 'invalid_argument', '`alsoToChannel` must be true or false.');
  const threadId = (b.threadId as string | undefined) ?? null;
  if (b.alsoToChannel && !threadId) throw new ApiError(400, 'invalid_argument', '`alsoToChannel` only applies to thread replies (with `threadId`).');
  return { text: b.text, threadId, alsoToChannel: !!b.alsoToChannel };
}

export function parseDmBody(body: unknown, me: string): string[] {
  const ids = (body as { userIds?: unknown } | null)?.userIds;
  if (!Array.isArray(ids) || !ids.length || !ids.every((i) => typeof i === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(i))) {
    throw new ApiError(400, 'invalid_argument', 'Send {"userIds": ["<user id>", …]} with the other people in the conversation.');
  }
  const others = [...new Set(ids as string[])].filter((i) => i !== me);
  if (others.length > 8) throw new ApiError(400, 'invalid_argument', 'Group DMs can have up to 9 people including you.');
  return others;
}

// ---- response shapes ------------------------------------------------------------------------

const ms = (t: Timestamp | null | undefined) => (t && typeof t.toMillis === 'function' ? t.toMillis() : null);
type Data = Record<string, unknown>;

export function userJson(id: string, d: Data) {
  const status = d.customStatus as { emoji?: string; text?: string; expiresAt?: Timestamp | null } | null | undefined;
  const statusLive = status && (!status.expiresAt || ms(status.expiresAt)! > Date.now());
  return {
    id,
    name: d.displayName,
    title: d.title ?? '',
    email: d.email,
    role: d.role,
    status: d.status,
    photoUrl: d.photoURL ?? null,
    timeZone: d.timeZone ?? null,
    customStatus: statusLive ? { emoji: status.emoji ?? '', text: status.text ?? '', expiresAt: ms(status.expiresAt) } : null,
  };
}

export function channelJson(id: string, d: Data) {
  return {
    id,
    type: d.type,
    name: d.name,
    topic: d.topic ?? '',
    memberIds: d.memberIds ?? [],
    archived: !!d.archived,
    createdAt: ms(d.createdAt as Timestamp),
    lastMessageAt: ms(d.lastMessageAt as Timestamp),
  };
}

export function messageJson(channelId: string, id: string, d: Data) {
  const attachments = (d.attachments as Array<Record<string, unknown>> | undefined) ?? [];
  return {
    id,
    channelId,
    authorId: d.authorId,
    text: d.deleted ? '' : d.text,
    createdAt: ms(d.createdAt as Timestamp),
    editedAt: ms(d.editedAt as Timestamp),
    threadId: d.threadParentId ?? null,
    alsoToChannel: !!d.alsoToChannel,
    replyCount: d.replyCount ?? 0,
    lastReplyAt: ms(d.lastReplyAt as Timestamp),
    mentions: d.mentions ?? [],
    reactions: d.reactions ?? {},
    attachments: attachments.map((a) => ({ name: a.name, size: a.size, contentType: a.contentType })),
    deleted: !!d.deleted,
  };
}
