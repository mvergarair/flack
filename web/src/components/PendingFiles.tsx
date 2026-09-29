import { useEffect, useState } from 'react';
import type { PendingFile } from '../data/attachments';
import { isImage } from '../data/attachments';
import { formatBytes } from '../lib/time';
import { CloseIcon, FileIcon } from './icons';
import styles from './PendingFiles.module.css';

function Preview({ file }: { file: File }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!isImage(file.type)) return;
    const u = URL.createObjectURL(file);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file]);
  return url ? <img src={url} alt="" className={styles.thumb} /> : <span className={styles.icon}><FileIcon /></span>;
}

export function PendingFiles({ files, onRemove, disabled }: { files: PendingFile[]; onRemove: (id: string) => void; disabled?: boolean }) {
  if (!files.length) return null;
  return (
    <ul className={styles.list} aria-label="Files to send" data-testid="pending-files">
      {files.map((f) => (
        <li key={f.id} className={styles.item}>
          <Preview file={f.file} />
          <span className={styles.meta}>
            <strong>{f.file.name}</strong>
            <span>{f.progress > 0 && f.progress < 1 ? `${Math.round(f.progress * 100)}%` : formatBytes(f.file.size)}</span>
          </span>
          {f.progress > 0 && <span className={styles.bar} style={{ width: `${f.progress * 100}%` }} />}
          <button type="button" className={styles.remove} aria-label={`Remove ${f.file.name}`} onClick={() => onRemove(f.id)} disabled={disabled}>
            <CloseIcon size={14} />
          </button>
        </li>
      ))}
    </ul>
  );
}
