import { logger } from 'firebase-functions/v2';
import { FieldPath, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { db, isEmulator, messaging } from './admin.js';
import { APP_URL } from './params.js';

/** Sends one web push to every device of `uid` (data-only; the service worker shows it). */
export async function sendPush(
  uid: string,
  p: { kind: string; title: string; body: string; path: string; channelId?: string; tag: string },
): Promise<void> {
  const tokensSnap = await db.doc(`users/${uid}/private/tokens`).get();
  const tokens = Object.keys((tokensSnap.get('tokens') as Record<string, unknown> | undefined) ?? {});
  if (!tokens.length) return;
  const link = `${APP_URL.value().replace(/\/$/, '')}${p.path}`;

  if (isEmulator) {
    // FCM isn't emulated: record what would have been sent so tests can assert on it.
    await db.collection('_debug').doc('pushes').collection('items').add({ uid, kind: p.kind, title: p.title, body: p.body, link, tokens, at: Timestamp.now() });
    return;
  }

  const res = await messaging().sendEachForMulticast({
    tokens,
    // Data-only so the service worker controls display and click routing on every platform.
    data: { title: p.title, body: p.body, link, path: p.path, channelId: p.channelId ?? '', tag: p.tag },
    webpush: { headers: { Urgency: 'high', TTL: '86400' } },
  });
  const stale = res.responses
    .map((r, i) => (!r.success && /registration-token-not-registered|invalid-registration-token|invalid-argument/.test(r.error?.code ?? '') ? tokens[i] : null))
    .filter((t): t is string => !!t);
  if (stale.length) {
    // Tokens contain ':' etc., so use FieldPath rather than a dotted string.
    for (const t of stale) await tokensSnap.ref.update(new FieldPath('tokens', t), FieldValue.delete());
    logger.info('Pruned stale FCM tokens', { uid, count: stale.length });
  }
}
