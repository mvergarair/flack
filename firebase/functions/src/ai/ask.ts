import { onCall, HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import type Anthropic from '@anthropic-ai/sdk';
import { db, rtdb } from '../lib/admin.js';
import type { MessageDoc, UserDoc } from '../lib/types.js';
import { postAsBot } from '../bot/bot.js';
import { BOT_ID, botDmId } from '../bot/rules.js';
import { costUsd, dayKey, monthKey, sanitizeAiConfig, type AiConfig } from './config.js';
import { historyTurns, runAgent } from './agent.js';
import { modelClient } from './model.js';
import { contextBlock } from './prompt.js';
import { Refs, toolContext } from './tools.js';

const HISTORY = 20;
const CONVERSATION_RE = /^[A-Za-z0-9_-]{8,40}$/;

async function activeUser(req: CallableRequest): Promise<{ uid: string; user: UserDoc }> {
  const uid = req.auth?.uid;
  if (!uid || req.auth?.token.active !== true) throw new HttpsError('unauthenticated', 'Sign in first.');
  const user = (await db.doc(`users/${uid}`).get()).data() as UserDoc | undefined;
  if (user?.status !== 'active') throw new HttpsError('permission-denied', 'Your account is not active.');
  return { uid, user };
}

export async function aiConfig(): Promise<AiConfig> {
  return sanitizeAiConfig((await db.doc('config/ai').get()).data());
}

/**
 * Ask Flackbot. The app posts the question in the asker's Flackbot DM as a normal message, then
 * calls this with its id. The answer is streamed to RTDB botDrafts/{uid} while it's written and
 * then posted in the same DM. Everything runs as the asker: the tools only see their channels.
 */
export const askflackbot = onCall({ timeoutSeconds: 300, memory: '512MiB' }, async (req) => {
  const { uid, user } = await activeUser(req);
  const { messageId, conversationId } = (req.data ?? {}) as { messageId?: unknown; conversationId?: unknown };
  if (typeof messageId !== 'string' || !/^[A-Za-z0-9_-]{1,100}$/.test(messageId)) throw new HttpsError('invalid-argument', 'Missing question.');
  if (typeof conversationId !== 'string' || !CONVERSATION_RE.test(conversationId)) throw new HttpsError('invalid-argument', 'Missing conversation.');

  const cfg = await aiConfig();
  if (!cfg.enabled) throw new HttpsError('failed-precondition', 'Ask Flackbot is off. An admin can turn it on in People & invites.');

  const channelId = botDmId(uid);
  const questionRef = db.doc(`channels/${channelId}/messages/${messageId}`);
  const month = monthKey();
  const today = dayKey();
  const usageRef = db.doc(`aiUsage/${month}`);
  const personRef = db.doc(`aiUsage/${month}/people/${uid}`);

  // Claim the question and count it against today's and this month's limits, atomically.
  const question = await db.runTransaction(async (tx) => {
    const [q, monthSnap, person] = await Promise.all([tx.get(questionRef), tx.get(usageRef), tx.get(personRef)]);
    const m = q.data() as (MessageDoc & { ai?: unknown }) | undefined;
    if (!m || m.authorId !== uid || m.deleted) throw new HttpsError('not-found', 'That question is gone.');
    if (m.ai) throw new HttpsError('already-exists', 'Flackbot already answered that.');
    const spent = (monthSnap.get('costUsd') as number | undefined) ?? 0;
    if (cfg.monthlyBudgetUsd > 0 && spent >= cfg.monthlyBudgetUsd) {
      throw new HttpsError('resource-exhausted', "Flackbot has used this month's AI budget. An admin can raise it in People & invites.");
    }
    const asked = person.get('day') === today ? ((person.get('dayCount') as number) ?? 0) : 0;
    if (asked >= cfg.dailyLimit) throw new HttpsError('resource-exhausted', `You've asked ${cfg.dailyLimit} questions today, the daily limit. Try again tomorrow.`);
    tx.update(questionRef, { ai: { conversationId } });
    tx.set(personRef, { day: today, dayCount: asked + 1, questions: FieldValue.increment(1) }, { merge: true });
    return m;
  });

  // Earlier turns of this conversation (the question itself is excluded: it's the new turn).
  const earlier = await db
    .collection(`channels/${channelId}/messages`)
    .where('ai.conversationId', '==', conversationId)
    .orderBy('createdAt', 'desc')
    .limit(HISTORY + 1)
    .get();
  const turns = historyTurns(
    earlier.docs
      .filter((d) => d.id !== messageId)
      .reverse()
      .map((d) => ({ role: d.get('authorId') === BOT_ID ? ('assistant' as const) : ('user' as const), text: String(d.get('text') ?? '') })),
  );

  const draft = rtdb().ref(`botDrafts/${uid}`);
  let lastWrite = 0;
  let pending: { status: string; text: string } | null = null;
  const flush = async () => {
    if (!pending) return;
    const p = pending;
    pending = null;
    lastWrite = Date.now();
    await draft.set({ questionId: messageId, conversationId, status: p.status, text: p.text.slice(0, 8000), at: Date.now() }).catch(() => undefined);
  };
  await draft.set({ questionId: messageId, conversationId, status: 'Thinking', text: '', at: Date.now() });

  const workspace = ((await db.doc('config/branding').get()).get('name') as string | undefined) || 'Flack';
  const refs = new Refs();
  let answer: string;
  let sources: ReturnType<Refs['cited']> = [];
  try {
    const result = await runAgent({
      client: modelClient(),
      model: cfg.model,
      messages: [
        ...turns,
        {
          role: 'user',
          content: [
            contextBlock({ name: user.displayName, title: user.title, timeZone: (user as { timeZone?: string }).timeZone || 'UTC', workspace, now: new Date() }),
            { type: 'text', text: plainQuestion(question.text) },
          ] satisfies Anthropic.ContentBlockParam[],
        },
      ],
      tools: await toolContext(uid, refs),
      onProgress: (p) => {
        pending = p;
        // At most ~4 writes a second.
        if (Date.now() - lastWrite > 250) void flush();
      },
    });
    await recordUsage(usageRef, personRef, cfg, result.usage);
    answer =
      result.stop === 'refusal'
        ? "Sorry, I can't help with that one."
        : result.stop === 'rounds' && !result.text
          ? "I looked in a lot of places but couldn't pin that down. Could you ask more specifically (a channel, a person or roughly when)?"
          : result.text || "I couldn't come up with an answer. Try asking another way?";
    sources = refs.cited(answer);
  } catch (err) {
    logger.error('Ask Flackbot failed', { err: String(err) });
    answer = friendlyModelError(err);
    await db.doc('config/aiStatus').set({ error: answer, at: FieldValue.serverTimestamp() }, { merge: true });
  }

  await postAsBot({
    channelId,
    text: answer,
    messageId: `ai_${messageId}`,
    extra: { ai: { conversationId, questionId: messageId }, botRef: { kind: 'ai', sources } },
  });
  await draft.remove().catch(() => undefined);
  return { ok: true };
});

/** Mentions become names so the model reads "@Ada", not "<@uAda>". */
function plainQuestion(text: string): string {
  return text.replace(/<@([A-Za-z0-9_-]+)>/g, '@someone').replace(/<!(channel|here)>/g, '@$1').slice(0, 4000);
}

async function recordUsage(month: FirebaseFirestore.DocumentReference, person: FirebaseFirestore.DocumentReference, cfg: AiConfig, u: Parameters<typeof costUsd>[1]) {
  const cost = costUsd(cfg.model, u);
  const inc = {
    questions: FieldValue.increment(1),
    inputTokens: FieldValue.increment(u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)),
    outputTokens: FieldValue.increment(u.output_tokens),
    costUsd: FieldValue.increment(cost),
  };
  await Promise.all([month.set({ ...inc, month: month.id }, { merge: true }), person.set({ costUsd: FieldValue.increment(cost) }, { merge: true })]);
}

