import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, updateDoc, addDoc, serverTimestamp, where } from 'firebase/firestore';
import { as, fs, makeEnv, seed, ts, userDoc } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => seed(env));

describe('users', () => {
  it('active users can read profiles', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'users/admin')));
    await assertSucceeds(getDocs(collection(fs(as(env, 'member')), 'users')));
  });

  it('signed-out and deactivated users cannot read profiles', async () => {
    await assertFails(getDoc(doc(fs(env.unauthenticatedContext()), 'users/admin')));
    await assertFails(getDoc(doc(fs(as(env, 'gone')), 'users/admin')));
    await assertFails(getDocs(collection(fs(as(env, 'gone')), 'users')));
  });

  it('a token without the active claim is locked out even if the doc says active', async () => {
    const ctx = env.authenticatedContext('member', { role: 'member', active: false });
    await assertFails(getDoc(doc(fs(ctx), 'users/admin')));
  });

  it('profile photos must be https URLs', async () => {
    const ref = doc(fs(as(env, 'member')), 'users/member');
    await assertSucceeds(updateDoc(ref, { photoURL: 'https://lh3.googleusercontent.com/a/x' }));
    await assertSucceeds(updateDoc(ref, { photoURL: null }));
    await assertFails(updateDoc(ref, { photoURL: 'javascript:alert(1)' }));
    await assertFails(updateDoc(ref, { photoURL: { src: 'x' } }));
  });

  it('users can edit their own display name and title', async () => {
    await assertSucceeds(updateDoc(doc(fs(as(env, 'member')), 'users/member'), { displayName: 'New Name', title: 'Eng' }));
  });

  it('users cannot change their own role, status or email', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(updateDoc(doc(db, 'users/member'), { role: 'admin' }));
    await assertFails(updateDoc(doc(db, 'users/member'), { status: 'deactivated' }));
    await assertFails(updateDoc(doc(db, 'users/member'), { email: 'x@y.z' }));
  });

  it("nobody edits another user's profile or role, not even admins", async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'users/member2'), { displayName: 'Hacked' }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'users/member'), { role: 'admin' }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'users/member'), { status: 'deactivated' }));
  });

  it('clients cannot create or delete user docs', async () => {
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'users/newbie'), userDoc('member', 'member', 'active')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'users/newbie'), userDoc('member', 'admin', 'active')));
    await assertFails(deleteDoc(doc(fs(as(env, 'admin')), 'users/member')));
  });

  it('deactivated users cannot edit their profile', async () => {
    await assertFails(updateDoc(doc(fs(as(env, 'gone')), 'users/gone'), { displayName: 'Back' }));
  });

  it('empty or overlong display names are rejected', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(updateDoc(doc(db, 'users/member'), { displayName: '' }));
    await assertFails(updateDoc(doc(db, 'users/member'), { displayName: 'x'.repeat(81) }));
  });
});

describe('private subcollections', () => {
  it('FCM tokens are owner-only', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'users/member/private/tokens')));
    await assertSucceeds(setDoc(doc(fs(as(env, 'member')), 'users/member/private/tokens'), { tokens: { abc: { createdAt: ts() } } }));
    await assertFails(getDoc(doc(fs(as(env, 'admin')), 'users/member/private/tokens')));
    await assertFails(setDoc(doc(fs(as(env, 'member2')), 'users/member/private/tokens'), { tokens: {} }));
    await assertFails(getDoc(doc(fs(as(env, 'gone')), 'users/gone/private/tokens')));
    // Only the tokens doc, only token entries.
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'users/member/private/other'), { tokens: {} }));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'users/member/private/tokens'), { tokens: {}, stash: 'x'.repeat(1000) }));
  });

  it('read markers are owner-only and well-formed', async () => {
    const mine = doc(fs(as(env, 'member')), 'users/member/reads/pub');
    await assertSucceeds(setDoc(mine, { lastReadAt: ts() }));
    await assertFails(setDoc(mine, { lastReadAt: 'yesterday' }));
    await assertFails(setDoc(mine, { lastReadAt: ts(), extra: 1 }));
    await assertSucceeds(setDoc(mine, { lastReadAt: ts(), manual: true }));
    await assertFails(setDoc(mine, { lastReadAt: ts(), manual: 'yes' }));
    await assertFails(setDoc(doc(fs(as(env, 'member2')), 'users/member/reads/pub'), { lastReadAt: ts() }));
  });

  it('activity is readable/deletable by the owner, written only by functions', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'users/member/activity/a1')));
    await assertFails(getDoc(doc(fs(as(env, 'member2')), 'users/member/activity/a1')));
    await assertFails(addDoc(collection(fs(as(env, 'member')), 'users/member/activity'), { kind: 'mention' }));
    await assertSucceeds(deleteDoc(doc(fs(as(env, 'member')), 'users/member/activity/a1')));
  });
});

