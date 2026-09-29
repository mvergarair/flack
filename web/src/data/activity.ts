import { useEffect, useState } from 'react';
import { collection, deleteDoc, doc, limit, orderBy, query } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { listenQuery } from '../lib/snapshot';
import type { ActivityItem } from './types';

const SEEN_KEY = 'flack:activitySeen';

export function getActivitySeen(): number {
  try {
    return Number(localStorage.getItem(SEEN_KEY) ?? 0);
  } catch {
    return 0;
  }
}

export function setActivitySeen(ms: number) {
  try {
    localStorage.setItem(SEEN_KEY, String(ms));
  } catch {
    // ignore
  }
  window.dispatchEvent(new Event('flack:activity-seen'));
}

/** My latest 50 mentions and thread replies (written by the notifications function). */
export function useActivity() {
  const { user } = useAuth();
  const [items, setItems] = useState<ActivityItem[] | null>(null);
  useEffect(() => {
    if (!user) return;
    return listenQuery(query(collection(db, 'users', user.uid, 'activity'), orderBy('createdAt', 'desc'), limit(50)), (snap) =>
      setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as ActivityItem)),
    );
  }, [user]);
  return items;
}

/** Number of activity items newer than the last time the Activity view was opened. */
export function useUnseenActivity(items: ActivityItem[] | null): number {
  const [seen, setSeen] = useState(getActivitySeen);
  useEffect(() => {
    const on = () => setSeen(getActivitySeen());
    window.addEventListener('flack:activity-seen', on);
    return () => window.removeEventListener('flack:activity-seen', on);
  }, []);
  return (items ?? []).filter((i) => (i.createdAt?.toMillis() ?? 0) > seen).length;
}

export async function dismissActivity(uid: string, id: string) {
  await deleteDoc(doc(db, 'users', uid, 'activity', id));
}
