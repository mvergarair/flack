let registration: Promise<ServiceWorkerRegistration | undefined> | undefined;

/** Registers the service worker once (offline shell + FCM background messages). */
export function registerServiceWorker(): Promise<ServiceWorkerRegistration | undefined> {
  if (!registration) {
    registration = (async () => {
      if (!('serviceWorker' in navigator)) return undefined;
      try {
        const url = import.meta.env.DEV ? '/dev-sw.js?dev-sw' : '/sw.js';
        return await navigator.serviceWorker.register(url, {
          type: import.meta.env.DEV ? 'module' : 'classic',
          scope: '/',
        });
      } catch (err) {
        console.warn('Service worker registration failed', err);
        return undefined;
      }
    })();
  }
  return registration;
}
