import { useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../auth/AuthProvider';
import { useIsMobile } from '../lib/hooks';
import { startPageLoadReporting } from '../lib/vitals';
import { useWorkspace } from '../data/workspace';
import { usePushSync } from '../data/push';
import { notificationPath, type PushData } from '../lib/push-routing';
import { Sidebar } from '../components/Sidebar';
import { MobileNav } from '../components/MobileNav';
import { usePresence } from '../data/presence';
import { useHotkeys } from '../data/hotkeys';
import { ProfileCardHost } from '../components/ProfileCard';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../firebase';
import styles from './Shell.module.css';

/**
 * Desktop: sidebar + routed content (channel view renders its own thread panel).
 * Mobile: one routed pane; the bottom nav shows on the top-level tabs only.
 */
export function Shell() {
  const mobile = useIsMobile();
  const { user, profile } = useAuth();
  const { ready } = useWorkspace();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [toast, setToast] = useState<PushData | null>(null);
  usePresence();
  useEffect(startPageLoadReporting, []);
  useHotkeys();

  // Record my time zone (local time on profile cards, DND schedules).
  useEffect(() => {
    if (!profile) return;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (tz && profile.timeZone !== tz) updateDoc(doc(db, 'users', profile.id), { timeZone: tz }).catch(() => undefined);
  }, [profile]);

  // Foreground pushes → toast (skipped when that conversation is already on screen).
  const onForeground = useCallback(
    (d: PushData) => {
      if (d.channelId && location.pathname.startsWith(`/c/${d.channelId}`)) return;
      setToast(d);
    },
    [],
  );
  usePushSync(user?.uid, onForeground);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  // Notification clicks from the service worker.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const on = (e: MessageEvent) => {
      if (e.data?.type === 'navigate') navigate(notificationPath(e.data));
    };
    navigator.serviceWorker.addEventListener('message', on);
    return () => navigator.serviceWorker.removeEventListener('message', on);
  }, [navigate]);

  const topLevel = pathname === '/' || pathname === '/dms' || pathname === '/activity' || pathname === '/admin' || pathname === '/later' || pathname === '/search';

  return (
    <div className={styles.shell} data-testid="app-shell" data-layout={mobile ? 'mobile' : 'desktop'}>
      {!mobile && <Sidebar />}
      <div className={styles.main}>
        {ready ? (
          <Outlet />
        ) : (
          <div className={styles.loading}>
            <div className="spinner" aria-label="Loading workspace" />
          </div>
        )}
      </div>
      {mobile && topLevel && <MobileNav />}
      <ProfileCardHost />
      {toast && (
        <button
          className={styles.toast}
          role="status"
          onClick={() => {
            navigate(notificationPath(toast));
            setToast(null);
          }}
        >
          <strong>{toast.title}</strong>
          <span>{toast.body}</span>
        </button>
      )}
    </div>
  );
}
