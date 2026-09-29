/// <reference lib="webworker" />
import { precacheAndRoute, cleanupOutdatedCaches, createHandlerBoundToURL } from 'workbox-precaching';
import { NavigationRoute, registerRoute } from 'workbox-routing';
import { clientsClaim } from 'workbox-core';
import { initializeApp } from 'firebase/app';
import { getMessaging, onBackgroundMessage } from 'firebase/messaging/sw';
import { firebaseConfig, USE_EMULATORS } from './firebase-config';
import { notificationPath, type PushData } from './lib/push-routing';

declare const self: ServiceWorkerGlobalScope;

self.skipWaiting();
clientsClaim();
cleanupOutdatedCaches();
precacheAndRoute(self.__WB_MANIFEST);

// App shell: every navigation serves the cached index.html so the PWA opens offline.
// (/__/auth/* is Firebase Auth's own handler and must reach the network.)
try {
  registerRoute(new NavigationRoute(createHandlerBoundToURL('/index.html'), { denylist: [/^\/__\//] }));
} catch {
  // index.html is not precached in dev.
}

// Pushes are data-only so we control the notification on every platform.
if (!USE_EMULATORS) {
  const messaging = getMessaging(initializeApp(firebaseConfig));
  onBackgroundMessage(messaging, (payload) => {
    const d = (payload.data ?? {}) as PushData;
    return self.registration.showNotification(d.title ?? 'Flack', {
      body: d.body ?? '',
      tag: d.tag,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { path: notificationPath(d) },
    });
  });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const path = notificationPath(event.notification.data as PushData);
  event.waitUntil(
    (async () => {
      const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (existing) {
        await existing.focus();
        existing.postMessage({ type: 'navigate', path });
        return;
      }
      await self.clients.openWindow(path);
    })(),
  );
});
