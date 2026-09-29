import type { Message } from '../data/types';
import { sameDay } from './time';

const GROUP_MS = 5 * 60 * 1000;

/** Consecutive messages from the same author within 5 minutes render compact. */
export function isCompact(prev: Message | undefined, m: Message): boolean {
  if (!prev || prev.authorId !== m.authorId || prev.deleted) return false;
  const a = prev.createdAt?.toMillis();
  const b = m.createdAt?.toMillis();
  if (a == null || b == null) return true;
  return b - a < GROUP_MS && sameDay(new Date(a), new Date(b));
}
