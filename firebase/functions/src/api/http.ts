import { onRequest, HttpsError, type Request } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Filter, Timestamp } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { db } from '../lib/admin.js';
import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';
import { extractMentions, mentionNames, writeMessage } from '../lib/post.js';
import { cannotSend } from '../scheduled/checks.js';
import { searchAs, type SearchInput } from '../search/callable.js';
import { hashToken, isTokenFormat, newTypingKey, type Scope } from './tokens.js';
import {
  ApiError,
  channelJson,
  matchRoute,
  messageJson,
  pageParams,
  parseDmBody,
  parsePostBody,
  userJson,
  type RouteName,
} from './routes.js';

const RATE_PER_MINUTE = 120;
const LAST_USED_EVERY_MS = 10 * 60_000;

interface Caller {
  uid: string;
  user: UserDoc;
  scopes: Scope[];
  tokenId: string;
}

/**
 * The Flack HTTP API (docs/API.md), served at https://<project>.web.app/api/v1/… through a
 * Hosting rewrite. Personal API tokens act as their owner: same channels, same rules.
 */
export const api = onRequest({ invoker: 'public', maxInstances: 5, timeoutSeconds: 60 }, async (req, res) => {
  res.set('Cache-Control', 'no-store');
  try {
    const route = matchRoute(req.method, req.path);
    const caller = await authenticate(req);
    if (!caller.scopes.includes(route.scope)) {
      throw new ApiError(403, 'insufficient_scope', `This token needs the "${route.scope}" scope for this endpoint.`);
    }
    rateLimit(caller.tokenId, res);
    const { status, body } = await handle(route.name, route.params, req, caller);
    res.status(status).json(body);
  } catch (err) {
    const e = toApiError(err);
    if (e.status >= 500) logger.error('API error', { path: req.path, err: String(err) });
    res.status(e.status).json({ error: { code: e.code, message: e.message } });
  }
});

function toApiError(err: unknown): ApiError {
  if (err instanceof ApiError) return err;
  if (err instanceof HttpsError) {
    const map: Record<string, [number, string]> = {
      unauthenticated: [401, 'unauthenticated'],
      'permission-denied': [403, 'forbidden'],
      'invalid-argument': [400, 'invalid_argument'],
      'not-found': [404, 'not_found'],
      'failed-precondition': [409, 'failed_precondition'],
      'resource-exhausted': [429, 'rate_limited'],
    };
    const [status, code] = map[err.code] ?? [500, 'internal'];
    return new ApiError(status, code, err.message);
  }
  return new ApiError(500, 'internal', 'Something went wrong. Try again.');
}

async function authenticate(req: Request): Promise<Caller> {
  const header = req.get('authorization') ?? '';
  const token = header.match(/^Bearer\s+(\S+)$/i)?.[1] ?? '';
  if (!token) throw new ApiError(401, 'unauthenticated', 'Send your API token as "Authorization: Bearer flk_…".');
  if (!isTokenFormat(token)) throw new ApiError(401, 'unauthenticated', 'That is not a Flack API token.');
  const tokenId = hashToken(token);
  const snap = await db.doc(`apiTokens/${tokenId}`).get();
  if (!snap.exists) throw new ApiError(401, 'unauthenticated', 'This token was revoked or never existed.');
  const uid = snap.get('uid') as string;
  const user = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (user?.status !== 'active') throw new ApiError(403, 'forbidden', "The token's owner is not an active member.");
  const last = snap.get('lastUsedAt') as Timestamp | null;
  if (!last || Date.now() - last.toMillis() > LAST_USED_EVERY_MS) {
    snap.ref.update({ lastUsedAt: Timestamp.now() }).catch(() => undefined);
  }
  return { uid, user, scopes: (snap.get('scopes') as Scope[]) ?? [], tokenId };
}

// Per-instance token bucket (instances are capped at 5, so the effective limit is ≤ 5×).
const buckets = new Map<string, { tokens: number; at: number }>();
function rateLimit(tokenId: string, res: { set: (k: string, v: string) => unknown }) {
  const now = Date.now();
  const b = buckets.get(tokenId) ?? { tokens: RATE_PER_MINUTE, at: now };
  b.tokens = Math.min(RATE_PER_MINUTE, b.tokens + ((now - b.at) / 60_000) * RATE_PER_MINUTE);
  b.at = now;
  if (b.tokens < 1) {
    res.set('Retry-After', String(Math.ceil(((1 - b.tokens) / RATE_PER_MINUTE) * 60)));
    throw new ApiError(429, 'rate_limited', `Up to ${RATE_PER_MINUTE} requests a minute per token. Slow down and retry.`);
  }
  b.tokens -= 1;
  buckets.set(tokenId, b);
  if (buckets.size > 5000) buckets.clear();
}

