import { useEffect, useState, type FormEvent } from 'react';
import { newTypingKey } from '../data/typing';
import { addDoc, arrayUnion, collection, doc, getDocs, orderBy, query, serverTimestamp, updateDoc, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace } from '../data/workspace';
import { isValidChannelName, normalizeChannelName } from '../lib/channels';
import { openDm } from '../lib/dm';
import { friendlyError } from '../lib/errors';
import type { Channel } from '../data/types';
import { Modal } from './Modal';
import { PeoplePicker } from './PeoplePicker';
import { HashIcon, LockIcon } from './icons';
import styles from './ChannelDialogs.module.css';

export type ChannelDialog = { kind: 'create' } | { kind: 'browse' } | { kind: 'dm' } | null;

export function ChannelDialogs({ dialog, onClose, onDone }: { dialog: ChannelDialog; onClose: () => void; onDone: (channelId: string) => void }) {
  if (!dialog) return null;
  const done = (id: string) => {
    onClose();
    onDone(id);
  };
  if (dialog.kind === 'create') return <CreateChannel onClose={onClose} onDone={done} />;
  if (dialog.kind === 'browse') return <BrowseChannels onClose={onClose} onDone={done} />;
  return <NewMessage onClose={onClose} onDone={done} />;
}

function CreateChannel({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const me = useMe();
  const { channels } = useWorkspace();
  const [raw, setRaw] = useState('');
  const [topic, setTopic] = useState('');
  const [isPrivate, setPrivate] = useState(false);
  const [members, setMembers] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const name = normalizeChannelName(raw);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!isValidChannelName(name)) return setError('Use lowercase letters, numbers, dashes or underscores.');
    if (channels.some((c) => c.type !== 'dm' && c.name === name)) return setError(`You already have a channel named #${name}.`);
    setBusy(true);
    try {
      const ref = await addDoc(collection(db, 'channels'), {
        name,
        type: isPrivate ? 'private' : 'public',
        memberIds: isPrivate ? [me.id, ...members.filter((m) => m !== me.id)] : [me.id],
        createdBy: me.id,
        archived: false,
        topic: topic.trim(),
        typingKey: newTypingKey(),
        createdAt: serverTimestamp(),
      });
      onDone(ref.id);
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Create a channel"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="create-channel" disabled={busy || !name}>
            Create
          </button>
        </>
      }
    >
      <form id="create-channel" onSubmit={submit} className={styles.form}>
        <label className="field">
          Name
          <div className={styles.nameInput}>
            <span>#</span>
            <input className="input" value={raw} onChange={(e) => setRaw(e.target.value)} placeholder="e.g. marketing" autoFocus maxLength={80} />
          </div>
          {raw && name !== raw && <span className="field-hint">Will be created as #{name}</span>}
        </label>
        <label className="field">
          Topic <span className="field-hint">Optional</span>
          <input className="input" value={topic} onChange={(e) => setTopic(e.target.value)} maxLength={250} placeholder="What's it about?" />
        </label>
        <label className={styles.toggle}>
          <input type="checkbox" checked={isPrivate} onChange={(e) => setPrivate(e.target.checked)} />
          <span>
            <strong>Make private</strong>
            <span className="field-hint">Only invited members can see and join it.</span>
          </span>
        </label>
        {isPrivate && <PeoplePicker selected={members} onChange={setMembers} exclude={[me.id]} label="Add members" />}
        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}

function BrowseChannels({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const me = useMe();
  const [list, setList] = useState<Channel[] | null>(null);
  const [q, setQ] = useState('');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getDocs(query(collection(db, 'channels'), where('type', '==', 'public'), orderBy('name')))
      .then((snap) => setList(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Channel).filter((c) => !c.archived)))
      .catch((err) => setError(friendlyError(err)));
  }, []);

  const join = async (c: Channel) => {
    try {
      if (!c.memberIds.includes(me.id)) await updateDoc(doc(db, 'channels', c.id), { memberIds: arrayUnion(me.id) });
      onDone(c.id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const shown = (list ?? []).filter((c) => !q || c.name.includes(q.toLowerCase()) || c.topic?.toLowerCase().includes(q.toLowerCase()));
  return (
    <Modal title="Browse channels" onClose={onClose} wide>
      <input className="input" placeholder="Search channels" value={q} onChange={(e) => setQ(e.target.value)} autoFocus aria-label="Search channels" />
      {error && <p className="error-text">{error}</p>}
      {!list && !error && <div className="spinner" />}
      <ul className={styles.browse}>
        {shown.map((c) => {
          const joined = c.memberIds.includes(me.id);
          return (
            <li key={c.id}>
              <span className={styles.browseIcon}>{c.type === 'private' ? <LockIcon /> : <HashIcon />}</span>
              <span className={styles.browseText}>
                <strong>{c.name}</strong>
                <span>
                  {c.memberIds.length} {c.memberIds.length === 1 ? 'member' : 'members'}
                  {c.topic ? ` · ${c.topic}` : ''}
                </span>
              </span>
              <button className={`btn ${joined ? '' : 'btn-primary'}`} onClick={() => join(c)}>
                {joined ? 'Open' : 'Join'}
              </button>
            </li>
          );
        })}
        {list && shown.length === 0 && <li className={styles.empty}>No channels found.</li>}
      </ul>
    </Modal>
  );
}

function NewMessage({ onClose, onDone }: { onClose: () => void; onDone: (id: string) => void }) {
  const me = useMe();
  const [people, setPeople] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const go = async () => {
    setBusy(true);
    try {
      onDone(await openDm(me.id, people));
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };
  return (
    <Modal
      title="New message"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={go} disabled={busy || people.length === 0}>
            {people.length > 1 ? 'Start group message' : 'Start message'}
          </button>
        </>
      }
    >
      <PeoplePicker selected={people} onChange={setPeople} exclude={[me.id]} max={8} label="To" />
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
