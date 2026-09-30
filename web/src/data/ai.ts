import { useEffect, useState, useSyncExternalStore } from 'react';
import { collection, doc, limit, orderBy, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import { onValue, ref } from 'firebase/database';
import { httpsCallable } from 'firebase/functions';
import { db, functions, rtdb } from '../firebase';
import { listenDoc, listenQuery } from '../lib/snapshot';
import { botDmId } from '../lib/bot';
import type { Message } from './types';
import { toMessage } from './messages';

export const AI_MODELS = [
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 (recommended)' },
  { id: 'claude-haiku-4-5', label: 'Claude Haiku 4.5 (cheapest)' },
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 (most capable, about twice the cost)' },
] as const;
export type AiModel = (typeof AI_MODELS)[number]['id'];

export interface AiSettings {
  enabled: boolean;
  model: AiModel;
  dailyLimit: number;
  monthlyBudgetUsd: number;
}

export const AI_DEFAULTS: AiSettings = { enabled: false, model: 'claude-sonnet-5-5', dailyLimit: 30, monthlyBudgetUsd: 20 };

// One shared listener on config/ai for the whole app (the sidebar, composer and pane all ask).
let current: AiSettings | null = null;
const subscribers = new Set<() => void>();
let stop: (() => void) | null = null;
function subscribe(cb: () => void) {
  subscribers.add(cb);
  if (!stop) {
    stop = listenDoc(doc(db, 'config', 'ai'), (snap) => {
      const d = snap.data() ?? {};
      current = {
        enabled: d.enabled === true,
        model: AI_MODELS.some((m) => m.id === d.model) ? (d.model as AiModel) : AI_DEFAULTS.model,
        dailyLimit: typeof d.dailyLimit === 'number' ? d.dailyLimit : AI_DEFAULTS.dailyLimit,
        monthlyBudgetUsd: typeof d.monthlyBudgetUsd === 'number' ? d.monthlyBudgetUsd : AI_DEFAULTS.monthlyBudgetUsd,
      };
      subscribers.forEach((s) => s());
    });
  }
  return () => {
    subscribers.delete(cb);
    if (!subscribers.size && stop) {
      stop();
      stop = null;
      current = null;
    }
  };
}

/** Ask Flackbot settings (null while loading). */
export function useAiSettings(): AiSettings | null {
  return useSyncExternalStore(subscribe, () => current);
}

export async function saveAiSettings(uid: string, s: AiSettings): Promise<void> {
  await setDoc(doc(db, 'config', 'ai'), { ...s, updatedAt: serverTimestamp(), updatedBy: uid });
}

/** Asks Flackbot about a question already posted in my Flackbot DM. Resolves when answered. */
export async function askFlackbot(messageId: string, conversationId: string): Promise<void> {
  await httpsCallable(functions, 'askflackbot', { timeout: 310_000 })({ messageId, conversationId });
}

export async function checkFlackbotAi(): Promise<{ ok: boolean; error?: string; detail?: string }> {
  return (await httpsCallable<unknown, { ok: boolean; error?: string; detail?: string }>(functions, 'testflackbotai')({})).data;
}

// The current conversation, per browser. "New chat" starts another.
const CONVERSATION_KEY = 'flack:flackbot:conversation';
const newId = () => Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, '0')).join('');
function readConversation(): string {
  try {
    const v = localStorage.getItem(CONVERSATION_KEY);
    if (v && /^[a-f0-9]{24}$/.test(v)) return v;
    const id = newId();
    localStorage.setItem(CONVERSATION_KEY, id);
    return id;
  } catch {
    return (window as { __flackConversation?: string }).__flackConversation ??= newId();
  }
}
const conversationSubs = new Set<() => void>();
let conversation: string | null = null;
export function currentConversation(): string {
  return (conversation ??= readConversation());
}
export function startNewConversation(): void {
  conversation = newId();
  try {
    localStorage.setItem(CONVERSATION_KEY, conversation);
  } catch {
    // private mode: this tab only
  }
  conversationSubs.forEach((s) => s());
}
export function useConversationId(): string {
  return useSyncExternalStore(
    (cb) => {
      conversationSubs.add(cb);
      return () => conversationSubs.delete(cb);
    },
    currentConversation,
  );
}

/** The questions and answers of one conversation, oldest first (the last 60). */
export function useConversation(uid: string, conversationId: string, dmExists: boolean): Message[] | null {
  const [messages, setMessages] = useState<Message[] | null>(null);
  useEffect(() => {
    // No Flackbot DM yet: nothing asked (and the query would be refused until it exists).
    if (!dmExists) return void setMessages([]);
    setMessages(null);
    return listenQuery(
      query(collection(db, 'channels', botDmId(uid), 'messages'), where('ai.conversationId', '==', conversationId), orderBy('createdAt', 'desc'), limit(60)),
      (snap) => setMessages(snap.docs.map(toMessage).reverse()),
      () => setMessages([]), // the DM doesn't exist yet: nothing asked
    );
  }, [uid, conversationId, dmExists]);
  return messages;
}

export interface BotDraft {
  questionId: string;
  conversationId: string;
  status: string;
  text: string;
  at: number;
}

/** Flackbot's answer while it's being written (RTDB botDrafts/{uid}). */
export function useBotDraft(uid: string): BotDraft | null {
  const [draft, setDraft] = useState<BotDraft | null>(null);
  useEffect(() => onValue(ref(rtdb, `botDrafts/${uid}`), (snap) => setDraft((snap.val() as BotDraft | null) ?? null), () => setDraft(null)), [uid]);
  return draft;
}

export interface AiUsage {
  questions: number;
  costUsd: number;
}

/** This month's Ask Flackbot usage (admins). */
export function useAiUsage(): AiUsage | null {
  const [u, setU] = useState<AiUsage | null>(null);
  useEffect(() => {
    const month = new Date().toISOString().slice(0, 7);
    return listenDoc(
      doc(db, 'aiUsage', month),
      (snap) => setU({ questions: (snap.get('questions') as number) ?? 0, costUsd: (snap.get('costUsd') as number) ?? 0 }),
      () => setU(null),
    );
  }, []);
  return u;
}

/** The last connection problem Flackbot hit, if any (admins). */
export function useAiStatus(): { error: string | null } | null {
  const [s, setS] = useState<{ error: string | null } | null>(null);
  useEffect(() => listenDoc(doc(db, 'config', 'aiStatus'), (snap) => setS({ error: (snap.get('error') as string | null) ?? null }), () => setS(null)), []);
  return s;
}
