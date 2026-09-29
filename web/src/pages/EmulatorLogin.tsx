import { useState, type FormEvent } from 'react';
import { signInWithPassword } from '../auth/signin';
import { friendlyAuthError } from '../lib/errors';
import styles from './Login.module.css';

/**
 * Local-only email/password form for the emulators (seeded password: password123).
 * Only rendered when VITE_USE_EMULATORS=true, so production builds tree-shake it away.
 */
export function EmulatorLogin({ onError, defaultEmail = '' }: { onError: (msg: string | null) => void; defaultEmail?: string }) {
  const [email, setEmail] = useState(defaultEmail);
  const [password, setPassword] = useState('password123');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent, create: boolean) => {
    e.preventDefault();
    setBusy(true);
    onError(null);
    try {
      await signInWithPassword(email.trim(), password, create);
    } catch (err) {
      onError(friendlyAuthError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className={styles.emu} onSubmit={(e) => submit(e, false)} data-testid="emulator-login">
      <div className={styles.divider}>
        <span>Emulator sign-in</span>
      </div>
      <label className="field">
        Email
        <input className="input" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label className="field">
        Password
        <input
          className="input"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
      </label>
      <div className={styles.row}>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          Sign in
        </button>
        <button type="button" className="btn" disabled={busy} onClick={(e) => submit(e, true)}>
          Create account
        </button>
      </div>
    </form>
  );
}
