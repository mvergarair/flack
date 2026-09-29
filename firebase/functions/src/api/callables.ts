import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { db } from '../lib/admin.js';
import type { UserDoc } from '../lib/types.js';
import { MAX_TOKENS_PER_USER, hashToken, newToken, parseScopes } from './tokens.js';

async function activeUser(req: CallableRequest): Promise<{ uid: string; user: UserDoc }> {
  const uid = req.auth?.uid;
  if (!uid || req.auth?.token.active !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (user?.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  return { uid, user };
}

/**
 * Creates a personal API token for the caller and returns it. This is the only time the
 * token exists in plain text: apiTokens/{sha256(token)} stores the hash, owner and scopes.
 */
export const createapitoken = onCall(async (req) => {
  const { uid } = await activeUser(req);
  const data = (req.data ?? {}) as { name?: unknown; scopes?: unknown };
  const name = typeof data.name === 'string' ? data.name.trim() : '';
  if (!name || name.length > 60) throw new HttpsError('invalid-argument', 'Give the token a name (up to 60 characters).');
  const scopes = parseScopes(data.scopes);
  if (!scopes) throw new HttpsError('invalid-argument', 'Scopes must be "read" and/or "write".');

  const existing = await db.collection('apiTokens').where('uid', '==', uid).count().get();
  if (existing.data().count >= MAX_TOKENS_PER_USER) {
    throw new HttpsError('resource-exhausted', `You can have up to ${MAX_TOKENS_PER_USER} tokens. Revoke one first.`);
  }

  const token = newToken();
  const id = hashToken(token);
  await db.doc(`apiTokens/${id}`).create({
    uid,
    name,
    scopes,
    prefix: token.slice(0, 10),
    createdAt: Timestamp.now(),
    lastUsedAt: null,
  });
  logger.info('API token created', { uid, scopes });
  return { id, token, scopes };
});

/** Revokes a token: its owner, or any admin (e.g. for someone who left). */
export const revokeapitoken = onCall(async (req) => {
  const { uid, user } = await activeUser(req);
  const id = (req.data as { id?: unknown } | null)?.id;
  if (typeof id !== 'string' || !/^[0-9a-f]{64}$/.test(id)) throw new HttpsError('invalid-argument', 'Missing token id.');
  const ref = db.doc(`apiTokens/${id}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'Token not found.');
  const isAdmin = req.auth?.token.role === 'admin' && user.role === 'admin';
  if (snap.get('uid') !== uid && !isAdmin) throw new HttpsError('permission-denied', 'You can only revoke your own tokens.');
  await ref.delete();
  logger.info('API token revoked', { by: uid, owner: snap.get('uid') });
  return { ok: true };
});
