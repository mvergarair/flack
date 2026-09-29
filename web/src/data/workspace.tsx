import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { collection, orderBy, query, where, type Timestamp } from 'firebase/firestore';
import { listenQuery } from '../lib/snapshot';
import { onValue, ref } from 'firebase/database';
import { db, rtdb } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import type { Channel, NotifyLevel, SavedItem, ScheduledItem, UserProfile } from './types';

import { aggregatePresence, type AggregatedPresence } from '../lib/presence-aggregate';

/** One person's presence, combined across their devices. */
export type Presence = AggregatedPresence;

interface Workspace {
  ready: boolean;
  users: Map<string, UserProfile>;
  channels: Channel[];
  channelsById: Map<string, Channel>;
  reads: Map<string, Timestamp>;
  presence: Map<string, Presence>;
  /** Explicit per-channel notification settings (absent = default). */
  prefs: Map<string, NotifyLevel>;
  /** Channels whose read marker I moved back with "Mark unread". */
  manualReads: Set<string>;
  /** My saved-for-later messages, keyed by message id. */
  saved: Map<string, SavedItem>;
  /** My scheduled messages and reminders (pending or failed), soonest first. */
  scheduled: ScheduledItem[];
}

const WorkspaceContext = createContext<Workspace | null>(null);

/**
 * App-wide listeners, attached once per session:
 * - users (≤50 docs), my channels (array-contains), my read markers, and RTDB presence.
 * Everything else (messages, threads) is loaded per view with pagination.
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const uid = user?.uid;
  const [users, setUsers] = useState<Map<string, UserProfile>>(new Map());
  const [channels, setChannels] = useState<Channel[] | null>(null);
  const [reads, setReads] = useState<Map<string, Timestamp>>(new Map());
  const [manualReads, setManualReads] = useState<Set<string>>(new Set());
  const [saved, setSaved] = useState<Map<string, SavedItem>>(new Map());
  const [scheduled, setScheduled] = useState<ScheduledItem[]>([]);
  const [presence, setPresence] = useState<Map<string, Presence>>(new Map());
  const [prefs, setPrefs] = useState<Map<string, NotifyLevel>>(new Map());
  const [usersReady, setUsersReady] = useState(false);

  useEffect(() => {
    if (!uid) return;
    const unsubs = [
      listenQuery(collection(db, 'users'), (snap) => {
        setUsers(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data() } as UserProfile])));
        setUsersReady(true);
      }),
      listenQuery(query(collection(db, 'channels'), where('memberIds', 'array-contains', uid)), (snap) => {
        setChannels(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as Channel));
      }),
      listenQuery(collection(db, 'users', uid, 'saved'), (snap) => {
        setSaved(new Map(snap.docs.map((d) => [d.id, { id: d.id, ...d.data({ serverTimestamps: 'estimate' }) } as SavedItem])));
      }),
      listenQuery(query(collection(db, 'users', uid, 'scheduled'), orderBy('sendAt')), (snap) => {
        setScheduled(snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: 'estimate' }) }) as ScheduledItem));
      }),
      listenQuery(collection(db, 'users', uid, 'channelPrefs'), (snap) => {
        setPrefs(new Map(snap.docs.map((d) => [d.id, d.get('level') as NotifyLevel])));
      }),
      listenQuery(collection(db, 'users', uid, 'reads'), (snap) => {
        setReads(new Map(snap.docs.map((d) => [d.id, d.get('lastReadAt', { serverTimestamps: 'estimate' }) as Timestamp])));
        setManualReads(new Set(snap.docs.filter((d) => d.get('manual') === true).map((d) => d.id)));
      }),
    ];
    const off = onValue(ref(rtdb, 'status'), (snap) => {
      const val = (snap.val() ?? {}) as Record<string, unknown>;
      const next = new Map<string, Presence>();
      for (const [id, node] of Object.entries(val)) {
        const p = aggregatePresence(node);
        if (p) next.set(id, p);
      }
      setPresence(next);
    });
    return () => {
      unsubs.forEach((u) => u());
      off();
    };
  }, [uid]);

  const value = useMemo<Workspace>(() => {
    const list = channels ?? [];
    return {
      ready: usersReady && channels !== null,
      users,
      channels: list,
      channelsById: new Map(list.map((c) => [c.id, c])),
      reads,
      presence,
      prefs,
      manualReads,
      saved,
      scheduled,
    };
  }, [users, channels, reads, presence, prefs, manualReads, saved, scheduled, usersReady]);

  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace(): Workspace {
  const ws = useContext(WorkspaceContext);
  if (!ws) throw new Error('useWorkspace outside WorkspaceProvider');
  return ws;
}

export function useUser(uid: string | null | undefined): UserProfile | undefined {
  const { users } = useWorkspace();
  return uid ? users.get(uid) : undefined;
}

/** Avatar dot value: true (active), 'away', or false (offline). */
export function presenceDot(p: Presence | undefined): boolean | 'away' {
  return p?.state === 'online' ? true : p?.state === 'away' ? 'away' : false;
}

export function isOnline(p: Presence | undefined): boolean {
  return p?.state === 'online';
}

/** Effective notification level for a channel (explicit setting or the default). */
export function notifyLevel(channel: Channel, prefs: Map<string, NotifyLevel>): NotifyLevel {
  return prefs.get(channel.id) ?? (channel.type === 'dm' ? 'all' : 'mentions');
}
