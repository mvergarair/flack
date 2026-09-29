import { describe, expect, it } from 'vitest';
import { notificationPath, pushSupport } from './push-routing';

describe('notificationPath', () => {
  it('opens the channel or thread path', () => {
    expect(notificationPath({ path: '/c/abc/t/m1' })).toBe('/c/abc/t/m1');
    expect(notificationPath({ path: '/c/abc?m=m2' })).toBe('/c/abc?m=m2');
  });
  it('refuses anything that could leave the app', () => {
    expect(notificationPath({ path: 'https://evil.example' })).toBe('/');
    expect(notificationPath({ path: '//evil.example/x' })).toBe('/');
    expect(notificationPath(undefined)).toBe('/');
  });
});

describe('pushSupport', () => {
  const desktop = { hasNotification: true, hasServiceWorker: true, hasPushManager: true, userAgent: 'Mozilla/5.0 (Macintosh) Chrome', standalone: false };
  it('reports the permission on capable browsers', () => {
    expect(pushSupport({ ...desktop, permission: 'granted' })).toBe('granted');
    expect(pushSupport({ ...desktop, permission: 'default' })).toBe('default');
  });
  it('asks iPhone users to add the app to the Home Screen first', () => {
    const iphone = { ...desktop, userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) Safari', hasPushManager: false };
    expect(pushSupport(iphone)).toBe('needs-install');
    expect(pushSupport({ ...iphone, standalone: true, hasPushManager: true, permission: 'default' })).toBe('default');
    expect(pushSupport({ ...desktop, maxTouchPoints: 5, standalone: false })).toBe('needs-install'); // iPadOS
  });
  it('flags browsers without push', () => {
    expect(pushSupport({ ...desktop, hasPushManager: false })).toBe('unsupported');
  });
});
