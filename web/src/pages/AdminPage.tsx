import { useEffect, useMemo, useState } from 'react';
import { collection, onSnapshot, orderBy, query, where } from 'firebase/firestore';
import { db } from '../firebase';
import { useMe } from '../auth/AuthProvider';
import { useWorkspace, presenceDot } from '../data/workspace';
import { adminApi, inviteUrl } from '../data/admin';
import { FLACK_VERSION, useUpdateAvailable } from '../data/updates';
import { friendlyError } from '../lib/errors';
import { formatRelative, formatShortTime, lastOnlineLabel } from '../lib/time';
import { useIsMobile } from '../lib/hooks';
import type { Invite, Role, UserProfile } from '../data/types';
import { Avatar } from '../components/Avatar';
import { StatusEmoji } from '../components/StatusEmoji';
import { openProfile } from '../components/ProfileCard';
import { InviteDialog } from '../components/InviteDialog';
import { CopyButton } from '../components/CopyButton';
import { Modal } from '../components/Modal';
import { MobileHeader } from './MobileHome';
import { PlusIcon } from '../components/icons';
import styles from './AdminPage.module.css';

type Confirm = { kind: 'deactivate' | 'reactivate'; user: UserProfile } | { kind: 'revoke'; invite: Invite } | null;

export function AdminPage() {
  const me = useMe();
  const mobile = useIsMobile();
  const { users, presence } = useWorkspace();
  const [invites, setInvites] = useState<Invite[]>([]);
  const [inviting, setInviting] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    document.title = 'People & invites · Flack';
    return onSnapshot(
      query(collection(db, 'invites'), where('status', '==', 'pending'), orderBy('createdAt', 'desc')),
      (snap) => setInvites(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as Invite)),
      (err) => setError(friendlyError(err)),
    );
  }, []);

  const people = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return [...users.values()]
      .filter((u) => !term || u.displayName.toLowerCase().includes(term) || u.email.toLowerCase().includes(term))
      .sort((a, b) => (a.status === b.status ? a.displayName.localeCompare(b.displayName) : a.status === 'active' ? -1 : 1));
  }, [users, filter]);
  const activeAdmins = [...users.values()].filter((u) => u.role === 'admin' && u.status === 'active').length;

  const run = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(null);
    }
  };

  const update = useUpdateAvailable(true);

  const changeRole = (u: UserProfile, role: Role) => run(`role:${u.id}`, () => adminApi.setRole({ uid: u.id, role }));

  return (
    <div className={styles.page}>
      {mobile && <MobileHeader title="Admin" />}
      <div className={styles.scroll}>
        <div className={styles.inner}>
          <header className={styles.header}>
            <div>
              <h1 className={styles.title}>People &amp; invites</h1>
              <p className={styles.sub}>
                {[...users.values()].filter((u) => u.status === 'active').length} active · {invites.length} pending invite{invites.length === 1 ? '' : 's'}
              </p>
            </div>
            <button className="btn btn-primary" onClick={() => setInviting(true)}>
              <PlusIcon size={16} /> Invite people
            </button>
          </header>
          {update && (
            <div className={styles.update} role="status" data-testid="update-banner">
              <strong>Flack {update.version} is available</strong> (you're on {FLACK_VERSION}).{' '}
              <a href={update.url} target="_blank" rel="noreferrer">
                What's new
              </a>
              . To update, run <code>npm run update</code> in your Flack folder.
            </div>
          )}

          {error && (
            <p role="alert" className={styles.alert}>
              {error}
            </p>
          )}

          <section aria-labelledby="invites-h" className={styles.section}>
            <h2 id="invites-h" className={styles.h2}>
              Pending invites
            </h2>
            {invites.length === 0 ? (
              <p className={styles.empty}>No pending invites.</p>
            ) : (
              <ul className={styles.table} data-testid="invite-list">
                {invites.map((inv) => {
                  const expired = inv.expiresAt.toMillis() < Date.now();
                  return (
                    <li key={inv.id} className={styles.row} data-testid={`invite-${inv.email}`}>
                      <div className={styles.cellMain}>
                        <strong>{inv.email}</strong>
                        <span>
                          Invited by {inv.invitedByName} {formatRelative(inv.createdAt)} ·{' '}
                          {expired ? 'expired' : `expires ${formatShortTime(inv.expiresAt)}`}
                        </span>
                      </div>
                      <span className={`pill ${inv.role === 'admin' ? 'pill-accent' : ''}`}>{inv.role === 'admin' ? 'Admin' : 'Member'}</span>
                      {expired && <span className="pill pill-danger">Expired</span>}
                      <div className={styles.actions}>
                        <CopyButton text={inviteUrl(inv.token)} label="Copy link" />
                        <button className="btn btn-ghost btn-danger" disabled={busy !== null} onClick={() => setConfirm({ kind: 'revoke', invite: inv })}>
                          Revoke
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          <section aria-labelledby="people-h" className={styles.section}>
            <div className={styles.sectionHead}>
              <h2 id="people-h" className={styles.h2}>
                People
              </h2>
              <input className={`input ${styles.search}`} placeholder="Filter people" value={filter} onChange={(e) => setFilter(e.target.value)} aria-label="Filter people" />
            </div>
            <ul className={styles.table} data-testid="people-list">
              {people.map((u) => {
                const self = u.id === me.id;
                const lastAdmin = u.role === 'admin' && u.status === 'active' && activeAdmins <= 1;
                const deactivated = u.status === 'deactivated';
                return (
                  <li key={u.id} className={`${styles.row} ${deactivated ? styles.dim : ''}`} data-testid={`person-${u.email}`}>
                    <Avatar user={u} size={36} online={deactivated ? null : presenceDot(presence.get(u.id))} />
                    <div className={styles.cellMain}>
                      <strong role="button" tabIndex={0} style={{ cursor: 'pointer' }} onClick={() => openProfile(u.id)} onKeyDown={(e) => e.key === 'Enter' && openProfile(u.id)}>
                        {u.displayName}
                        {self && ' (you)'} <StatusEmoji user={u} withText />
                      </strong>
                      <span>
                        {u.email}
                        {u.createdAt ? ` · joined ${formatShortTime(u.createdAt)}` : ''}
                        {!deactivated && presence.get(u.id) ? ` · ${lastOnlineLabel(presence.get(u.id))}` : ''}
                      </span>
                    </div>
                    {deactivated && <span className="pill pill-danger">Deactivated</span>}
                    <label className={styles.roleLabel}>
                      <span className="sr-only">Role for {u.displayName}</span>
                      <select
                        className={styles.select}
                        value={u.role}
                        disabled={busy !== null || deactivated || (lastAdmin && u.role === 'admin')}
                        title={lastAdmin ? 'There must always be at least one admin' : undefined}
                        onChange={(e) => changeRole(u, e.target.value as Role)}
                      >
                        <option value="member">Member</option>
                        <option value="admin">Admin</option>
                      </select>
                    </label>
                    <div className={styles.actions}>
                      {deactivated ? (
                        <button className="btn" disabled={busy !== null} onClick={() => setConfirm({ kind: 'reactivate', user: u })}>
                          Reactivate
                        </button>
                      ) : (
                        <button
                          className="btn btn-ghost btn-danger"
                          disabled={busy !== null || self || lastAdmin}
                          title={self ? "You can't deactivate yourself" : undefined}
                          onClick={() => setConfirm({ kind: 'deactivate', user: u })}
                        >
                          Deactivate
                        </button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <p className={styles.version} data-testid="flack-version">
            Flack {FLACK_VERSION}
          </p>
        </div>
      </div>

      {inviting && <InviteDialog onClose={() => setInviting(false)} />}
      {confirm && (
        <Modal
          title={confirm.kind === 'revoke' ? 'Revoke invite?' : confirm.kind === 'deactivate' ? `Deactivate ${confirm.user.displayName}?` : `Reactivate ${confirm.user.displayName}?`}
          onClose={() => setConfirm(null)}
          footer={
            <>
              <button className="btn" onClick={() => setConfirm(null)}>
                Cancel
              </button>
              <button
                className={`btn ${confirm.kind === 'reactivate' ? 'btn-primary' : 'btn-primary'}`}
                disabled={busy !== null}
                onClick={() => {
                  const c = confirm;
                  setConfirm(null);
                  if (c.kind === 'revoke') void run(`revoke:${c.invite.id}`, () => adminApi.revokeInvite({ inviteId: c.invite.id }));
                  else if (c.kind === 'deactivate') void run(`deact:${c.user.id}`, () => adminApi.deactivateUser({ uid: c.user.id }));
                  else void run(`react:${c.user.id}`, () => adminApi.reactivateUser({ uid: c.user.id }));
                }}
              >
                {confirm.kind === 'revoke' ? 'Revoke invite' : confirm.kind === 'deactivate' ? 'Deactivate' : 'Reactivate'}
              </button>
            </>
          }
        >
          <p style={{ margin: 0, lineHeight: 1.5 }}>
            {confirm.kind === 'revoke'
              ? `The invite link for ${confirm.invite.email} will stop working.`
              : confirm.kind === 'deactivate'
                ? 'They will be signed out everywhere and lose access to all channels and files. Their past messages stay visible.'
                : 'They will be able to sign in again and regain access to their channels.'}
          </p>
        </Modal>
      )}
    </div>
  );
}