describe('invites and config', () => {
  it('only admins can read invites', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'admin')), 'invites/i1')));
    await assertSucceeds(getDocs(collection(fs(as(env, 'admin')), 'invites')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'invites/i1')));
    await assertFails(getDocs(collection(fs(as(env, 'member')), 'invites')));
  });

  it('a demoted admin with a stale admin token cannot read invites', async () => {
    await assertFails(getDoc(doc(fs(as(env, 'staleAdmin')), 'invites/i1')));
  });

  it('nobody writes invites from the client, not even admins', async () => {
    const admin = fs(as(env, 'admin'));
    await assertFails(addDoc(collection(admin, 'invites'), { email: 'y@t.test', role: 'admin', status: 'pending' }));
    await assertFails(updateDoc(doc(admin, 'invites/i1'), { status: 'revoked' }));
    await assertFails(updateDoc(doc(admin, 'invites/i1'), { role: 'admin' }));
    await assertFails(deleteDoc(doc(admin, 'invites/i1')));
    await assertFails(addDoc(collection(fs(as(env, 'member')), 'invites'), { email: 'me2@t.test', role: 'admin' }));
  });

  it('config is read-only for active users', async () => {
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'config/app')));
    await assertFails(getDoc(doc(fs(as(env, 'gone')), 'config/app')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'config/app'), { bootstrapped: false }));
  });
});

describe('per-channel notification settings', () => {
  const pref = (level: string, channelId = 'pub') => ({ level, channelId, updatedAt: serverTimestamp() });

  it('owners set and read their own setting', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'users/member/channelPrefs/pub'), pref('all')));
    await assertSucceeds(setDoc(doc(db, 'users/member/channelPrefs/pub'), pref('none')));
    await assertSucceeds(getDoc(doc(db, 'users/member/channelPrefs/pub')));
    await assertSucceeds(deleteDoc(doc(db, 'users/member/channelPrefs/pub')));
  });

  it("nobody reads or writes someone else's settings", async () => {
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'users/member/channelPrefs/pub'), pref('none')));
    await assertFails(getDoc(doc(fs(as(env, 'admin')), 'users/member/channelPrefs/pub')));
  });

  it('rejects unknown levels, mismatched channel ids, extra fields and deactivated users', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'users/member/channelPrefs/pub'), pref('loud')));
    await assertFails(setDoc(doc(db, 'users/member/channelPrefs/pub'), pref('all', 'priv')));
    await assertFails(setDoc(doc(db, 'users/member/channelPrefs/pub'), { ...pref('all'), extra: true }));
    await assertFails(setDoc(doc(fs(as(env, 'gone')), 'users/gone/channelPrefs/pub'), pref('none')));
  });
});

describe('quick reactions', () => {
  it('owners set exactly three', async () => {
    const ref = doc(fs(as(env, 'member')), 'users/member');
    await assertSucceeds(updateDoc(ref, { quickReactions: ['🔥', '🙏', '💯'] }));
    await assertFails(updateDoc(ref, { quickReactions: ['🔥', '🙏'] }));
    await assertFails(updateDoc(ref, { quickReactions: ['🔥', '🙏', 'x'.repeat(17)] }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'users/member'), { quickReactions: ['👎', '👎', '👎'] }));
  });
});

