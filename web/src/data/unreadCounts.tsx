import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { collection, getCountFromServer, query, where, Timestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from './workspace';
import { isUnread } from '../lib/unread';

const CountsContext = createContext<Map<string, number>>(new Map());

/**
 * Badge counts: unread messages in DMs, unread @mentions in channels.
 * Only channels flagged unread (lastMessageAt > my read marker) are counted, using count
 * aggregation queries (1 billed read per 1000 index entries), and only when something changed.
 */
export function UnreadCountsProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const { channels, reads, manualReads } = useWorkspace();
  const [counts, setCounts] = useState<Map<string, number>>(new Map());
  const cache = useRef(new Map<string, { key: string; count: number }>());
  const uid = user?.uid;

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    const run = async () => {
      const next = new Map<string, number>();
      await Promise.all(
        channels.map(async (c) => {
          if (!isUnread(c, reads, uid, manualReads)) return;
          const since = reads.get(c.id) ?? Timestamp.fromMillis(0);
          const key = `${c.lastMessageAt?.toMillis()}:${since.toMillis()}`;
          const hit = cache.current.get(c.id);
          if (hit?.key === key) {
            if (hit.count) next.set(c.id, hit.count);
            return;
          }
          const msgs = collection(db, 'channels', c.id, 'messages');
          const q =
            c.type === 'dm'
              ? query(msgs, where('threadParentId', '==', null), where('createdAt', '>', since))
              : query(msgs, where('mentions', 'array-contains-any', [uid, '!channel', '!here']), where('createdAt', '>', since));
          try {
            const res = await getCountFromServer(q);
            const count = res.data().count;
            cache.current.set(c.id, { key, count });
            if (count) next.set(c.id, count);
          } catch {
            // Offline or missing index: no badge rather than a broken sidebar.
          }
        }),
      );
      if (!cancelled) setCounts(next);
    };
    const t = setTimeout(run, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [uid, channels, reads, manualReads]);

  return <CountsContext.Provider value={counts}>{children}</CountsContext.Provider>;
}

export const useMentionCounts = () => useContext(CountsContext);
