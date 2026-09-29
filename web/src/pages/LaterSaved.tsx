import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { removeSaved } from '../data/saved';
import { channelTitle } from '../lib/channels';
import { plainPreview } from '../lib/markdown';
import { formatShortTime } from '../lib/time';
import type { Message } from '../data/types';
import { Avatar } from '../components/Avatar';
import { EmptyState } from '../components/EmptyState';
import styles from './ActivityPage.module.css';

/** Saved-for-later messages, newest save first (Later → Saved). Messages are fetched once per visit. */
export function SavedList() {
  const me = useMe();
  const { saved, users, channelsById } = useWorkspace();
  const items = useMemo(() => [...saved.values()].sort((a, b) => (b.savedAt?.toMillis() ?? 0) - (a.savedAt?.toMillis() ?? 0)), [saved]);
  const [messages, setMessages] = useState<Map<string, Message | null>>(new Map());

  useEffect(() => {
    const missing = items.filter((i) => !messages.has(i.id));
    if (!missing.length) return;
    let alive = true;
    Promise.all(
      missing.map(async (i) => {
        const snap = await getDoc(doc(db, 'channels', i.channelId, 'messages', i.messageId)).catch(() => null);
        return [i.id, snap?.exists() ? ({ id: snap.id, ...snap.data() } as Message) : null] as const;
      }),
    ).then((pairs) => alive && setMessages((m) => new Map([...m, ...pairs])));
    return () => {
      alive = false;
    };
  }, [items, messages]);

  return (
    <>
        {items.length === 0 && <EmptyState title="Nothing saved yet" body="Use ⋯ → Save for later on any message to keep it here." />}
        <ul className={styles.list} data-testid="saved-list">
          {items.map((i) => {
            const m = messages.get(i.id);
            const ch = channelsById.get(i.channelId);
            const where = ch ? (ch.type === 'dm' ? channelTitle(ch, me.id, users) : `#${ch.name}`) : 'a channel you left';
            const href = i.threadParentId ? `/c/${i.channelId}/t/${i.threadParentId}` : `/c/${i.channelId}?m=${i.messageId}`;
            return (
              <li key={i.id}>
                <Link to={href} className={styles.item}>
                  <Avatar user={m ? users.get(m.authorId) : undefined} size={36} />
                  <span className={styles.text}>
                    <span className={styles.line}>
                      <strong>{m ? (users.get(m.authorId)?.displayName ?? 'Unknown') : m === null ? 'Deleted message' : '…'}</strong> in <strong>{where}</strong>
                    </span>
                    <span className={styles.preview}>{m ? plainPreview(m.text, users, 200) || (m.attachments?.length ? '📎 attachment' : '') : ''}</span>
                  </span>
                  <span className={styles.when}>{m ? formatShortTime(m.createdAt) : ''}</span>
                </Link>
                <button className="btn btn-ghost" onClick={() => removeSaved(me.id, i.id)} aria-label="Remove from saved">
                  Remove
                </button>
              </li>
            );
          })}
        </ul>
    </>
  );
}
