// Pure helpers for Flackbot's settings (config/bot) and auto-responses. No Firestore here, so
// they're unit-tested directly.

export const BOT_ID = 'flackbot';
export const MAX_RESPONSES = 50;
const MAX_TRIGGER = 100;
const MAX_REPLY = 2000;
const MAX_WELCOME = 2000;

export interface AutoResponse {
  trigger: string;
  reply: string;
}

export interface BotConfig {
  welcome: string;
  responses: AutoResponse[];
}

export const DEFAULT_WELCOME = [
  "Hi! I'm Flackbot. 👋",
  '',
  "I'll send your reminders here, and let you know if a scheduled message can't go out.",
  '',
  'A few things to try:',
  '• Press ⌘K (Ctrl+K) to search messages, people and channels',
  '• Type / in any message box for reminders and scheduling',
  '• Hover a message and pick "Remind me" to come back to it later',
].join('\n');

export const HELP_REPLY = [
  "I'm a simple bot for now: I send your reminders and answer the questions your admins set up.",
  '',
  '• Type /remind in any message box to set a reminder',
  '• Press ⌘K (Ctrl+K) to search',
].join('\n');

/** The DM between a person and Flackbot, following the app's "dm_" + sorted members scheme. */
export const botDmId = (uid: string) => 'dm_' + [uid, BOT_ID].sort().join('_');

/**
 * Whatever an admin stored in config/bot, cleaned up: rules only check the shape loosely, so
 * everything is re-validated here before use.
 */
export function sanitizeConfig(raw: unknown): BotConfig {
  const d = (raw ?? {}) as { welcome?: unknown; responses?: unknown };
  const welcome = typeof d.welcome === 'string' && d.welcome.trim() ? d.welcome.trim().slice(0, MAX_WELCOME) : DEFAULT_WELCOME;
  const responses: AutoResponse[] = [];
  for (const r of Array.isArray(d.responses) ? d.responses : []) {
    const trigger = typeof r?.trigger === 'string' ? normalize(r.trigger).slice(0, MAX_TRIGGER) : '';
    const reply = typeof r?.reply === 'string' ? r.reply.trim().slice(0, MAX_REPLY) : '';
    if (trigger && reply) responses.push({ trigger, reply });
    if (responses.length === MAX_RESPONSES) break;
  }
  return { welcome, responses };
}

/** Lowercase, accents folded, punctuation dropped, single spaces. */
export function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/<[@!][^>]*>/g, ' ') // mention tokens
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The first response whose trigger phrase appears in the message as whole words. */
export function matchResponse(text: string, responses: AutoResponse[]): AutoResponse | null {
  const hay = ` ${normalize(text)} `;
  if (hay.length <= 2) return null;
  return responses.find((r) => hay.includes(` ${r.trigger} `)) ?? null;
}
