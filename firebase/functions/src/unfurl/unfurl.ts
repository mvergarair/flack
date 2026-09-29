import type { DocumentReference } from 'firebase-admin/firestore';
import { isEmulator } from '../lib/admin.js';
import { extractUrls, type LinkPreview } from './og.js';
import { fetchPreview } from './fetch.js';

/** Writes `linkPreviews` for the message's links (or clears them when links are gone). */
export async function unfurlMessage(ref: DocumentReference, text: string, previous: LinkPreview[] | undefined) {
  const urls = extractUrls(text);
  const prevUrls = (previous ?? []).map((p) => p.url);
  if (urls.length === prevUrls.length && urls.every((u, i) => u === prevUrls[i])) return;
  if (urls.length === 0) {
    if (prevUrls.length) await ref.update({ linkPreviews: [] });
    return;
  }
  const previews = (await Promise.all(urls.map((u) => fetchPreview(u, isEmulator)))).filter((p): p is LinkPreview => !!p);
  await ref.update({ linkPreviews: previews });
}
