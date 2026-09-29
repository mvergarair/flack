import { useState, type FormEvent } from 'react';
import { adminApi, inviteUrl } from '../data/admin';
import { friendlyError } from '../lib/errors';
import type { Role } from '../data/types';
import { Modal } from './Modal';
import { CopyButton } from './CopyButton';
import styles from './InviteDialog.module.css';

type Result = { email: string; url?: string; error?: string; refreshed?: boolean };

export function InviteDialog({ onClose }: { onClose: () => void }) {
  const [emails, setEmails] = useState('');
  const [role, setRole] = useState<Role>('member');
  const [busy, setBusy] = useState(false);
  const [results, setResults] = useState<Result[] | null>(null);

  const list = emails
    .split(/[\s,;]+/)
    .map((e) => e.trim())
    .filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const out: Result[] = [];
    for (const email of list) {
      try {
        const r = await adminApi.createInvite({ email, role });
        out.push({ email, url: inviteUrl(r.token), refreshed: r.refreshed });
      } catch (err) {
        out.push({ email, error: friendlyError(err) });
      }
    }
    setResults(out);
    setBusy(false);
  };

  if (results) {
    return (
      <Modal
        title="Share the invite links"
        onClose={onClose}
        wide
        footer={
          <button className="btn btn-primary" onClick={onClose}>
            Done
          </button>
        }
      >
        <p className="field-hint" style={{ margin: 0 }}>
          Send each person their link (Slack, email, WhatsApp…). Links expire in 7 days and only work for that email&apos;s Google account.
        </p>
        <ul className={styles.results} data-testid="invite-results">
          {results.map((r) => (
            <li key={r.email}>
              <div className={styles.email}>
                <strong>{r.email}</strong>
                {r.error ? <span className="error-text">{r.error}</span> : <code className={styles.url}>{r.url}</code>}
                {r.refreshed && <span className="field-hint">Existing invite refreshed</span>}
              </div>
              {r.url && <CopyButton text={r.url} label="Copy link" />}
            </li>
          ))}
        </ul>
      </Modal>
    );
  }

  return (
    <Modal
      title="Invite people"
      onClose={onClose}
      footer={
        <>
          <button className="btn" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" form="invite-form" disabled={busy || list.length === 0}>
            {busy ? 'Creating…' : list.length > 1 ? `Create ${list.length} invites` : 'Create invite'}
          </button>
        </>
      }
    >
      <form id="invite-form" onSubmit={submit} className={styles.form}>
        <label className="field">
          Email addresses
          <textarea
            className={`input ${styles.textarea}`}
            value={emails}
            onChange={(e) => setEmails(e.target.value)}
            placeholder="name@company.com, another@gmail.com"
            rows={3}
            autoFocus
          />
          <span className="field-hint">Separate several with commas or new lines. They must sign in with Google using this email.</span>
        </label>
        <label className="field">
          Role
          <select className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <span className="field-hint">Admins can invite and remove people, change roles and manage any channel.</span>
        </label>
      </form>
    </Modal>
  );
}