type Result = { status: number; body: unknown };
const ok = (body: unknown, status = 200): Result => ({ status, body });

async function memberChannel(channelId: string, uid: string): Promise<ChannelDoc> {
  const snap = await db.doc(`channels/${channelId}`).get();
  const channel = snap.data() as ChannelDoc | undefined;
  if (!channel || !channel.memberIds.includes(uid)) throw new ApiError(404, 'not_found', 'Channel not found (or you are not a member).');
  return channel;
}

async function handle(name: RouteName, params: string[], req: Request, c: Caller): Promise<Result> {
  const query = req.query as Record<string, unknown>;
  switch (name) {
    case 'me':
      return ok({ user: userJson(c.uid, c.user as unknown as Record<string, unknown>), scopes: c.scopes });

    case 'listUsers': {
      const snap = await db.collection('users').where('status', '==', 'active').get();
      return ok({ users: snap.docs.map((d) => userJson(d.id, d.data())).sort((a, b) => String(a.name).localeCompare(String(b.name))) });
    }

    case 'getUser': {
      const snap = await db.doc(`users/${params[0]}`).get();
      if (!snap.exists) throw new ApiError(404, 'not_found', 'User not found.');
      return ok({ user: userJson(snap.id, snap.data()!) });
    }

    case 'listChannels': {
      const snap = await db.collection('channels').where('memberIds', 'array-contains', c.uid).get();
      const channels = snap.docs.map((d) => channelJson(d.id, d.data())).sort((a, b) => (b.lastMessageAt ?? 0) - (a.lastMessageAt ?? 0));
      return ok({ channels });
    }

    case 'getChannel': {
      const snap = await db.doc(`channels/${params[0]}`).get();
      const channel = snap.data() as ChannelDoc | undefined;
      // Like the app: public channels are visible to everyone; private channels and DMs to members.
      if (!channel || (channel.type !== 'public' && !channel.memberIds.includes(c.uid))) throw new ApiError(404, 'not_found', 'Channel not found.');
      return ok({ channel: channelJson(snap.id, snap.data()!) });
    }

    case 'listMessages': {
      const [channelId] = params;
      await memberChannel(channelId, c.uid);
      const { limit, before } = pageParams(query);
      const col = db.collection(`channels/${channelId}/messages`);
      // The channel feed: top-level messages plus thread replies also sent to the channel.
      let q = col.where(Filter.or(Filter.where('threadParentId', '==', null), Filter.where('alsoToChannel', '==', true))).orderBy('createdAt', 'desc');
      if (before) q = q.where('createdAt', '<', Timestamp.fromMillis(before));
      const snap = await q.limit(limit + 1).get();
      const docs = snap.docs.slice(0, limit);
      const messages = docs.map((d) => messageJson(channelId, d.id, d.data()));
      const nextBefore = snap.docs.length > limit ? messages[messages.length - 1].createdAt : null;
      return ok({ messages, nextBefore });
    }

    case 'getMessage': {
      const [channelId, messageId] = params;
      await memberChannel(channelId, c.uid);
      const snap = await db.doc(`channels/${channelId}/messages/${messageId}`).get();
      if (!snap.exists) throw new ApiError(404, 'not_found', 'Message not found.');
      return ok({ message: messageJson(channelId, snap.id, snap.data()!) });
    }

    case 'listReplies': {
      const [channelId, messageId] = params;
      await memberChannel(channelId, c.uid);
      const { limit } = pageParams(query);
      const after = query.after === undefined ? null : Number(query.after);
      if (after !== null && !(after > 0)) throw new ApiError(400, 'invalid_argument', '`after` must be a timestamp in milliseconds.');
      let q = db.collection(`channels/${channelId}/messages`).where('threadParentId', '==', messageId).orderBy('createdAt', 'asc');
      if (after) q = q.where('createdAt', '>', Timestamp.fromMillis(after));
      const snap = await q.limit(limit + 1).get();
      const replies = snap.docs.slice(0, limit).map((d) => messageJson(channelId, d.id, d.data()));
      const nextAfter = snap.docs.length > limit ? replies[replies.length - 1].createdAt : null;
      return ok({ replies, nextAfter });
    }

    case 'postMessage':
      return postMessage(params[0], req, c);

    case 'openDm': {
      const others = parseDmBody(req.body, c.uid);
      const snaps = others.length ? await db.getAll(...others.map((id) => db.doc(`users/${id}`))) : [];
      const missing = snaps.filter((s) => !s.exists || s.get('status') !== 'active').map((s) => s.id);
      if (missing.length) throw new ApiError(400, 'invalid_argument', `Not active members: ${missing.join(', ')}.`);
      const memberIds = [...new Set([c.uid, ...others])].sort();
      const id = `dm_${memberIds.join('_')}`;
      const ref = db.doc(`channels/${id}`);
      const created = await db.runTransaction(async (tx) => {
        if ((await tx.get(ref)).exists) return false;
        tx.create(ref, { name: '', type: 'dm', memberIds, createdBy: c.uid, archived: false, typingKey: newTypingKey(), createdAt: Timestamp.now() });
        return true;
      });
      const snap = await ref.get();
      return ok({ channel: channelJson(id, snap.data()!), created }, created ? 201 : 200);
    }

    case 'search': {
      const input: SearchInput = {
        q: typeof query.q === 'string' ? query.q : '',
        channelId: typeof query.channelId === 'string' ? query.channelId : undefined,
        authorId: typeof query.authorId === 'string' ? query.authorId : undefined,
        hasFile: query.hasFile === 'true' ? true : undefined,
        after: query.after ? Number(query.after) : undefined,
        before: query.before ? Number(query.before) : undefined,
      };
      const r = await searchAs(c.uid, input);
      return ok({
        results: r.results.map((m) => ({ ...m, threadId: m.threadParentId, threadParentId: undefined })),
        nextBefore: r.nextBefore,
      });
    }
  }
}

