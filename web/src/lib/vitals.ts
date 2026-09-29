import { httpsCallable } from 'firebase/functions';
import { app, functions, USE_EMULATORS } from '../firebase';

const SAMPLE = 0.2;

/**
 * Samples page-load speed (largest contentful paint, or DOM ready where LCP isn't supported)
 * for the admins' health card: one in five loads, sent once, stored only as a coarse bucket.
 * Production also gets Firebase Performance Monitoring (the install's own console).
 */
export function startPageLoadReporting() {
  if (!USE_EMULATORS) {
    import('firebase/performance').then(({ getPerformance }) => getPerformance(app)).catch(() => undefined);
  }
  let forced = false;
  try {
    forced = USE_EMULATORS && localStorage.getItem('flack:vitals') === '1';
  } catch {
    // ignore
  }
  if (USE_EMULATORS ? !forced : Math.random() > SAMPLE) return;

  let lcp = 0;
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) lcp = Math.max(lcp, e.startTime);
    }).observe({ type: 'largest-contentful-paint', buffered: true });
  } catch {
    // Not supported (older Safari): fall back to DOM ready below.
  }
  let sent = false;
  const send = () => {
    if (sent) return;
    sent = true;
    const nav = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined;
    const ms = Math.round(lcp || nav?.domContentLoadedEventEnd || 0);
    if (ms > 0) httpsCallable(functions, 'recordvitals')({ lcp: ms }).catch(() => undefined);
  };
  document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send(), { once: true });
  setTimeout(send, forced ? 3_000 : 10_000);
}