describe('custom status', () => {
  it('owners set, change and clear their status', async () => {
    const ref = doc(fs(as(env, 'member')), 'users/member');
    await assertSucceeds(updateDoc(ref, { customStatus: { emoji: '🌴', text: 'On vacation', expiresAt: null } }));
    await assertSucceeds(updateDoc(ref, { customStatus: { emoji: '📅', text: 'In a meeting', expiresAt: ts(Date.now() + 3_600_000) } }));
    await assertSucceeds(updateDoc(ref, { customStatus: null }));
  });

  it('rejects bad shapes and other people', async () => {
    const ref = doc(fs(as(env, 'member')), 'users/member');
    await assertFails(updateDoc(ref, { customStatus: { emoji: '🌴', text: 'x'.repeat(101), expiresAt: null } }));
    await assertFails(updateDoc(ref, { customStatus: { emoji: '🌴', text: 'hi', expiresAt: 'tomorrow' } }));
    await assertFails(updateDoc(ref, { customStatus: { emoji: '🌴', text: 'hi', expiresAt: null, color: 'red' } }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'users/member'), { customStatus: { emoji: '🤡', text: 'lol', expiresAt: null } }));
    await assertFails(updateDoc(doc(fs(as(env, 'gone')), 'users/gone'), { customStatus: { emoji: '👋', text: 'bye', expiresAt: null } }));
  });
});

describe('saved items, time zone and Do Not Disturb', () => {
  const save = (messageId = 'm1') => ({ channelId: 'pub', messageId, threadParentId: null, savedAt: serverTimestamp() });

  it('owners save and unsave messages; nobody else can see them', async () => {
    const db = fs(as(env, 'member'));
    await assertSucceeds(setDoc(doc(db, 'users/member/saved/m1'), save()));
    await assertSucceeds(getDoc(doc(db, 'users/member/saved/m1')));
    await assertSucceeds(deleteDoc(doc(db, 'users/member/saved/m1')));
    await assertFails(getDoc(doc(fs(as(env, 'admin')), 'users/member/saved/m1')));
    await assertFails(setDoc(doc(fs(as(env, 'admin')), 'users/member/saved/m1'), save()));
  });

  it('saved docs must match their id and shape', async () => {
    const db = fs(as(env, 'member'));
    await assertFails(setDoc(doc(db, 'users/member/saved/m1'), save('other')));
    await assertFails(setDoc(doc(db, 'users/member/saved/m1'), { ...save(), note: 'x' }));
  });

  it('owners set their time zone and DND; shapes are validated', async () => {
    const ref = doc(fs(as(env, 'member')), 'users/member');
    await assertSucceeds(updateDoc(ref, { timeZone: 'America/Santiago' }));
    await assertSucceeds(updateDoc(ref, { dnd: { until: ts(Date.now() + 3_600_000), schedule: { enabled: true, start: '22:00', end: '08:00' } } }));
    await assertSucceeds(updateDoc(ref, { dnd: { until: null, schedule: { enabled: false, start: '22:00', end: '08:00' } } }));
    await assertFails(updateDoc(ref, { dnd: { until: 'later' } }));
    await assertFails(updateDoc(ref, { dnd: { schedule: { enabled: true, start: '25:00', end: '08:00' } } }));
    await assertFails(updateDoc(ref, { dnd: { until: null, mode: 'loud' } }));
    await assertFails(updateDoc(ref, { timeZone: 'x'.repeat(65) }));
    await assertFails(updateDoc(doc(fs(as(env, 'admin')), 'users/member'), { dnd: { until: null } }));
  });
});

describe('API tokens', () => {
  it('owners read their own token metadata; nobody writes it directly', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), 'apiTokens/h1'), { uid: 'member', name: 'ci', scopes: ['read'], prefix: 'flk_abc', createdAt: ts(), lastUsedAt: null });
    });
    await assertSucceeds(getDoc(doc(fs(as(env, 'member')), 'apiTokens/h1')));
    await assertSucceeds(getDocs(query(collection(fs(as(env, 'member')), 'apiTokens'), where('uid', '==', 'member'))));
    await assertFails(getDoc(doc(fs(as(env, 'member2')), 'apiTokens/h1')));
    await assertFails(getDocs(collection(fs(as(env, 'member')), 'apiTokens')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'apiTokens/h2'), { uid: 'member', name: 'x', scopes: ['write'] }));
    await assertFails(updateDoc(doc(fs(as(env, 'member')), 'apiTokens/h1'), { scopes: ['read', 'write'] }));
    await assertFails(deleteDoc(doc(fs(as(env, 'member')), 'apiTokens/h1')));
  });
});

describe('search index', () => {
  it('is closed to clients (only the search function reads it)', async () => {
    await assertFails(getDocs(collection(fs(as(env, 'admin')), 'search')));
    await assertFails(getDoc(doc(fs(as(env, 'member')), 'search/m1')));
    await assertFails(setDoc(doc(fs(as(env, 'member')), 'search/m1'), { channelId: 'pub', terms: ['x'] }));
  });
});

