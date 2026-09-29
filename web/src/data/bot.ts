import { httpsCallable } from 'firebase/functions';
import { doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, functions } from '../firebase';
import { useEffect } from 'react';
import { listenDoc } from '../lib/snapshot';
import { botDmId } from '../lib/bot';
import { useAuth } from '../auth/AuthProvider';
import { useWorkspace } from './workspace';

/** Opens my Flackbot DM, creating it with the welcome message the first time. Returns its id. */
export async function openFlackbot(): Promise<string> {
  const res = await httpsCallable<unknown, { channelId: string }>(functions, 'openflackbot')({});
  return res.data.channelId;
}

export interface AutoResponse {
  trigger: string;
  reply: string;
}

export interface BotSettings {
  welcome: string;
  responses: AutoResponse[];
}

/** config/bot (admins only). An empty welcome means Flackbot's built-in one. */
export function listenBotSettings(cb: (s: BotSettings) => void): () => void {
  return listenDoc(doc(db, 'config', 'bot'), (snap) => {
    const d = snap.data() ?? {};
    cb({ welcome: typeof d.welcome === 'string' ? d.welcome : '', responses: Array.isArray(d.responses) ? (d.responses as AutoResponse[]) : [] });
  });
}

export async function saveBotSettings(uid: string, s: BotSettings): Promise<void> {
  await setDoc(doc(db, 'config', 'bot'), {
    welcome: s.welcome.trim(),
    responses: s.responses.map((r) => ({ trigger: r.trigger.trim(), reply: r.reply.trim() })).filter((r) => r.trigger && r.reply),
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/**
 * Everyone gets a Flackbot DM with a welcome message: new members on their first visit, and
 * existing members after an update. One call per person, ever (then the channel exists).
 */
export function useEnsureFlackbot(): void {
  const { user } = useAuth();
  const { ready, channelsById } = useWorkspace();
  const uid = user?.uid;
  const missing = ready && !!uid && !channelsById.has(botDmId(uid));
  useEffect(() => {
    if (!missing) return;
    openFlackbot().catch(() => undefined); // retried on the next visit
  }, [missing]);
}
