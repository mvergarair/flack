import { useEffect, useState } from 'react';
import { collection, query, where, type Timestamp } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { listenQuery } from '../lib/snapshot';

export type ApiScope = 'read' | 'write';

export interface ApiToken {
  /** SHA-256 of the token (the doc id); the token itself is never stored. */
  id: string;
  name: string;
  scopes: ApiScope[];
  /** First characters of the token, to tell tokens apart. */
  prefix: string;
  createdAt: Timestamp | null;
  lastUsedAt: Timestamp | null;
}

/** My API tokens, newest first. */
export function useApiTokens(uid: string): ApiToken[] | null {
  const [tokens, setTokens] = useState<ApiToken[] | null>(null);
  useEffect(
    () =>
      listenQuery(query(collection(db, 'apiTokens'), where('uid', '==', uid)), (snap) =>
        setTokens(
          snap.docs
            .map((d) => ({ id: d.id, ...d.data() }) as ApiToken)
            .sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0)),
        ),
      ),
    [uid],
  );
  return tokens;
}

export async function createApiToken(name: string, scopes: ApiScope[]) {
  const fn = httpsCallable<{ name: string; scopes: ApiScope[] }, { id: string; token: string; scopes: ApiScope[] }>(functions, 'createapitoken');
  return (await fn({ name, scopes })).data;
}

export async function revokeApiToken(id: string) {
  await httpsCallable<{ id: string }>(functions, 'revokeapitoken')({ id });
}

/** Where the API lives for this deployment (Hosting rewrites /api to the function). */
export const apiBaseUrl = () => `${location.origin}/api/v1`;
/** This deployment's interactive API reference (built by scripts/build-api-docs.mjs). */
export const API_DOCS_URL = '/api/docs/';
