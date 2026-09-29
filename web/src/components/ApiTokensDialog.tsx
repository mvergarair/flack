import { useState, type FormEvent } from 'react';
import { useMe } from '../auth/AuthProvider';
import { API_DOCS_URL, apiBaseUrl, createApiToken, revokeApiToken, useApiTokens, type ApiScope } from '../data/apiTokens';
import { friendlyError } from '../lib/errors';
import { formatRelative } from '../lib/time';
import { Modal } from './Modal';
import { CopyButton } from './CopyButton';
import styles from './ApiTokensDialog.module.css';

/** Personal API tokens: create (shown once), list with last use, revoke. */
export function ApiTokensDialog({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const tokens = useApiTokens(me.id);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<'read' | 'write'>('write');
  const [created, setCreated] = useState<{ token: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const scopes: ApiScope[] = scope === 'write' ? ['read', 'write'] : ['read'];
      const r = await createApiToken(name.trim(), scopes);
      setCreated({ token: r.token, name: name.trim() });
      setName('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    setError(null);
    try {
      await revokeApiToken(id);
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const example = created ? `curl -H "Authorization: Bearer ${created.token}" ${apiBaseUrl()}/me` : '';

  return (
    <Modal title="API tokens" onClose={onClose} wide>
      <p className={styles.intro}>
        Tokens let scripts and integrations use Flack as you: read your channels and messages, and (with write access) post
        messages. They see only what you can see. <a href={API_DOCS_URL} target="_blank" rel="noreferrer">API docs</a>
      </p>

      {created && (
        <div className={styles.created} role="status" data-testid="new-token">
          <strong>Copy “{created.name}” now. You won't see it again.</strong>
          <div className={styles.tokenRow}>
            <code data-testid="token-value">{created.token}</code>
            <CopyButton text={created.token} label="Copy token" />
          </div>
          <p className={styles.hint}>Try it:</p>
          <div className={styles.tokenRow}>
            <code className={styles.example}>{example}</code>
            <CopyButton text={example} label="Copy example" />
          </div>
        </div>
      )}

      <form className={styles.form} onSubmit={create}>
        <label className="field">
          Name
          <input className="input" value={name} maxLength={60} placeholder="e.g. GitHub deploys" onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="field">
          Access
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as 'read' | 'write')}>
            <option value="write">Read and post messages</option>
            <option value="read">Read only</option>
          </select>
        </label>
        <button className="btn btn-primary" disabled={busy || !name.trim()}>
          Create token
        </button>
      </form>

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <ul className={styles.list} data-testid="token-list">
        {tokens?.length === 0 && <li className={styles.empty}>No tokens yet.</li>}
        {tokens?.map((t) => (
          <li key={t.id}>
            <span className={styles.meta}>
              <strong>{t.name}</strong>
              <span>
                <code>{t.prefix}…</code> · {t.scopes.includes('write') ? 'read and post' : 'read only'} · created {formatRelative(t.createdAt)} ·{' '}
                {t.lastUsedAt ? `last used ${formatRelative(t.lastUsedAt)}` : 'never used'}
              </span>
            </span>
            <button className="btn btn-ghost" onClick={() => revoke(t.id)} aria-label={`Revoke ${t.name}`}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
