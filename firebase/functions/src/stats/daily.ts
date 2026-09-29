import { onSchedule } from 'firebase-functions/v2/scheduler';
import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue, Timestamp } from 'firebase-admin/firestore';
import { KEEP_DAYS, expireAt } from '../lib/ttl.js';
import { randomUUID } from 'node:crypto';
import { db, isEmulator, rtdb } from '../lib/admin.js';
import { flackRegion, telemetryOff, telemetryUrl } from '../lib/params.js';
import type { UserDoc } from '../lib/types.js';
import { FLACK_VERSION } from '../version.js';
import { loadKey, type LoadKey } from './buckets.js';
import { gcpMetrics } from './monitoring.js';
import { buildReport, type GcpMetrics, type Snapshot } from './report.js';

const day = (d: Date) => d.toISOString().slice(0, 10);

/**
 * Once a day: record a health snapshot for this install's admins (stats/{date}), and, unless
 * turned off, send the maintainers an anonymous report built from it (TELEMETRY.md).
 */
export const dailystats = onSchedule({ schedule: 'every day 04:30', timeZone: 'UTC', retryCount: 0, timeoutSeconds: 120 }, async () => {
  await runDailyStats(new Date());
});

export async function runDailyStats(now: Date): Promise<Snapshot> {
  const snapshot = await collect(now);
  // Kept 90 days (Firestore TTL on expireAt).
  await db.doc(`stats/${snapshot.date}`).set({ ...snapshot, createdAt: Timestamp.fromDate(now), expireAt: expireAt(KEEP_DAYS, now.getTime()) });
  await pruneLegacyActivity(now).catch((err) => logger.warn('Activity cleanup failed', { err: String(err) }));
  await sendReport(snapshot).catch((err) => logger.warn('Telemetry report not sent', { err: String(err) }));
  return snapshot;
}

async function collect(now: Date): Promise<Snapshot> {
  const since = Timestamp.fromMillis(now.getTime() - 86_400_000);
  const count = async (q: FirebaseFirestore.Query) => (await q.count().get()).data().count;
  const [total, channels, messages24h, apiTokens, scheduled, pushUsers, branding, presence, vitals, gcp] = await Promise.all([
    count(db.collection('users').where('status', '==', 'active')),
    count(db.collection('channels').where('type', 'in', ['public', 'private'])),
    count(db.collectionGroup('messages').where('createdAt', '>=', since)),
    count(db.collection('apiTokens')),
    count(db.collectionGroup('scheduled')),
    count(db.collectionGroup('private')),
    db.doc('config/branding').get(),
    rtdb().ref('status').get(),
    db.doc(`stats/vitals-${day(now)}`).get(),
    isEmulator ? Promise.resolve<GcpMetrics>({ reads: null, writes: null, deletes: null, requests: null, errors: null, p95Ms: null, errorsByFunction: null }) : gcpMetrics(now),
  ]);

  // Active this week = any device changed presence in the last 7 days.
  const weekAgo = now.getTime() - 7 * 86_400_000;
  let active7d = 0;
  for (const devices of Object.values((presence.val() ?? {}) as Record<string, Record<string, { lastChanged?: number }> | undefined>)) {
    if (Object.values(devices ?? {}).some((d) => typeof d?.lastChanged === 'number' && d.lastChanged >= weekAgo)) active7d++;
  }

  const b = branding.data() ?? {};
  const pageLoad = Object.fromEntries(
    Object.entries(vitals.data() ?? {}).filter(([k, v]) => ['lt1s', 'lt2_5s', 'lt4s', 'gte4s'].includes(k) && typeof v === 'number'),
  ) as Partial<Record<LoadKey, number>>;

  return {
    date: day(now),
    version: FLACK_VERSION,
    members: { total, active7d: Math.min(active7d, total) },
    channels,
    messages24h,
    apiTokens,
    scheduled,
    pushUsers,
    customized: !!(b.name || b.logo || b.accent || b.sidebar || b.tagline),
    pageLoad,
    gcp,
  };
}

/**
 * Activity items from before expiry dates existed have no `expireAt`, so TTL never removes them:
 * delete those older than 90 days here, a batch a day.
 */
async function pruneLegacyActivity(now: Date) {
  const cutoff = Timestamp.fromMillis(now.getTime() - KEEP_DAYS * 86_400_000);
  const old = await db.collectionGroup('activity').where('createdAt', '<', cutoff).limit(500).get();
  if (old.empty) return;
  const batch = db.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
}

/** The anonymous report, unless FLACK_TELEMETRY=off or an admin switched it off. */
async function sendReport(snapshot: Snapshot) {
  const ref = db.doc('config/telemetry');
  const cfg = (await ref.get()).data() ?? {};
  const installId = (cfg.installId as string | undefined) ?? randomUUID();
  if (!cfg.installId) await ref.set({ installId, enabled: true }, { merge: true });

  const envOff = telemetryOff();
  if (envOff || cfg.enabled === false) {
    await ref.set({ lastReport: null, lastSentAt: null, disabledBy: envOff ? 'env' : 'admin' }, { merge: true });
    return;
  }
  const report = buildReport(snapshot, installId, flackRegion());
  const res = await fetch(telemetryUrl(), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(report),
    signal: AbortSignal.timeout(10_000),
  });
  // Admins can always see exactly what was (or would have been) sent.
  await ref.set(
    { lastReport: report, lastSentAt: Timestamp.now(), lastStatus: res.status, disabledBy: FieldValue.delete() },
    { merge: true },
  );
}

/**
 * Page-load timing from browsers (a sample of loads), counted per day in coarse buckets for
 * the admins' health card. Only the bucket is stored.
 */
export const recordvitals = onCall(async (req) => {
  const uid = req.auth?.uid;
  if (!uid || req.auth?.token.active !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  const me = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (me?.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  const lcp = (req.data as { lcp?: unknown } | null)?.lcp;
  if (typeof lcp !== 'number' || !Number.isFinite(lcp) || lcp < 0 || lcp > 120_000) throw new HttpsError('invalid-argument', 'Bad timing.');
  await db.doc(`stats/vitals-${day(new Date())}`).set({ [loadKey(lcp)]: FieldValue.increment(1), expireAt: expireAt() }, { merge: true });
  return { ok: true };
});
