import { beforeUserCreated, beforeUserSignedIn, HttpsError } from 'firebase-functions/v2/identity';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, isEmulator } from '../lib/admin.js';
import { DEFAULT_CHANNELS, FIRST_ADMIN_EMAIL } from '../lib/params.js';
import type { InviteDoc, Role, UserDoc } from '../lib/types.js';

// Error messages are prefixed with a code the client maps to friendly copy.
const reject = (code: string, message: string) => new HttpsError('permission-denied', `${code}: ${message}`);

/**
 * Invite-only sign-up. Runs before Identity Platform creates an account; throwing here means
 * the account is never created. Accepts the account when either:
 *  - the workspace is not bootstrapped yet and the email is FIRST_ADMIN_EMAIL (becomes admin), or
 *  - there is a pending, unexpired invite for the email (role taken from the invite).
 * It then writes the user doc, marks the invite accepted and joins the default channels.
 */
export const beforecreated = beforeUserCreated(async (event) => {
  const user = event.data;
  const email = user?.email?.trim().toLowerCase();
  if (!user || !email) throw reject('NO_EMAIL', 'An email address is required.');

  const provider = event.additionalUserInfo?.providerId ?? event.credential?.providerId;
  if (!isEmulator) {
    // Production is Google-only; email/password exists only against the emulators.
    if (provider !== 'google.com') throw reject('PROVIDER', 'Sign in with Google.');
    if (!user.emailVerified) throw reject('UNVERIFIED', 'Your Google email address is not verified.');
  }

  const firstAdmin = FIRST_ADMIN_EMAIL.value().trim().toLowerCase();
  const now = Timestamp.now();

  const role = await db.runTransaction(async (tx) => {
    const cfgRef = db.doc('config/app');
    const cfg = await tx.get(cfgRef);
    const bootstrapped = cfg.exists && cfg.get('bootstrapped') === true;

    let role: Role | null = null;
    let inviteRef: FirebaseFirestore.DocumentReference | null = null;
    if (!bootstrapped && email === firstAdmin) {
      role = 'admin';
    } else {
      const invites = await tx.get(
        db.collection('invites').where('emailLower', '==', email).where('status', '==', 'pending'),
      );
      const valid = invites.docs.find((d) => (d.data() as InviteDoc).expiresAt.toMillis() > now.toMillis());
      if (!valid) {
        throw reject('NOT_INVITED', `${email} has not been invited to this workspace. Ask an admin for an invite.`);
      }
      role = (valid.data() as InviteDoc).role;
      inviteRef = valid.ref;
    }

    const defaultIds: string[] = bootstrapped ? (cfg.get('defaultChannelIds') ?? []) : [];
    // Default channels that were deleted or archived since an admin picked them are skipped
    // below, so a stale setting can never block sign-ups.
    const defaults = defaultIds.length ? await Promise.all(defaultIds.map((id) => tx.get(db.doc(`channels/${id}`)))) : [];
    // Reads done; writes below.
    if (!bootstrapped) {
      for (const ch of DEFAULT_CHANNELS) {
        tx.set(db.doc(`channels/${ch.id}`), {
          name: ch.name,
          type: 'public',
          memberIds: [user.uid],
          createdBy: user.uid,
          archived: false,
          topic: ch.topic,
          createdAt: now,
          lastMessageAt: now,
        });
      }
      tx.set(cfgRef, { bootstrapped: true, defaultChannelIds: DEFAULT_CHANNELS.map((c) => c.id), bootstrappedAt: now }, { merge: true });
    } else {
      for (const snap of defaults) {
        if (snap.exists && snap.get('type') === 'public' && !snap.get('archived')) {
          tx.update(snap.ref, { memberIds: FieldValue.arrayUnion(user.uid) });
        }
      }
    }

    if (inviteRef) {
      tx.update(inviteRef, { status: 'accepted', acceptedBy: user.uid, acceptedAt: now });
    }

    const profile: UserDoc = {
      displayName: user.displayName?.trim() || email.split('@')[0],
      email: user.email!,
      emailLower: email,
      photoURL: user.photoURL ?? null,
      title: '',
      role,
      status: 'active',
      createdAt: now,
    };
    tx.set(db.doc(`users/${user.uid}`), profile);
    return role;
  });

  logger.info('User accepted', { uid: user.uid, email, role, provider });
  return { customClaims: { role, active: true } };
});

/**
 * Every sign-in re-checks the user doc: deactivated users are refused, and the role/active
 * claims are refreshed from the doc so they never drift.
 */
export const beforesignedin = beforeUserSignedIn(async (event) => {
  const user = event.data;
  if (!user) throw reject('NO_USER', 'Unknown user.');
  const snap = await db.doc(`users/${user.uid}`).get();
  if (!snap.exists) throw reject('NOT_INVITED', 'This account is not part of the workspace.');
  const doc = snap.data() as UserDoc;
  if (doc.status !== 'active') throw reject('DEACTIVATED', 'Your account has been deactivated. Contact an admin.');
  return { customClaims: { role: doc.role, active: true } };
});
