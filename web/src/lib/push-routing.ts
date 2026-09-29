/** Pure helpers shared by the service worker and the app (unit-tested). */

export interface PushData {
  title?: string;
  body?: string;
  path?: string;
  link?: string;
  tag?: string;
  channelId?: string;
}

/** In-app path a notification should open; never leaves our origin. */
export function notificationPath(data: PushData | undefined): string {
  const p = data?.path ?? '';
  return p.startsWith('/') && !p.startsWith('//') ? p : '/';
}

export type PushSupport = 'unsupported' | 'needs-install' | 'default' | 'granted' | 'denied';

/**
 * iOS/iPadOS only allow web push for apps added to the Home Screen (16.4+), so a Safari tab
 * must be told to install first.
 */
export function pushSupport(env: {
  hasNotification: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  permission?: NotificationPermission;
  userAgent: string;
  standalone: boolean;
  maxTouchPoints?: number;
}): PushSupport {
  const ios = /iPhone|iPad|iPod/.test(env.userAgent) || (/Macintosh/.test(env.userAgent) && (env.maxTouchPoints ?? 0) > 1);
  if (ios && !env.standalone) return 'needs-install';
  if (!env.hasNotification || !env.hasServiceWorker || !env.hasPushManager) return 'unsupported';
  return env.permission ?? 'default';
}