async function postMessage(channelId: string, req: Request, c: Caller): Promise<Result> {
  const body = parsePostBody(req.body);
  const mentions = extractMentions(body.text);
  const names = await mentionNames(mentions);
  // With an Idempotency-Key, retries of the same request post once (the id is derived from it).
  const key = req.get('idempotency-key');
  if (key !== undefined && (!key || key.length > 200)) throw new ApiError(400, 'invalid_argument', 'Idempotency-Key must be 1–200 characters.');
  const messageId = key
    ? `api_${createHash('sha256').update(`${c.uid}\n${channelId}\n${key}`).digest('base64url').slice(0, 24)}`
    : db.collection(`channels/${channelId}/messages`).doc().id;
  const messageRef = db.doc(`channels/${channelId}/messages/${messageId}`);

  const outcome = await db.runTransaction(async (tx) => {
    const existing = await tx.get(messageRef);
    if (existing.exists) return 'duplicate' as const;
    const parentRef = body.threadId ? db.doc(`channels/${channelId}/messages/${body.threadId}`) : null;
    const [userSnap, channelSnap, parentSnap] = await Promise.all([
      tx.get(db.doc(`users/${c.uid}`)),
      tx.get(db.doc(`channels/${channelId}`)),
      parentRef ? tx.get(parentRef) : Promise.resolve(null),
    ]);
    const channel = channelSnap.data() as ChannelDoc | undefined;
    const parent = parentSnap?.data() as MessageDoc | undefined;
    if (!channel || !channel.memberIds.includes(c.uid)) throw new ApiError(404, 'not_found', 'Channel not found (or you are not a member).');
    const reason = cannotSend({ uid: c.uid, user: userSnap.data() as UserDoc | undefined, channel, threadParentId: body.threadId, parent });
    if (reason) throw new ApiError(409, 'failed_precondition', reason);
    writeMessage(tx, {
      uid: c.uid,
      channelId,
      messageId,
      text: body.text,
      mentions,
      threadParentId: body.threadId,
      parent,
      alsoToChannel: body.alsoToChannel,
      names,
    });
    return 'created' as const;
  });

  const snap = await messageRef.get();
  return ok({ message: messageJson(channelId, snap.id, snap.data()!) }, outcome === 'created' ? 201 : 200);
}
