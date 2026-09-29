import { httpsCallable } from 'firebase/functions';
import { functions } from '../firebase';

export interface SearchInput {
  q: string;
  channelId?: string;
  authorId?: string;
  hasFile?: boolean;
  after?: number;
  before?: number;
}

export interface SearchResult {
  messageId: string;
  channelId: string;
  threadParentId: string | null;
  authorId: string;
  createdAt: number;
  snippet: string;
  hasFile: boolean;
}

const fn = httpsCallable<SearchInput, { results: SearchResult[]; nextBefore: number | null }>(functions, 'searchmessages');

export async function searchMessages(input: SearchInput) {
  // Omit unset filters entirely (callables would otherwise send them as null).
  const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined && v !== '' && v !== false)) as SearchInput;
  return (await fn(clean)).data;
}
