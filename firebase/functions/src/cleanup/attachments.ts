import { onDocumentDeleted, onDocumentUpdated } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions/v2';
import { FieldValue } from 'firebase-admin/firestore';
import { bucket, db, isEmulator } from '../lib/admin.js';
import { unfurlMessage } from '../unfurl/unfurl.js';
import { indexMessage, searchRef } from '../search/index.js';
import type { LinkPreview } from '../unfurl/og.js';
import type { Attachment, MessageDoc } from '../lib/types.js';

const ORPHAN_AGE_MS = 24 * 60 * 60 * 1000;

/** Every stored object for an attachment: the file and its thumbnail. */
export function attachmentPaths(atts: Attachment[] | undefined): string[] {
  return (atts ?? []).flatMap((a) => [a.storagePath, a.thumbPath].filter((p): p is string => !!p));
}

/** True when `path` is a file directly inside `folder` (no `..`, no sub-folders). */
export function ownsPath(folder: string, path: string): boolean {
  return path.startsWith(folder) && !path.slice(folder.length).includes('/') && !path.includes('..') && path.length > folder.length;
}

async function deletePaths(paths: string[]) {
  await Promise.all(
    paths.map((p) =>
      bucket()
        .file(p)
        .delete({ ignoreNotFound: true })
        .catch((err) => logger.warn('Delete failed', { path: p, err: String(err) })),
    ),
  );
}

/** Removes a message from its channel's pinned list, if it was pinned. */
async function unpin(channelId: string, messageId: string) {
  const ref = db.doc(`channels/${channelId}`);
  const snap = await ref.get();
  if ((snap.get('pinnedIds') as string[] | undefined)?.includes(messageId)) {
    await ref.update({ pinnedIds: FieldValue.arrayRemove(messageId) });
  }
}

/** Message deleted → unpin it and delete everything under its folder (files, thumbnails). */
export const onmessagedeleted = onDocumentDeleted('channels/{channelId}/messages/{messageId}', async (event) => {
  const { channelId, messageId } = event.params;
  const msg = event.data?.data() as MessageDoc | undefined;
  if (isEmulator && msg?.seeded) return; // emulator seed data (reset between tests)
  await searchRef(messageId).delete();
  await unpin(channelId, messageId);
  if (!msg?.attachments?.length && isEmulator) return;
  await bucket().deleteFiles({ prefix: `channels/${channelId}/${messageId}/`, force: true });
  logger.info('Deleted message files', { channelId, messageId });
});

/** Attachments removed by an edit or soft delete → delete those objects. */
export const onmessageupdated = onDocumentUpdated('channels/{channelId}/messages/{messageId}', async (event) => {
  const beforeDoc = event.data?.before.data() as MessageDoc | undefined;
  const afterDoc = event.data?.after.data() as MessageDoc | undefined;
  if (afterDoc?.deleted && !beforeDoc?.deleted) await unpin(event.params.channelId, event.params.messageId);
  // Edited text, removed files or soft delete → refresh the search index.
  const attNames = (m?: MessageDoc) => (m?.attachments ?? []).map((a) => a.name).join('\n');
  if (afterDoc && (beforeDoc?.text !== afterDoc.text || attNames(beforeDoc) !== attNames(afterDoc) || !!afterDoc.deleted !== !!beforeDoc?.deleted)) {
    await indexMessage(event.params.channelId, event.params.messageId, afterDoc).catch((err) => logger.error('Search reindex failed', { err: String(err) }));
  }
  // Edited text → refresh link previews (writes to linkPreviews don't change text, so no loop).
  if (afterDoc && !afterDoc.deleted && beforeDoc?.text !== afterDoc.text && event.data?.after.ref) {
    await unfurlMessage(event.data.after.ref, afterDoc.text ?? '', (afterDoc as { linkPreviews?: LinkPreview[] }).linkPreviews).catch(() => undefined);
  }
  const before = beforeDoc?.attachments;
  const after = afterDoc?.attachments;
  const keep = new Set(attachmentPaths(after));
  // Only ever delete inside this message's own folder: `attachments` is client-written, so a
  // path pointing elsewhere (another message or channel) must never be acted on.
  const own = `channels/${event.params.channelId}/${event.params.messageId}/`;
  const gone = attachmentPaths(before).filter((p) => !keep.has(p) && ownsPath(own, p));
  if (gone.length) await deletePaths(gone);
});

/**
 * Daily: uploads whose message was never written (closed tab mid-send, failed write) are
 * deleted once they're a day old. Folder = channels/{cid}/{mid}/.
 */
export const cleanuporphanuploads = onSchedule({ schedule: 'every day 04:00', timeZone: 'UTC', timeoutSeconds: 540 }, async () => {
  const cutoff = Date.now() - ORPHAN_AGE_MS;
  const folders = new Map<string, string[]>();
  let pageToken: string | undefined;
  do {
    const [files, next] = await bucket().getFiles({ prefix: 'channels/', maxResults: 1000, pageToken, autoPaginate: false });
    for (const f of files) {
      const created = Date.parse(f.metadata.timeCreated ?? '');
      if (!created || created > cutoff) continue;
      const m = /^channels\/([^/]+)\/([^/]+)\//.exec(f.name);
      if (!m) continue;
      const key = `${m[1]}/${m[2]}`;
      folders.set(key, [...(folders.get(key) ?? []), f.name]);
    }
    pageToken = (next as { pageToken?: string } | undefined)?.pageToken;
  } while (pageToken);

  let removed = 0;
  const keys = [...folders.keys()];
  for (let i = 0; i < keys.length; i += 100) {
    const chunk = keys.slice(i, i + 100);
    const snaps = await db.getAll(...chunk.map((k) => db.doc(`channels/${k.split('/')[0]}/messages/${k.split('/')[1]}`)));
    for (let j = 0; j < snaps.length; j++) {
      if (snaps[j].exists) continue;
      const paths = folders.get(chunk[j])!;
      await deletePaths(paths);
      removed += paths.length;
    }
  }
  logger.info('Orphan upload cleanup', { scannedFolders: keys.length, removed });
});
