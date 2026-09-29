import { useState, type FormEvent } from 'react';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { friendlyError } from '../lib/errors';
import { Modal } from './Modal';
import { EmojiPicker } from './EmojiPicker';
import { DEFAULT_QUICK_REACTIONS } from '../lib/reactions';

export function ProfileDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const [name, setName] = useState(me.displayName);
  const [title, setTitle] = useState(me.title ?? '');
  const [quick, setQuick] = useState<string[]>(me.quickReactions?.length === 3 ? me.quickReactions : DEFAULT_QUICK_REACTIONS);
  const [picking, setPicking] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await updateDoc(doc(db, 'users', me.id), { displayName: name.trim(), title: title.trim(), quickReactions: quick });
      onClose();
    } catch (err) {
      setError(friendlyError(err));
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Edit profile"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="profile-form" disabled={busy || !name.trim()}>
            Save
          </button>
        </>
      }
    >
      <form id="profile-form" onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
        <label className="field">
          Display name
          <input className="input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Title
          <input className="input" value={title} maxLength={120} placeholder="e.g. Backend engineer" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <fieldset style={{ border: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <legend style={{ fontSize: 14, fontWeight: 500, padding: 0, marginBottom: 6 }}>Quick reactions</legend>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }} data-testid="quick-reactions">
            {quick.map((e, i) => (
              <span key={i} style={{ position: 'relative' }}>
                <button
                  type="button"
                  className="btn"
                  style={{ width: 48, height: 44, fontSize: 22, padding: 0 }}
                  aria-label={`Quick reaction ${i + 1}: ${e}. Change`}
                  onClick={() => setPicking(picking === i ? null : i)}
                >
                  {e}
                </button>
                {picking === i && (
                  <EmojiPicker
                    align="left"
                    onPick={(emoji) => setQuick((q) => q.map((x, j) => (j === i ? emoji : x)))}
                    onClose={() => setPicking(null)}
                  />
                )}
              </span>
            ))}
            <button type="button" className="btn btn-ghost" onClick={() => setQuick(DEFAULT_QUICK_REACTIONS)}>
              Reset
            </button>
          </div>
          <span className="field-hint">Shown when you hover a message, for one-click reactions.</span>
        </fieldset>
        <p className="field-hint" style={{ margin: 0 }}>
          Signed in as {me.email}
        </p>
        {error && <p className="error-text">{error}</p>}
      </form>
    </Modal>
  );
}
