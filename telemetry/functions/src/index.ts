// The maintainers' collector for anonymous Flack statistics (TELEMETRY.md):
//   POST /v1/report  one report per install per day (validated strictly, then stored)
//   GET  /v1/stats   public aggregate numbers (installs, versions, sizes, feature use)
// No IP addresses or request metadata are stored; request logs are excluded (telemetry/deploy.sh).
// Everything expires 13 months after it was last written (Firestore TTL, firestore.indexes.json).
import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { aggregate } from './aggregate.js';
import { validateReport, type Report } from './validate.js';

initializeApp();
const db = getFirestore();
const DAY = 86_400_000;
const KEEP_MS = 396 * DAY; // 13 months

export const report = onRequest({ invoker: 'public', maxInstances: 10, cors: false }, async (req, res) => {
  if (req.method !== 'POST') return void res.status(405).end();
  if (Number(req.get('content-length') ?? 0) > 8_000) return void res.status(413).end();
  const r = validateReport(req.body);
  if (!r) return void res.status(400).json({ error: 'Not a valid Flack report (see TELEMETRY.md).' });
  const install = db.doc(`installs/${r.installId}`);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(install);
    // Everything expires 13 months after it was last written (Firestore TTL on expireAt).
    const expireAt = Timestamp.fromMillis(Date.now() + KEEP_MS);
    tx.set(install, { firstSeen: snap.get('firstSeen') ?? r.date, lastSeen: r.date, version: r.version, region: r.region, expireAt });
    tx.set(install.collection('days').doc(r.date), { ...r, date: r.date, expireAt });
  });
  res.status(204).end();
});

export const stats = onRequest({ invoker: 'public', maxInstances: 5 }, async (req, res) => {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Cache-Control', 'public, max-age=3600');
  if (req.method === 'OPTIONS') return void res.status(204).end();
  const snap = await db.doc('public/stats').get();
  res.status(200).json(snap.data() ?? { installs30d: 0, history: [] });
});

/** Daily: recompute the public numbers (old data expires via TTL). */
export const aggregatestats = onSchedule({ schedule: 'every day 06:00', timeZone: 'UTC', timeoutSeconds: 300 }, async () => {
  const now = new Date();
  const since = new Date(now.getTime() - 30 * DAY).toISOString().slice(0, 10);
  const installs = await db.collection('installs').where('lastSeen', '>=', since).get();
  const latest: Report[] = [];
  for (const i of installs.docs) {
    const day = await i.ref.collection('days').orderBy('date', 'desc').limit(1).get();
    if (!day.empty) latest.push(day.docs[0].data() as Report);
  }
  const today = now.toISOString().slice(0, 10);
  await db.doc(`history/${today}`).set({ date: today, installs30d: latest.length, expireAt: Timestamp.fromMillis(now.getTime() + KEEP_MS) });
  const history = (await db.collection('history').orderBy('date', 'desc').limit(400).get()).docs
    .map((d) => ({ date: d.get('date') as string, installs30d: d.get('installs30d') as number }))
    .reverse();
  await db.doc('public/stats').set(aggregate(latest, history, now));

  logger.info('Aggregated', { installs30d: latest.length });
});
