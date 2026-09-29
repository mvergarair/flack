import { useEffect, useState } from 'react';
import { downloadAttachment, isImage, objectUrlFor } from '../data/attachments';
import { formatBytes } from '../lib/time';
import type { Attachment } from '../data/types';
import { DownloadIcon, ImageIcon } from './icons';
import styles from './Attachments.module.css';

function useObjectUrl(path: string | null | undefined) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!path) return;
    let alive = true;
    objectUrlFor(path)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path]);
  return { url, failed };
}

function ImageAttachment({ att, onOpen }: { att: Attachment; onOpen: () => void }) {
  const { url, failed } = useObjectUrl(att.thumbPath ?? att.storagePath);
  const w = att.width ?? 320;
  const h = att.height ?? 200;
  const scale = Math.min(1, 360 / w, 260 / h);
  return (
    <button
      type="button"
      className={styles.image}
      style={{ width: Math.round(w * scale), aspectRatio: `${w} / ${h}` }}
      onClick={onOpen}
      aria-label={`Open image ${att.name}`}
      data-testid="attachment-image"
    >
      {url ? <img src={url} alt={att.name} /> : <span className={styles.placeholder}>{failed ? 'Unavailable' : <ImageIcon />}</span>}
    </button>
  );
}

const extLabel = (name: string) => (name.includes('.') ? name.split('.').pop()!.slice(0, 4).toUpperCase() : 'FILE');
const extColor = (ext: string) =>
  ({ PDF: '#B3261E', ZIP: '#7A5C1E', DOC: '#1F5FC4', DOCX: '#1F5FC4', XLS: '#1D7A4E', XLSX: '#1D7A4E', CSV: '#1D7A4E', PPT: '#C2571A', PPTX: '#C2571A' })[ext] ??
  '#59636A';

function FileAttachment({ att }: { att: Attachment }) {
  const [busy, setBusy] = useState(false);
  const ext = extLabel(att.name);
  return (
    <div className={styles.file} data-testid="attachment-file">
      <span className={styles.ext} style={{ background: extColor(ext) }}>
        {ext}
      </span>
      <span className={styles.fileMeta}>
        <strong>{att.name}</strong>
        <span>{formatBytes(att.size)}</span>
      </span>
      <button
        className="icon-btn"
        aria-label={`Download ${att.name}`}
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          await downloadAttachment(att).finally(() => setBusy(false));
        }}
      >
        <DownloadIcon size={17} />
      </button>
    </div>
  );
}

function Lightbox({ att, onClose }: { att: Attachment; onClose: () => void }) {
  const { url } = useObjectUrl(att.storagePath);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className={styles.lightbox} role="dialog" aria-label={att.name} onClick={onClose}>
      <div className={styles.lightboxBar} onClick={(e) => e.stopPropagation()}>
        <span>{att.name}</span>
        <button className="btn" onClick={() => downloadAttachment(att)}>
          <DownloadIcon size={16} /> Download
        </button>
        <button className="btn" onClick={onClose}>
          Close
        </button>
      </div>
      {url ? <img src={url} alt={att.name} onClick={(e) => e.stopPropagation()} /> : <div className="spinner" />}
    </div>
  );
}

export function Attachments({ attachments }: { attachments: Attachment[] }) {
  const [open, setOpen] = useState<Attachment | null>(null);
  return (
    <div className={styles.list}>
      {attachments.map((a) =>
        isImage(a.contentType) ? <ImageAttachment key={a.storagePath} att={a} onOpen={() => setOpen(a)} /> : <FileAttachment key={a.storagePath} att={a} />,
      )}
      {open && <Lightbox att={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
