import { createHash, randomBytes } from 'node:crypto';

/** API tokens look like `flk_` + 43 base64url characters (256 random bits). */
export const TOKEN_PREFIX = 'flk_';
export const SCOPES = ['read', 'write'] as const;
export type Scope = (typeof SCOPES)[number];
export const MAX_TOKENS_PER_USER = 20;

export function newToken(): string {
  return TOKEN_PREFIX + randomBytes(32).toString('base64url');
}

export function isTokenFormat(token: string): boolean {
  return /^flk_[A-Za-z0-9_-]{43}$/.test(token);
}

/** Tokens are stored only as this hash (also the doc id in apiTokens/), never in plain text. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** Scopes from client input: a non-empty subset of read/write; write implies read. */
export function parseScopes(input: unknown): Scope[] | null {
  if (!Array.isArray(input) || !input.length || !input.every((s) => (SCOPES as readonly unknown[]).includes(s))) return null;
  const set = new Set(input as Scope[]);
  if (set.has('write')) set.add('read');
  return SCOPES.filter((s) => set.has(s));
}

/** A new random typing key for channel docs created by functions (see web/src/data/typing.ts). */
export function newTypingKey(): string {
  const abc = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  return 't_' + Array.from(randomBytes(24), (b) => abc[b % abc.length]).join('');
}
