import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useWorkspace } from '../data/workspace';
import { unpinMessage } from '../data/pins';
import { plainPreview } from '../lib/markdown';
import { formatShortTime } from '../lib/time';
import type { Channel, Message } from '../data/types';
import { Avatar } from './Avatar';
import styles from './PinnedBar.module.css';

/**
 * "📌 N pinned" strip under the channel header. Pinned messages are fetched only when the
 * list is opened (one read per pin), never kept live.
 */
export function PinnedBar({ channel }: { channel: Channel }) {
  const { users } = useWorkspace();
  const navigate = useNavigate();
  const ids = channel.pinnedIds ?? [];
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Message[] | null>(null);

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setItems(null);
    Promise.all(
      [...ids].reverse().map(async (id) => {
        const snap = await getDoc(doc(db, 'channels', channel.id, 'messages', id)).catch(() => null);
        return snap?.exists() ? ({ id: snap.id, ...snap.data() } as Message) : null;
      }),
    ).then((list) => alive && setItems(list.filter((m): m is Message => !!m && !m.deleted)));
    return () => {
      alive = false;
    };
    // Refetch when the set of pins changes while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, channel.id, ids.join(',')]);

  if (ids.length === 0) return null;

  const jump = (m: Message) => {
    setOpen(false);
    navigate(m.threadParentId ? `/c/${channel.id}/t/${m.threadParentId}` : `/c/${channel.id}?m=${m.id}`);
  };

  return (
    <div className={styles.wrap}>
      <button className={styles.bar} onClick={() => setOpen((v) => !v)} aria-expanded={open} data-testid="pinned-bar">
        📌 {ids.length} pinned {ids.length === 1 ? 'message' : 'messages'}
        <span className={styles.chev}>{open ? '▴' : '▾'}</span>
      </button>
      {open && (
        <>
          <div className={styles.scrim} onClick={() => setOpen(false)} />
          <div className={styles.panel} role="dialog" aria-label="Pinned messages" data-testid="pinned-panel">
            {items === null && <div className="spinner" />}
            {items?.length === 0 && <p className={styles.empty}>Pinned messages were deleted.</p>}
            <ul className={styles.list}>
              {items?.map((m) => (
                <li key={m.id}>
                  <Avatar user={users.get(m.authorId)} size={28} />
                  <button className={styles.item} onClick={() => jump(m)}>
                    <span className={styles.meta}>
                      <strong>{users.get(m.authorId)?.displayName ?? 'Unknown'}</strong> · {formatShortTime(m.createdAt)}
                    </span>
                    <span className={styles.preview}>{plainPreview(m.text, users, 160) || (m.attachments?.length ? '📎 attachment' : '')}</span>
                  </button>
                  {!channel.archived && (
                    <button className="btn btn-ghost" onClick={() => unpinMessage(channel.id, m.id)} aria-label={`Unpin message from ${users.get(m.authorId)?.displayName}`}>
                      Unpin
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  );
}
