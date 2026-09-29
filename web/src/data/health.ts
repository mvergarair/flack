import { useEffect, useState } from 'react';
import { collection, doc, limit, orderBy, query, setDoc, type Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { listenDoc, listenQuery } from '../lib/snapshot';

/** One day's health snapshot (written by the dailystats function; admins only). */
export interface DayStats {
  date: string;
  version: string;
  members: { total: number; active7d: number };
  channels: number;
  messages24h: number;
  apiTokens: number;
  scheduled: number;
  pushUsers: number;
  customized: boolean;
  pageLoad: Partial<Record<'lt1s' | 'lt2_5s' | 'lt4s' | 'gte4s', number>>;
  gcp: {
    reads: number | null;
    writes: number | null;
    deletes: number | null;
    requests: number | null;
    errors: number | null;
    p95Ms: number | null;
    errorsByFunction: { service: string; count: number }[] | null;
  };
}

/** The last 7 daily snapshots, newest first. */
export function useDailyStats(): DayStats[] | null {
  const [days, setDays] = useState<DayStats[] | null>(null);
  useEffect(
    () =>
      listenQuery(
        // Snapshots have a `date` field; the page-load counters in the same collection don't,
        // so ordering by it leaves them out.
        query(collection(db, 'stats'), orderBy('date', 'desc'), limit(7)),
        (snap) => setDays(snap.docs.map((d) => d.data() as DayStats)),
        () => setDays([]),
      ),
    [],
  );
  return days;
}

export interface TelemetryState {
  installId?: string;
  enabled?: boolean;
  noticeSeen?: boolean;
  lastReport?: Record<string, unknown> | null;
  lastSentAt?: Timestamp | null;
  lastStatus?: number;
  disabledBy?: 'env' | 'admin';
}

export function useTelemetry(): TelemetryState | null {
  const [t, setT] = useState<TelemetryState | null>(null);
  useEffect(() => listenDoc(doc(db, 'config', 'telemetry'), (snap) => setT((snap.data() as TelemetryState) ?? {}), () => setT({})), []);
  return t;
}

export async function setTelemetryEnabled(enabled: boolean) {
  await setDoc(doc(db, 'config', 'telemetry'), { enabled }, { merge: true });
}

export async function dismissTelemetryNotice() {
  await setDoc(doc(db, 'config', 'telemetry'), { noticeSeen: true }, { merge: true });
}

export const FREE_READS_PER_DAY = 50_000;
export const FREE_WRITES_PER_DAY = 20_000;
export const LOAD_LABELS: Record<string, string> = { lt1s: 'under 1s', lt2_5s: '1–2.5s', lt4s: '2.5–4s', gte4s: 'over 4s' };

/** The histogram bucket holding the 75th percentile. */
export function p75(hist: DayStats['pageLoad']): string | null {
  const keys = ['lt1s', 'lt2_5s', 'lt4s', 'gte4s'] as const;
  const total = keys.reduce((s, k) => s + (hist[k] ?? 0), 0);
  if (!total) return null;
  let seen = 0;
  for (const k of keys) {
    seen += hist[k] ?? 0;
    if (seen >= total * 0.75) return k;
  }
  return 'gte4s';
}