/** What to tell people when Vertex AI says no, and what admins should do about it. */
export function friendlyModelError(err: unknown): string {
  const status = (err as { status?: number }).status;
  const text = String((err as Error)?.message ?? err);
  if (status === 403 || status === 404 || /not (been )?enabled|PERMISSION_DENIED|NOT_FOUND|not found/i.test(text)) {
    return "I can't reach Claude yet. An admin needs to enable the Claude model in Vertex AI Model Garden (People & invites → Flackbot has the link).";
  }
  if (status === 429 && /quota exceeded/i.test(text) && /per_base_model|PerBaseModel/i.test(text)) {
    return "I can't reach Claude yet: this project's Vertex AI quota for Claude is too low (new projects start at 0). An admin can request more in People & invites → Ask Flackbot.";
  }
  if (status === 429) return "I'm getting too many questions right now. Try again in a minute.";
  return 'Something went wrong on my side. Try again in a moment.';
}

/**
 * Admins: checks that Flackbot can reach the chosen model (and clears the last error). Runs
 * one tiny request (a few tokens).
 */
export const testflackbotai = onCall({ timeoutSeconds: 60 }, async (req) => {
  const { user } = await activeUser(req);
  if (user.role !== 'admin' || req.auth?.token.role !== 'admin') throw new HttpsError('permission-denied', 'Admins only.');
  const cfg = await aiConfig();
  try {
    const msg = await modelClient().turn({ model: cfg.model, max_tokens: 1000, output_config: { effort: 'low' }, messages: [{ role: 'user', content: 'Reply with the single word OK. (no tools)' }] }, () => undefined);
    await db.doc('config/aiStatus').set({ error: null, okAt: FieldValue.serverTimestamp(), model: cfg.model }, { merge: true });
    return { ok: true, model: cfg.model, stop: msg.stop_reason };
  } catch (err) {
    const message = friendlyModelError(err);
    await db.doc('config/aiStatus').set({ error: message, at: FieldValue.serverTimestamp() }, { merge: true });
    logger.warn('Flackbot AI check failed', { err: String(err) });
    return { ok: false, error: message, detail: String((err as Error)?.message ?? err).slice(0, 500) };
  }
});
