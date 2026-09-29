import { useState } from 'react';
import { Navigate, useSearchParams } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { signInWithGoogle } from '../auth/signin';
import { friendlyAuthError } from '../lib/errors';
import { USE_EMULATORS } from '../firebase';
import { EmulatorLogin } from './EmulatorLogin';
import { Logo, GoogleIcon } from '../components/icons';
import styles from './Login.module.css';

export function LoginPage() {
  const { user, profile, endedReason } = useAuth();
  const [params] = useSearchParams();
  const next = safeNext(params.get('next'));
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user && profile) return <Navigate to={next} replace />;

  const google = async () => {
    setBusy(true);
    setError(null);
    try {
      await signInWithGoogle();
    } catch (err) {
      setError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="center-page">
      <main className="card" aria-labelledby="login-title">
        <div className={styles.brand}>
          <Logo size={40} />
          <div>
            <h1 id="login-title" className={styles.title}>
              Sign in to Flack
            </h1>
            <p className={styles.sub}>Invite-only team chat</p>
          </div>
        </div>
        {(error || endedReason) && (
          <p role="alert" className={styles.alert}>
            {error ?? endedReason}
          </p>
        )}
        <button className="btn btn-lg" onClick={google} disabled={busy}>
          <GoogleIcon /> Continue with Google
        </button>
        {USE_EMULATORS && <EmulatorLogin onError={setError} />}
        <p className={styles.fine}>
          You need an invite from an admin to join. Use the Google account your invite was sent to.
        </p>
      </main>
    </div>
  );
}

export function safeNext(next: string | null): string {
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}
