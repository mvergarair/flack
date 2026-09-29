import { useEffect, useMemo, useRef, useState } from 'react';
import { onDisconnect, onValue, ref, remove, serverTimestamp, set } from 'firebase/database';
import { doc, updateDoc } from 'firebase/firestore';
import { db, rtdb } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import type { Channel } from './types';

const THROTTLE_MS = 3000;
const IDLE_MS = 5000;
const STALE_MS = 7000;

/** A new secret typing key ("t_" + 24 random letters/digits) for a channel doc. */
export function newTypingKey(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 't_' + Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => abc[b % abc.length]).join('');
}

/**
 * RTDB path key for typing indicators: the channel's secret `typingKey` (only people who can
 * read the channel doc know it, since RTDB rules can't check channel membership), plus
 * `:{threadId}` for a thread. Null until the channel has a key.
 */
export const typingKey = (channel: Pick<Channel, 'typingKey'>, threadId?: string | null) =>
  channel.typingKey ? (threadId ? `${channel.typingKey}:${threadId}` : channel.typingKey) : null;

/** Channels created before typing keys existed get one the first time a member opens them. */
export function useEnsureTypingKey(channel: Channel, me: string) {
  const missing = !channel.typingKey && channel.memberIds.includes(me);
  useEffect(() => {
    if (missing) updateDoc(doc(db, 'channels', channel.id), { typingKey: newTypingKey() }).catch(() => undefined);
  }, [missing, channel.id]);
}

/** Typing signal for the current user: typing/{key}/{uid} = server time (RTDB). */
export function useTyping(channelId: string | null) {
  const { user } = useAuth();
  const uid = user?.uid;
  const last = useRef(0);
  const idle = useRef<ReturnType<typeof setTimeout>>(undefined);

  const api = useMemo(() => {
    const path = uid && channelId ? ref(rtdb, `typing/${channelId}/${uid}`) : null;
    const stop = () => {
      clearTimeout(idle.current);
      if (path && last.current) {
        last.current = 0;
        remove(path).catch(() => undefined);
      }
    };
    const ping = () => {
      if (!path) return;
      const now = Date.now();
      if (now - last.current > THROTTLE_MS) {
        last.current = now;
        set(path, serverTimestamp()).catch(() => undefined);
        onDisconnect(path).remove().catch(() => undefined);
      }
      clearTimeout(idle.current);
      idle.current = setTimeout(stop, IDLE_MS);
    };
    return { ping, stop };
  }, [channelId, uid]);

  useEffect(() => api.stop, [api]);
  return api;
}

/** Other people currently typing in a channel. */
export function useTypingUsers(channelId: string | null): string[] {
  const { user } = useAuth();
  const [raw, setRaw] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setRaw({});
    if (!channelId) return;
    return onValue(
      ref(rtdb, `typing/${channelId}`),
      (snap) => setRaw((snap.val() ?? {}) as Record<string, number>),
      () => setRaw({}),
    );
  }, [channelId]);

  const active = Object.keys(raw).length > 0;
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, [active]);

  return Object.entries(raw)
    .filter(([uid, ts]) => uid !== user?.uid && now - ts < STALE_MS)
    .map(([uid]) => uid);
}
