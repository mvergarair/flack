import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore';
import { as, fs, makeEnv, seed } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => seed(env));

const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const branding = (uid: string, extra: Record<string, unknown> = {}) => ({
  name: 'Acme',
  tagline: 'Acme team chat',
  logo: PNG,
  accent: '#c2185b',
  sidebar: '#113a2e',
  updatedAt: serverTimestamp(),
  updatedBy: uid,
  ...extra,
});

describe('workspace branding', () => {
  it('is readable by anyone (the sign-in page shows it), unlike the rest of config', async () => {
    await assertSucceeds(getDoc(doc(fs(env.unauthenticatedContext()), 'config/branding')));
    await assertFails(getDoc(doc(fs(env.unauthenticatedContext()), 'config/app')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'config/app')));
  });

  it('only admins change it', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'admin')), 'config/branding'), branding('admin')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'config/branding'), branding('member')));
    await assertFails(setDoc(doc(fs(as(env, 'staleAdmin')), 'config/branding'), branding('staleAdmin')));
    await assertFails(setDoc(doc(fs(env.unauthenticatedContext()), 'config/branding'), branding('x')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'config/app'), { defaultChannelIds: ['priv'] }));
  });

  it('accepts defaults (empty text, no logo or colors)', async () => {
    await assertSucceeds(setDoc(doc(fs(as(env, 'admin')), 'config/branding'), branding('admin', { name: '', tagline: '', logo: null, accent: null, sidebar: null })));
  });

  it('validates every field', async () => {
    const db = fs(as(env, 'admin'));
    const bad = (extra: Record<string, unknown>) => assertFails(setDoc(doc(db, 'config/branding'), branding('admin', extra)));
    await bad({ name: 'x'.repeat(41) });
    await bad({ tagline: 'x'.repeat(141) });
    await bad({ accent: 'red' });
    await bad({ sidebar: '#12345' });
    await bad({ accent: '#123456;}body{display:none' });
    // SVG can carry scripts; only raster data URLs are allowed, and small ones.
    await bad({ logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    await bad({ logo: 'https://evil.example/logo.png' });
    await bad({ logo: `data:image/png;base64,${'A'.repeat(200_001)}` });
    await bad({ updatedBy: 'member' });
    await bad({ css: 'body{}' });
  });
});

describe('health stats and the statistics switch', () => {
  it('only admins read the daily stats and the statistics settings', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'stats/2026-09-29'), { messages24h: 3 });
      await setDoc(doc(ctx.firestore(), 'config/telemetry'), { installId: 'x', enabled: true, lastReport: { schema: 1 } });
    });
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'stats/2026-09-29')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'stats/2026-09-29')));
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'config/telemetry')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'config/telemetry')));
    await assertFails(getDoc(doc(fs(env.unauthenticatedContext()), 'config/telemetry')));
  });

  it('admins switch statistics on or off, and nothing else', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'config/telemetry'), { installId: 'x', enabled: true });
    });
    const admin = fs(as(env, 'admin'));
    await assertSucceeds(setDoc(doc(admin, 'config/telemetry'), { enabled: false }, { merge: true }));
    await assertSucceeds(setDoc(doc(admin, 'config/telemetry'), { noticeSeen: true }, { merge: true }));
    await assertFails(setDoc(doc(admin, 'config/telemetry'), { installId: 'spoofed' }, { merge: true }));
    await assertFails(setDoc(doc(admin, 'config/telemetry'), { lastReport: { fake: true } }, { merge: true }));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'config/telemetry'), { enabled: false }, { merge: true }));
    await assertFails(setDoc(doc(admin, 'stats/2026-09-29'), { messages24h: 1 }));
  });
});

