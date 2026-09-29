import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { useWorkspace } from '../data/workspace';
import { sortByRecent } from '../lib/channels';
import { ChannelDialogs, type ChannelDialog } from '../components/ChannelDialogs';
import { ComposeIcon } from '../components/icons';
import { DmRows, MobileHeader } from './MobileHome';
import styles from './MobileHome.module.css';

/** Phone "DMs" tab (desktop shows DMs in the sidebar). */
export function DmsPage() {
  const { channels } = useWorkspace();
  const navigate = useNavigate();
  const [dialog, setDialog] = useState<ChannelDialog>(null);
  const dms = useMemo(() => sortByRecent(channels.filter((c) => c.type === 'dm')), [channels]);
  return (
    <div className={styles.page}>
      <MobileHeader title="Direct messages" />
      <div className={styles.scroll}>
        <DmRows channels={dms} />
      </div>
      <button className={styles.fab} aria-label="New message" onClick={() => setDialog({ kind: 'dm' })}>
        <ComposeIcon size={22} />
      </button>
      <ChannelDialogs dialog={dialog} onClose={() => setDialog(null)} onDone={(id) => navigate(`/c/${id}`)} />
    </div>
  );
}
