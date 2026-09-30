import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { useMe } from '../auth/AuthProvider';
import { presenceDot, useWorkspace } from '../data/workspace';
import { openDm } from '../lib/dm';
import { openFlackbot } from '../data/bot';
import { activeStatus, untilLabel } from '../lib/status';
import { isDndActive } from '../lib/dnd';
import { lastOnlineLabel } from '../lib/time';
import { useNow } from '../lib/hooks';
import { Modal } from './Modal';
import { Avatar } from './Avatar';
import styles from './ProfileCard.module.css';

export const OPEN_PROFILE_EVENT = 'flack:open-profile';

/** Opens the profile card for a user from anywhere (names, avatars, @mentions). */
export function openProfile(uid: string) {
  window.dispatchEvent(new CustomEvent(OPEN_PROFILE_EVENT, { detail: { uid } }));
}

function localTime(timeZone: string | undefined, now: number): string | null {
  if (!timeZone) return null;
  try {
    return new Date(now).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', timeZone });
  } catch {
    return null;
  }
}

/** Mounted once in the shell; shows whichever profile was last requested. */
export function ProfileCardHost() {
  const [uid, setUid] = useState<string | null>(null);
  useEffect(() => {
    const on = (e: Event) => setUid((e as CustomEvent<{ uid: string }>).detail.uid);
    window.addEventListener(OPEN_PROFILE_EVENT, on);
    return () => window.removeEventListener(OPEN_PROFILE_EVENT, on);
  }, []);
  return uid ? <ProfileCard uid={uid} onClose={() => setUid(null)} /> : null;
}

function ProfileCard({ uid, onClose }: { uid: string; onClose: () => void }) {
  const me = useMe();
  const { users, presence } = useWorkspace();
  const navigate = useNavigate();
  const now = useNow(30_000);
  const user = users.get(uid);
  if (!user) return null;

  const isMe = uid === me.id;
  const status = activeStatus(user, now);
  const dnd = isDndActive(user.dnd, user.timeZone, now);
  const time = localTime(user.timeZone, now);
  const differentZone = user.timeZone && user.timeZone !== me.timeZone;
  const seen = lastOnlineLabel(presence.get(uid), now);

  return (
    <Modal title={user.displayName} onClose={onClose}>
      <div className={styles.card} data-testid="profile-card">
        <Avatar user={user} size={72} online={user.status === 'deactivated' ? null : presenceDot(presence.get(uid))} />
        <div className={styles.info}>
          <strong className={styles.name}>
            {user.displayName}
            {isMe && ' (you)'}
          </strong>
          {user.title && <span className={styles.title}>{user.title}</span>}
          {user.status === 'deactivated' && <span className="pill pill-danger">Deactivated</span>}
          {user.role === 'admin' && <span className="pill pill-accent">Admin</span>}
        </div>
      </div>
      <dl className={styles.facts}>
        {status && (
          <div>
            <dt>Status</dt>
            <dd data-testid="profile-status">
              {status.emoji} {status.text}
              {status.expiresAt && <span className={styles.muted}> · {untilLabel(status.expiresAt.toMillis(), now)}</span>}
            </dd>
          </div>
        )}
        {user.status === 'active' && seen && (
          <div>
            <dt>Presence</dt>
            <dd data-testid="profile-presence">{seen}</dd>
          </div>
        )}
        {dnd && (
          <div>
            <dt>Notifications</dt>
            <dd data-testid="profile-dnd">🌙 Paused (Do Not Disturb)</dd>
          </div>
        )}
        {time && (
          <div>
            <dt>Local time</dt>
            <dd data-testid="profile-time">
              {time}
              {differentZone && <span className={styles.muted}> · {user.timeZone!.replace(/_/g, ' ')}</span>}
            </dd>
          </div>
        )}
        {user.email && (
          <div>
            <dt>Email</dt>
            <dd>
              <a href={`mailto:${user.email}`}>{user.email}</a>
            </dd>
          </div>
        )}
      </dl>
      {user.bot && (
        <button
          className="btn btn-primary btn-lg"
          onClick={async () => {
            onClose();
            navigate(`/c/${await openFlackbot()}`);
          }}
        >
          Open Flackbot
        </button>
      )}
      {!isMe && user.status === 'active' && (
        <button
          className="btn btn-primary btn-lg"
          onClick={async () => {
            onClose();
            navigate(`/c/${await openDm(me.id, [uid])}`);
          }}
        >
          Message
        </button>
      )}
    </Modal>
  );
}
