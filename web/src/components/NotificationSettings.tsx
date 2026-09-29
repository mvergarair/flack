import { useState } from 'react';
import { useMe } from '../auth/AuthProvider';
import { usePushState } from '../data/push';
import { friendlyError } from '../lib/errors';
import { Modal } from './Modal';
import { DndSettings } from './DndSettings';
import styles from './NotificationSettings.module.css';

export function NotificationSettings({ onClose }: { onClose: () => void }) {
  const me = useMe();
  const { support, enabled, enable, disable } = usePushState(me.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Notifications" onClose={onClose}>
      <p className={styles.lead}>You get a notification for direct messages, @mentions and replies to threads you're in — unless you're already looking at that conversation.</p>

      {support === 'needs-install' && (
        <div className={styles.box} data-testid="push-install-hint">
          <strong>Add Flack to your Home Screen first</strong>
          <ol>
            <li>
              Tap the <b>Share</b> button in Safari.
            </li>
            <li>
              Choose <b>Add to Home Screen</b>.
            </li>
            <li>Open Flack from the new icon and come back here.</li>
          </ol>
          <span className="field-hint">iPhone and iPad only allow notifications for installed web apps (iOS 16.4 or later).</span>
        </div>
      )}

      {support === 'unsupported' && <p className={styles.box}>This browser doesn't support push notifications.</p>}

      {support === 'denied' && (
        <p className={styles.box}>Notifications are blocked for this site. Allow them in your browser or system settings, then reload Flack.</p>
      )}

      {(support === 'default' || support === 'granted') && (
        <div className={styles.row}>
          <div>
            <strong>Push notifications on this device</strong>
            <span className="field-hint" data-testid="push-status">
              {enabled ? 'On' : 'Off'}
            </span>
          </div>
          {enabled ? (
            <button className="btn" disabled={busy} onClick={() => run(disable)}>
              Turn off
            </button>
          ) : (
            <button className="btn btn-primary" disabled={busy} onClick={() => run(enable)}>
              Turn on
            </button>
          )}
        </div>
      )}
      <DndSettings />
      {error && <p className="error-text">{error}</p>}
    </Modal>
  );
}
