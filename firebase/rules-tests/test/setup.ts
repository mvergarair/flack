import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  initializeTestEnvironment,
  type RulesTestEnvironment,
  type RulesTestContext,
} from '@firebase/rules-unit-testing';
import { doc, setDoc, Timestamp, type Firestore } from 'firebase/firestore';

const dir = (p: string) => fileURLToPath(new URL(`../../${p}`, import.meta.url));

// Same project as the emulator suite: Storage rules' firestore.get() reads the default project.
export const PROJECT = 'demo-flack';

export async function makeEnv(): Promise<RulesTestEnvironment> {
  return initializeTestEnvironment({
    projectId: PROJECT,
    firestore: { host: '127.0.0.1', port: 8380, rules: readFileSync(dir('firestore.rules'), 'utf8') },
    storage: { host: '127.0.0.1', port: 9398, rules: readFileSync(dir('storage.rules'), 'utf8') },
    database: { host: '127.0.0.1', port: 9300, rules: readFileSync(dir('database.rules.json'), 'utf8') },
  });
}

export type Who = 'admin' | 'member' | 'member2' | 'outsider' | 'gone' | 'staleAdmin';

/** Token claims each test identity carries. `gone` still holds an "active" token (not yet expired). */
const CLAIMS: Record<Who, Record<string, unknown>> = {
  admin: { role: 'admin', active: true },
  member: { role: 'member', active: true },
  member2: { role: 'member', active: true },
  outsider: { role: 'member', active: true }, // active user who is not in the test channels
  gone: { role: 'member', active: true },
  staleAdmin: { role: 'admin', active: true }, // demoted in Firestore; token not refreshed yet
};

export function as(env: RulesTestEnvironment, who: Who): RulesTestContext {
  return env.authenticatedContext(who, CLAIMS[who]);
}

export const ts = (ms = Date.now()) => Timestamp.fromMillis(ms);

export function userDoc(id: Who, role: 'admin' | 'member', status: 'active' | 'deactivated') {
  return {
    displayName: id,
    email: `${id}@t.test`,
    emailLower: `${id}@t.test`,
    photoURL: null,
    title: '',
    role,
    status,
    createdAt: ts(0),
  };
}

export const message = (authorId: string, extra: Record<string, unknown> = {}) => ({
  text: 'hello',
  authorId,
  threadParentId: null,
  attachments: [],
  mentions: [],
  replyCount: 0,
  replyUserIds: [],
  ...extra,
});

/** Baseline data: users, a public + private channel with a message each, an invite. */
export async function seed(env: RulesTestEnvironment) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore() as unknown as Firestore;
    await setDoc(doc(db, 'users/admin'), userDoc('admin', 'admin', 'active'));
    await setDoc(doc(db, 'users/member'), userDoc('member', 'member', 'active'));
    await setDoc(doc(db, 'users/member2'), userDoc('member2', 'member', 'active'));
    await setDoc(doc(db, 'users/outsider'), userDoc('outsider', 'member', 'active'));
    await setDoc(doc(db, 'users/gone'), userDoc('gone', 'member', 'deactivated'));
    await setDoc(doc(db, 'users/staleAdmin'), userDoc('staleAdmin', 'member', 'active'));
    await setDoc(doc(db, 'config/app'), { bootstrapped: true, defaultChannelIds: ['pub'] });
    await setDoc(doc(db, 'invites/i1'), {
      email: 'x@t.test',
      emailLower: 'x@t.test',
      role: 'member',
      invitedBy: 'admin',
      token: 'tok',
      status: 'pending',
      createdAt: ts(),
      expiresAt: ts(Date.now() + 1e9),
    });
    const channel = (type: string, memberIds: string[], createdBy = 'member') => ({
      name: type === 'dm' ? '' : type === 'public' ? 'pub' : 'priv',
      type,
      memberIds,
      createdBy,
      archived: false,
      topic: '',
      createdAt: ts(0),
    });
    await setDoc(doc(db, 'channels/pub'), channel('public', ['admin', 'member', 'gone']));
    await setDoc(doc(db, 'channels/priv'), channel('private', ['member', 'member2']));
    await setDoc(doc(db, 'channels/archived'), { ...channel('public', ['member']), name: 'old', archived: true });
    await setDoc(doc(db, 'channels/dm_member_member2'), channel('dm', ['member', 'member2']));
    await setDoc(doc(db, 'channels/pub/messages/m1'), { ...message('member'), createdAt: ts() });
    await setDoc(doc(db, 'channels/priv/messages/m1'), { ...message('member2'), createdAt: ts() });
    await setDoc(doc(db, 'channels/pub/messages/gonemsg'), { ...message('gone'), createdAt: ts() });
    await setDoc(doc(db, 'users/member/private/tokens'), { tokens: {} });
    await setDoc(doc(db, 'users/member/activity/a1'), { kind: 'mention', createdAt: ts() });
  });
}

export const fs = (ctx: RulesTestContext) => ctx.firestore() as unknown as Firestore;
