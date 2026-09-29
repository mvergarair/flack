import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { Timestamp } from 'firebase-admin/firestore';
import { randomBytes } from 'node:crypto';
import { auth, db, rtdb } from '../lib/admin.js';
import { INVITE_TTL_MS } from '../lib/params.js';
import type { InviteDoc, Role, UserDoc } from '../lib/types.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isRole = (r: unknown): r is Role => r === 'admin' || r === 'member';

/** Verifies the caller is an active admin: both the token claim and the user doc must agree. */
async function assertAdmin(req: CallableRequest): Promise<{ uid: string; user: UserDoc }> {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in first.');
  if (req.auth?.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
  const snap = await db.doc(`users/${uid}`).get();
  const user = snap.data() as UserDoc | undefined;
  if (!user || user.status !== 'active' || user.role !== 'admin') {
    throw new HttpsError('permission-denied', 'Admins only.');
  }
  return { uid, user };
}

function str(data: unknown, key: string): string {
  const v = (data as Record<string, unknown> | null)?.[key];
  if (typeof v !== 'string' || !v.trim()) throw new HttpsError('invalid-argument', `Missing ${key}.`);
  return v.trim();
}

async function activeAdminCount(tx: FirebaseFirestore.Transaction): Promise<number> {
  const snap = await tx.get(db.collection('users').where('role', '==', 'admin').where('status', '==', 'active'));
  return snap.size;
}

async function mergeClaims(uid: string, patch: Record<string, unknown>) {
  const current = (await auth.getUser(uid)).customClaims ?? {};
  await auth.setCustomUserClaims(uid, { ...current, ...patch });
}

// ---------------------------------------------------------------------------------------------
// Invites
// ---------------------------------------------------------------------------------------------

/** Creates (or refreshes) a pending invite and returns its link token. Admin only. */
export const createinvite = onCall(async (req) => {
  const { uid, user } = await assertAdmin(req);
  const email = str(req.data, 'email');
  const emailLower = email.toLowerCase();
  const role = (req.data as { role?: unknown })?.role ?? 'member';
  if (!EMAIL_RE.test(email) || email.length > 254) throw new HttpsError('invalid-argument', 'Enter a valid email address.');
  if (!isRole(role)) throw new HttpsError('invalid-argument', 'Role must be admin or member.');

  const existingUser = await db.collection('users').where('emailLower', '==', emailLower).limit(1).get();
  if (!existingUser.empty) {
    const status = existingUser.docs[0].get('status');
    throw new HttpsError(
      'already-exists',
      status === 'deactivated'
        ? `${email} was deactivated. Reactivate them from the people list instead.`
        : `${email} is already a member.`,
    );
  }

  const now = Timestamp.now();
  const expiresAt = Timestamp.fromMillis(now.toMillis() + INVITE_TTL_MS);
  const pending = await db.collection('invites').where('emailLower', '==', emailLower).where('status', '==', 'pending').get();
  if (!pending.empty) {
    // Refresh the existing invite instead of creating duplicates.
    const ref = pending.docs[0].ref;
    const token = (pending.docs[0].data() as InviteDoc).token;
    await ref.update({ role, expiresAt, invitedBy: uid, invitedByName: user.displayName });
    for (const extra of pending.docs.slice(1)) await extra.ref.update({ status: 'revoked' });
    return { id: ref.id, token, refreshed: true };
  }

  const token = randomBytes(18).toString('base64url');
  const invite: InviteDoc = {
    email,
    emailLower,
    role,
    invitedBy: uid,
    invitedByName: user.displayName,
    token,
    createdAt: now,
    expiresAt,
    status: 'pending',
  };
  const ref = await db.collection('invites').add(invite);
  logger.info('Invite created', { by: uid, email: emailLower, role });
  return { id: ref.id, token, refreshed: false };
});

export const revokeinvite = onCall(async (req) => {
  await assertAdmin(req);
  const id = str(req.data, 'inviteId');
  const ref = db.doc(`invites/${id}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'Invite not found.');
    if (snap.get('status') !== 'pending') throw new HttpsError('failed-precondition', 'Only pending invites can be revoked.');
    tx.update(ref, { status: 'revoked', revokedAt: Timestamp.now() });
  });
  return { ok: true };
});

/**
 * Public: resolves an invite link token to what the landing page needs to show. The token is a
 * 144-bit random value, so this can't be used to enumerate invites.
 */
export const lookupinvite = onCall(async (req) => {
  const token = str(req.data, 'token');
  if (token.length > 64) throw new HttpsError('invalid-argument', 'Bad token.');
  const snap = await db.collection('invites').where('token', '==', token).limit(1).get();
  if (snap.empty) return { status: 'invalid' as const };
  const inv = snap.docs[0].data() as InviteDoc;
  const expired = inv.status === 'pending' && inv.expiresAt.toMillis() <= Date.now();
  return {
    status: expired ? ('expired' as const) : inv.status,
    email: inv.email,
    role: inv.role,
    invitedByName: inv.invitedByName,
    expiresAt: inv.expiresAt.toMillis(),
  };
});

// ---------------------------------------------------------------------------------------------
// People
// ---------------------------------------------------------------------------------------------

/** Changes a user's role. The last active admin can never be demoted. */
export const setrole = onCall(async (req) => {
  await assertAdmin(req);
  const target = str(req.data, 'uid');
  const role = (req.data as { role?: unknown })?.role;
  if (!isRole(role)) throw new HttpsError('invalid-argument', 'Role must be admin or member.');

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${target}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
    const user = snap.data() as UserDoc;
    if (user.role === role) return;
    if (user.role === 'admin' && user.status === 'active' && (await activeAdminCount(tx)) <= 1) {
      throw new HttpsError('failed-precondition', 'There must always be at least one admin.');
    }
    tx.update(ref, { role });
  });
  await mergeClaims(target, { role });
  logger.info('Role changed', { by: req.auth?.uid, target, role });
  return { ok: true };
});

/** Deactivates a user: signs them out everywhere and locks them out of all data. */
export const deactivateuser = onCall(async (req) => {
  const { uid } = await assertAdmin(req);
  const target = str(req.data, 'uid');
  if (target === uid) throw new HttpsError('failed-precondition', "You can't deactivate yourself.");

  await db.runTransaction(async (tx) => {
    const ref = db.doc(`users/${target}`);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
    const user = snap.data() as UserDoc;
    if (user.status === 'deactivated') return;
    if (user.role === 'admin' && (await activeAdminCount(tx)) <= 1) {
      throw new HttpsError('failed-precondition', 'There must always be at least one admin.');
    }
    tx.update(ref, { status: 'deactivated', deactivatedAt: Timestamp.now() });
  });

  // Order matters: the doc flip above already locks rules; these end every session.
  await mergeClaims(target, { active: false });
  await auth.updateUser(target, { disabled: true });
  await auth.revokeRefreshTokens(target);
  await rtdb().ref(`status/${target}`).set({ gone: { state: 'offline', lastChanged: Date.now() } });
  await rtdb().ref(`viewing/${target}`).remove();
  logger.info('User deactivated', { by: uid, target });
  return { ok: true };
});

export const reactivateuser = onCall(async (req) => {
  const { uid } = await assertAdmin(req);
  const target = str(req.data, 'uid');
  const ref = db.doc(`users/${target}`);
  const snap = await ref.get();
  if (!snap.exists) throw new HttpsError('not-found', 'User not found.');
  await ref.update({ status: 'active', deactivatedAt: null });
  await mergeClaims(target, { active: true });
  await auth.updateUser(target, { disabled: false });
  logger.info('User reactivated', { by: uid, target });
  return { ok: true };
});
