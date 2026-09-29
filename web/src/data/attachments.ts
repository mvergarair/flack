import { deleteObject, getBlob, ref, uploadBytesResumable } from 'firebase/storage';
import { storage } from '../firebase';
import type { Attachment } from './types';

export { MAX_FILE_BYTES, validateFile, safeFileName, isImage } from '../lib/files';
import { safeFileName, isImage } from '../lib/files';

const THUMB_MAX = 400;

export interface PendingFile {
  id: string;
  file: File;
  progress: number; // 0..1
}

/** Scales an image down to a ≤400px WebP thumbnail in the browser. */
async function makeThumbnail(file: File): Promise<{ blob: Blob; width: number; height: number } | null> {
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    const scale = Math.min(1, THUMB_MAX / Math.max(width, height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/webp', 0.8));
    return blob ? { blob, width, height } : null;
  } catch {
    return null;
  }
}

function upload(path: string, data: Blob, contentType: string, uploaderId: string, onProgress?: (p: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const task = uploadBytesResumable(ref(storage, path), data, {
      contentType,
      customMetadata: { uploaderId },
      cacheControl: 'private, max-age=31536000',
    });
    task.on('state_changed', (s) => onProgress?.(s.bytesTransferred / Math.max(1, s.totalBytes)), reject, () => resolve());
  });
}

/**
 * Uploads files for a message that doesn't exist yet: channels/{cid}/{mid}/{name}.
 * Returns the `attachments` array to store on the message.
 */
export async function uploadAttachments(
  channelId: string,
  messageId: string,
  uploaderId: string,
  files: PendingFile[],
  onProgress: (id: string, progress: number) => void,
): Promise<Attachment[]> {
  const used = new Set<string>();
  const out: Attachment[] = [];
  for (const pf of files) {
    let name = safeFileName(pf.file.name);
    for (let i = 2; used.has(name); i++) name = name.replace(/(\.[^.]*)?$/, `-${i}$1`);
    used.add(name);
    const base = `channels/${channelId}/${messageId}`;
    const contentType = pf.file.type || 'application/octet-stream';
    const att: Attachment = { name, size: pf.file.size, contentType, storagePath: `${base}/${name}`, thumbPath: null, width: null, height: null };
    if (isImage(contentType)) {
      const thumb = await makeThumbnail(pf.file);
      if (thumb) {
        att.width = thumb.width;
        att.height = thumb.height;
        att.thumbPath = `${base}/thumb_${name.replace(/\.[^.]*$/, '')}.webp`;
        await upload(att.thumbPath, thumb.blob, 'image/webp', uploaderId);
      }
    }
    await upload(att.storagePath, pf.file, contentType, uploaderId, (p) => onProgress(pf.id, p));
    out.push(att);
  }
  return out;
}

// Downloaded blobs are cached as object URLs for the session (rules are checked on fetch).
const blobCache = new Map<string, Promise<string>>();

/** Fetches a file through the SDK (never a public URL) and returns an object URL. */
export function objectUrlFor(path: string): Promise<string> {
  let p = blobCache.get(path);
  if (!p) {
    // The content type comes from the uploader. Only raster images keep theirs (shown in <img>);
    // everything else becomes a plain download, so an uploaded HTML/SVG file can never render
    // as a page in the app's origin (e.g. when a browser ignores the download attribute).
    p = getBlob(ref(storage, path)).then((b) => URL.createObjectURL(isImage(b.type) ? b : new Blob([b], { type: 'application/octet-stream' })));
    p.catch(() => blobCache.delete(path));
    blobCache.set(path, p);
  }
  return p;
}

export async function downloadAttachment(att: Attachment) {
  const url = await objectUrlFor(att.storagePath);
  const a = document.createElement('a');
  a.href = url;
  a.download = att.name;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export async function deleteUploads(paths: string[]) {
  await Promise.all(paths.map((p) => deleteObject(ref(storage, p)).catch(() => undefined)));
}
