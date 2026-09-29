import { useEffect, useState } from 'react';
import { Link, Navigate, useParams } from 'react-router';
import { httpsCallable } from 'firebase/functions';
import { functions, USE_EMULATORS } from '../firebase';
import { useAuth } from '../auth/AuthProvider';
import { signInWithGoogle } from '../auth/signin';
import { friendlyAuthError } from '../lib/errors';
import { EmulatorLogin } from './EmulatorLogin';
import { GoogleIcon } from '../components/icons';
import { BrandLogo } from '../components/BrandLogo';
import { useBranding, usePageTitle } from '../data/branding';
import styles from './Login.module.css';

type Lookup =
  | { status: 'invalid' }
  | {
      status: 'pending' | 'accepted' | 'revoked' | 'expired';
      email: string;
      role: 'admin' | 'member';
      invitedByName: string;
      expiresAt: number;
    };

const lookupInvite = httpsCallable<{ token: string }, Lookup>(functions, 'lookupinvite');

export function InviteLandingPage() {
  const { name } = useBranding();
  usePageTitle('Invitation');
  const { token = '' } = useParams();
  const { user, profile } = useAuth();
  const [invite, setInvite] = useState<Lookup | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    lookupInvite({ token })
      .then((r) => setInvite(r.data))
      .catch(() => setInvite({ status: 'invalid' }));
  }, [token]);

  if (user && profile) return <Navigate to="/" replace />;

  let body: React.ReactNode;
  if (!invite) {
    body = <div className="spinner" aria-label="Loading invite" />;
  } else if (invite.status === 'pending') {
    body = (
      <>
        <p className={styles.inviteBox} data-testid="invite-summary">
          <strong>{invite.invitedByName}</strong> invited <strong>{invite.email}</strong> to join {name}
          {invite.role === 'admin' ? ' as an admin' : ''}.
        </p>
        <button
          className="btn btn-lg btn-primary"
          onClick={() => signInWithGoogle(invite.email).catch((e) => setError(friendlyAuthError(e)))}
        >
          <GoogleIcon /> Join with Google
        </button>
        {USE_EMULATORS && <EmulatorLogin onError={setError} defaultEmail={invite.email} />}
        <p className={styles.fine}>Sign in with the Google account for {invite.email}. The invite expires {new Date(invite.expiresAt).toLocaleDateString()}.</p>
      </>
    );
  } else {
    const msg: Record<string, string> = {
      invalid: "This invite link isn't valid. Check that you copied the whole link.",
      expired: 'This invite has expired. Ask an admin to send a new one.',
      revoked: 'This invite was revoked. Ask an admin if you think this is a mistake.',
      accepted: 'This invite was already used. Sign in instead.',
    };
    body = (
      <>
        <p className={styles.alert} role="alert" data-testid="invite-error">
          {msg[invite.status]}
        </p>
        <Link className="btn btn-lg" to="/login">
          Go to sign in
        </Link>
      </>
    );
  }

  return (
    <div className="center-page">
      <main className="card">
        <div className={styles.brand}>
          <BrandLogo size={40} />
          <div>
            <h1 className={styles.title}>You're invited</h1>
            <p className={styles.sub}>{name}</p>
          </div>
        </div>
        {error && (
          <p role="alert" className={styles.alert}>
            {error}
          </p>
        )}
        {body}
      </main>
    </div>
  );
}
