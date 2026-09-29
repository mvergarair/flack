/** File helpers with no Firebase dependency (unit-testable). */
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
const BLOCKED_EXT = /\.(exe|msi|bat|cmd|com|scr|ps1|vbs|dll|cpl|jar|app|sh)$/i;


/** Client-side mirror of the storage rules, so people get an instant, clear error. */
export function validateFile(f: File): string | null {
  if (f.size > MAX_FILE_BYTES) return `${f.name} is larger than 50 MB.`;
  if (f.size === 0) return `${f.name} is empty.`;
  if (BLOCKED_EXT.test(f.name)) return `${f.name}: executable files aren't allowed.`;
  return null;
}

/** Storage object names: keep them readable but safe (no slashes, control chars or huge names). */
export function safeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    .replace(/[/\\?%*:|"<>#\u0000-\u001f]/g, '_')
    .replace(/^\.+/, '_')
    .trim();
  if (cleaned.length <= 150) return cleaned || 'file';
  const dot = cleaned.lastIndexOf('.');
  const ext = dot > 0 && cleaned.length - dot <= 10 ? cleaned.slice(dot) : '';
  return cleaned.slice(0, 150 - ext.length) + ext;
}

export function isImage(contentType: string): boolean {
  return /^image\/(png|jpe?g|gif|webp|avif|bmp)$/i.test(contentType);
}
