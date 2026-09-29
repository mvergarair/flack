import { useState } from 'react';
import { useNavigate } from 'react-router';
import { arrayRemove, arrayUnion, doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot } from '../data/workspace';
import { channelTitle, isValidChannelName, normalizeChannelName } from '../lib/channels';
import { friendlyError } from '../lib/errors';
import { openDm } from '../lib/dm';
import { lastOnlineLabel } from '../lib/time';
import { activeStatus } from '../lib/status';
import type { Channel } from '../data/types';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import { PeoplePicker } from './PeoplePicker';
import { NotifyLevelPicker } from './NotifyLevelPicker';
import { openProfile } from './ProfileCard';
import styles from './ChannelSettings.module.css';

type Tab = 'about' | 'members' | 'notifications';

export function ChannelSettings({ channel, onClose, initialTab = 'about' }: { channel: Channel; onClose: () => void; initialTab?: Tab }) {
  const me = useMe();
  const { users, presence } = useWorkspace();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [name, setName] = useState(channel.name);
  const [topic, setTopic] = useState(channel.topic ?? '');
  const [adding, setAdding] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const isDm = channel.type === 'dm';
  const canManage = !isDm && (channel.createdBy === me.id || me.role === 'admin');
  const canAdd = channel.type === 'private' && channel.memberIds.includes(me.id) && !channel.archived;
  const ref = doc(db, 'channels', channel.id);

  const run = async (fn: () => Promise<unknown>, close = false) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      if (close) onClose();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const save = () => {
    const n = normalizeChannelName(name);
    if (!isValidChannelName(n)) return setError('Use lowercase letters, numbers, dashes or underscores.');
    return run(() => updateDoc(ref, { name: n, topic: topic.trim(), archived: channel.archived }), true);
  };

  const members = [...channel.memberIds]
    .map((id) => users.get(id))
    .filter((u) => !!u)
    .sort((a, b) => a!.displayName.localeCompare(b!.displayName));

  return (
    <Modal title={isDm ? channelTitle(channel, me.id, users) : `#${channel.name}`} onClose={onClose} wide>
      <div className={styles.tabs} role="tablist">
        {!isDm && (
          <button role="tab" aria-selected={tab === 'about'} onClick={() => setTab('about')}>
            About
          </button>
        )}
        <button role="tab" aria-selected={tab === 'members' || (isDm && tab === 'about')} onClick={() => setTab('members')}>
          Members ({channel.memberIds.length})
        </button>
        <button role="tab" aria-selected={tab === 'notifications'} onClick={() => setTab('notifications')}>
          Notifications
        </button>
      </div>

      {tab === 'notifications' && <NotifyLevelPicker channel={channel} />}

      {tab === 'about' && !isDm && (
        <div className={styles.section}>
          <label className="field">
            Name
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} disabled={!canManage || busy} maxLength={80} />
          </label>
          <label className="field">
            Topic
            <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} disabled={!canManage || busy} maxLength={250} />
          </label>
          <p className="field-hint">
            {channel.type === 'private' ? 'Private channel' : 'Public channel'} · created by {users.get(channel.createdBy)?.displayName ?? 'unknown'}
          </p>
          <div className={styles.actions}>
            {canManage && (
              <button className="btn btn-primary" onClick={save} disabled={busy}>
                Save changes
              </button>
            )}
            {canManage && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => updateDoc(ref, { name: channel.name, topic: channel.topic ?? '', archived: !channel.archived }), true)}
              >
                {channel.archived ? 'Unarchive channel' : 'Archive channel'}
              </button>
            )}
            {channel.memberIds.includes(me.id) && (
              <button
                className="btn btn-danger"
                disabled={busy}
                onClick={() =>
                  run(async () => {
                    await updateDoc(ref, { memberIds: arrayRemove(me.id) });
                    onClose();
                    navigate('/');
                  })
                }
              >
                Leave channel
              </button>
            )}
          </div>
        </div>
      )}

      {(tab === 'members' || (isDm && tab === 'about')) && (
        <div className={styles.section}>
          {canAdd && adding === null && (
            <button className="btn" onClick={() => setAdding([])}>
              Add people
            </button>
          )}
          {adding !== null && (
            <>
              <PeoplePicker selected={adding} onChange={setAdding} exclude={channel.memberIds} label="Add people" />
              <div className={styles.actions}>
                <button
                  className="btn btn-primary"
                  disabled={busy || adding.length === 0}
                  onClick={() => run(async () => (await updateDoc(ref, { memberIds: arrayUnion(...adding) }), setAdding(null)))}
                >
                  Add {adding.length || ''}
                </button>
                <button className="btn" onClick={() => setAdding(null)}>
                  Cancel
                </button>
              </div>
            </>
          )}
          <ul className={styles.members}>
            {members.map((u) => (
              <li key={u!.id}>
                <Avatar user={u} size={32} online={presenceDot(presence.get(u!.id))} />
                <span className={styles.memberText} role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openProfile(u!.id)} onKeyDown={(e) => e.key === 'Enter' && openProfile(u!.id)}>
                  <strong>
                    {u!.displayName}
                    {u!.id === me.id ? ' (you)' : ''}
                  </strong>
                  <span>
                    {u!.status === 'deactivated'
                      ? 'Deactivated'
                      : [
                          (() => {
                            const st = activeStatus(u);
                            return st ? `${st.emoji} ${st.text}`.trim() : '';
                          })(),
                          u!.title || u!.email,
                          u!.id === me.id ? '' : lastOnlineLabel(presence.get(u!.id)),
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                  </span>
                </span>
                {u!.id !== me.id && u!.status === 'active' && (
                  <button className="btn btn-ghost" onClick={() => run(async () => (onClose(), navigate(`/c/${await openDm(me.id, [u!.id])}`)))}>
                    Message
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
