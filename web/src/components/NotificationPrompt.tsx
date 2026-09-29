import { useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { usePushState } from '../data/push';
import { BellIcon, CloseIcon } from './icons';
import styles from './NotificationPrompt.module.css';

const KEY = 'flack:pushPromptDismissed';
const dismissed = () => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
};

/** One-time nudge to turn notifications on (or, on iPhone, to install the app first). */
export function NotificationPrompt({ variant = 'sidebar' }: { variant?: 'sidebar' | 'mobile' }) {
  const me = useMe();
  const { support, enabled, enable } = usePushState(me.id);
  const [hidden, setHidden] = useState(dismissed);
  if (hidden || enabled || (support !== 'default' && support !== 'needs-install')) return null;

  const close = () => {
    try {
      localStorage.setItem(KEY, '1');
    } catch {
      // ignore
    }
    setHidden(true);
  };

  return (
    <div className={`${styles.prompt} ${styles[variant]}`} role="region" aria-label="Turn on notifications" data-testid="push-prompt">
      <BellIcon size={18} />
      <span className={styles.text}>
        {support === 'needs-install' ? 'Add Flack to your Home Screen to get notifications.' : 'Get notified about DMs and mentions.'}
      </span>
      {support === 'default' && (
        <button className={styles.enable} onClick={() => enable().then(close)}>
          Turn on
        </button>
      )}
      <button className={styles.close} aria-label="Dismiss" onClick={close}>
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
