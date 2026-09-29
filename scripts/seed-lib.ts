// Emulator-only seed + reset helpers, shared by `npm run seed` and the e2e suite.
// Refuses to run unless every emulator host is set, so it can never touch real data.
import { initializeApp, getApps, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore, Timestamp, FieldValue } from 'firebase-admin/firestore';
import { buildTerms, snippet } from '../firebase/functions/src/search/terms.ts';

export const PROJECT = 'demo-flack';
export const PASSWORD = 'password123';
const HOSTS = {
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8380',
  FIREBASE_AUTH_EMULATOR_HOST: '127.0.0.1:9399',
  FIREBASE_DATABASE_EMULATOR_HOST: '127.0.0.1:9300',
  FIREBASE_STORAGE_EMULATOR_HOST: '127.0.0.1:9398',
} as const;

for (const [k, v] of Object.entries(HOSTS)) process.env[k] ??= v;
process.env.GCLOUD_PROJECT = PROJECT;

let app: App;
function admin() {
  if (!PROJECT.startsWith('demo-')) throw new Error('seed only runs against demo- projects');
  app ??= getApps()[0] ?? initializeApp({ projectId: PROJECT, databaseURL: `http://127.0.0.1:9300?ns=${PROJECT}-default-rtdb` });
  return { auth: getAuth(app), db: getFirestore(app) };
}

export type SeedUser = {
  key: string;
  uid: string;
  email: string;
  displayName: string;
  role: 'admin' | 'member';
  status: 'active' | 'deactivated';
};

export const USERS: SeedUser[] = [
  { key: 'admin', uid: 'uAdmin', email: 'admin@flack.test', displayName: 'Ada Admin', role: 'admin', status: 'active' },
  { key: 'member', uid: 'uMember', email: 'member@flack.test', displayName: 'Mia Member', role: 'member', status: 'active' },
  { key: 'member2', uid: 'uMember2', email: 'member2@flack.test', displayName: 'Tomás Araya', role: 'member', status: 'active' },
  { key: 'deactivated', uid: 'uGone', email: 'gone@flack.test', displayName: 'Gus Gone', role: 'member', status: 'deactivated' },
];
export const INVITEE_EMAIL = 'invitee@flack.test';
export const OUTSIDER_EMAIL = 'outsider@flack.test';
export const INVITE_TOKEN = 'seed-invite-token-0001';

export const CHANNELS = {
  general: 'cGeneral',
  random: 'cRandom',
  engineering: 'cEngineering',
  secret: 'cSecret',
  history: 'cHistory',
};

async function http(method: string, url: string) {
  const res = await fetch(url, { method, headers: { Authorization: 'Bearer owner' } });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status}`);
}

/** Wipes Auth, Firestore and RTDB emulator data. */
export async function resetEmulators() {
  await Promise.all([
    http('DELETE', `http://${HOSTS.FIRESTORE_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/databases/(default)/documents`),
    http('DELETE', `http://${HOSTS.FIREBASE_AUTH_EMULATOR_HOST}/emulator/v1/projects/${PROJECT}/accounts`),
    fetch(`http://${HOSTS.FIREBASE_DATABASE_EMULATOR_HOST}/.json?ns=${PROJECT}-default-rtdb`, {
      method: 'PUT',
      headers: { Authorization: 'Bearer owner' },
      body: 'null',
    }),
  ]);
}

/**
 * Seeds users (with claims + docs), channels, a pending invite and a message history.
 * `bootstrapped: false` leaves the workspace empty so the first-admin flow can be tested.
 */
export async function seed(opts: { bootstrapped?: boolean; historyCount?: number; demo?: boolean } = {}) {
  // Seeded messages carry `seeded: true`; the emulator functions skip them, so seeding
  // doesn't fan out notifications or cleanup work.
  await seedData(opts);
}

async function seedData(opts: { bootstrapped?: boolean; historyCount?: number; demo?: boolean }) {
  const { auth, db } = admin();
  const bootstrapped = opts.bootstrapped ?? true;
  if (!bootstrapped) return;

  const now = Date.now();
  const batch = db.batch();
  for (const u of USERS) {
    await auth.createUser({
      uid: u.uid,
      email: u.email,
      password: PASSWORD,
      displayName: u.displayName,
      emailVerified: true,
      disabled: u.status === 'deactivated',
    });
    await auth.setCustomUserClaims(u.uid, { role: u.role, active: u.status === 'active' });
    batch.set(db.doc(`users/${u.uid}`), {
      displayName: u.displayName,
      email: u.email,
      emailLower: u.email.toLowerCase(),
      photoURL: null,
      title: '',
      role: u.role,
      status: u.status,
      createdAt: Timestamp.fromMillis(now - 86_400_000),
    });
  }

  const active = USERS.filter((u) => u.status === 'active').map((u) => u.uid);
  const everyone = USERS.map((u) => u.uid);
  const ch = (id: string, name: string, type: 'public' | 'private', memberIds: string[], topic = '') =>
    batch.set(db.doc(`channels/${id}`), {
      name,
      type,
      memberIds,
      createdBy: 'uAdmin',
      archived: false,
      topic,
      typingKey: `t_seed${id.padEnd(20, '0').replace(/[^A-Za-z0-9]/g, '0')}`,
      createdAt: Timestamp.fromMillis(now - 86_400_000),
      lastMessageAt: Timestamp.fromMillis(now - 3_600_000),
    });
  ch(CHANNELS.general, 'general', 'public', everyone, 'Company-wide announcements');
  ch(CHANNELS.random, 'random', 'public', everyone);
  ch(CHANNELS.engineering, 'engineering', 'public', ['uAdmin', 'uMember2'], 'Backend, infra and deploys');
  ch(CHANNELS.secret, 'leadership', 'private', ['uAdmin']);
  ch(CHANNELS.history, 'history', 'public', active, 'Lots of old messages');

  batch.set(db.doc('config/app'), {
    bootstrapped: true,
    defaultChannelIds: [CHANNELS.general, CHANNELS.random],
  });

  batch.set(db.doc('invites/seedInvite'), {
    email: INVITEE_EMAIL,
    emailLower: INVITEE_EMAIL,
    role: 'member',
    invitedBy: 'uAdmin',
    invitedByName: 'Ada Admin',
    token: INVITE_TOKEN,
    createdAt: Timestamp.fromMillis(now),
    expiresAt: Timestamp.fromMillis(now + 7 * 86_400_000),
    status: 'pending',
  });

  batch.set(db.doc(`channels/${CHANNELS.general}/messages/welcome`), {
    text: 'Welcome to **Flack** 👋',
    authorId: 'uAdmin',
    createdAt: Timestamp.fromMillis(now - 3_600_000),
    threadParentId: null,
    attachments: [],
    mentions: [],
    replyCount: 0,
    replyUserIds: [],
    seeded: true,
  });
  batch.set(db.doc(`channels/${CHANNELS.general}/messages/gone-msg`), {
    text: 'An old message from someone who has left.',
    authorId: 'uGone',
    createdAt: Timestamp.fromMillis(now - 7_200_000),
    threadParentId: null,
    attachments: [],
    mentions: [],
    replyCount: 0,
    replyUserIds: [],
    seeded: true,
  });
  await batch.commit();

  if (opts.demo) await seedDemo(db, now);

  const history = opts.historyCount ?? 0;
  for (let start = 0; start < history; start += 400) {
    const b = db.batch();
    for (let i = start; i < Math.min(history, start + 400); i++) {
      b.set(db.doc(`channels/${CHANNELS.history}/messages/h${String(i).padStart(4, '0')}`), {
        text: `History message ${i}`,
        authorId: i % 2 ? 'uAdmin' : 'uMember',
        createdAt: Timestamp.fromMillis(now - 10 * 86_400_000 + i * 60_000),
        threadParentId: null,
        attachments: [],
        mentions: [],
        replyCount: 0,
        replyUserIds: [],
        seeded: true,
      });
    }
    await b.commit();
  }
  await indexSeededMessages(db);
}

/** Seeded messages skip the functions, so write their search index docs here. */
async function indexSeededMessages(db: FirebaseFirestore.Firestore) {
  const names = new Map(USERS.map((u) => [u.uid, u.displayName]));
  const snap = await db.collectionGroup('messages').get();
  for (let i = 0; i < snap.docs.length; i += 400) {
    const b = db.batch();
    for (const d of snap.docs.slice(i, i + 400)) {
      const m = d.data();
      const files = (m.attachments ?? []).map((a: { name: string }) => a.name);
      b.set(db.doc(`search/${d.id}`), {
        channelId: d.ref.parent.parent!.id,
        messageId: d.id,
        threadParentId: m.threadParentId ?? null,
        authorId: m.authorId,
        createdAt: m.createdAt,
        terms: buildTerms(m.text ?? '', files),
        snippet: snippet(m.text ?? '', names),
        hasFile: files.length > 0,
      });
    }
    await b.commit();
  }
}

/** Realistic conversation for screenshots / manual testing (mirrors the design mockups). */
async function seedDemo(db: FirebaseFirestore.Firestore, now: number) {
  const b = db.batch();
  const at = (minAgo: number) => Timestamp.fromMillis(now - minAgo * 60_000);
  const msg = (cid: string, id: string, authorId: string, text: string, minAgo: number, extra: Record<string, unknown> = {}) =>
    b.set(db.doc(`channels/${cid}/messages/${id}`), {
      text,
      authorId,
      createdAt: at(minAgo),
      threadParentId: null,
      attachments: [],
      mentions: [],
      replyCount: 0,
      replyUserIds: [],
      seeded: true,
      ...extra,
    });
  const E = CHANNELS.engineering;
  b.update(db.doc(`channels/${E}`), { memberIds: ['uAdmin', 'uMember', 'uMember2'] });
  msg(E, 'eng0', 'uMember', 'Plan for today: **finish the upload flow** and lock down storage.\n- Composer: drag and drop, paste images\n- Storage rules scoped to channel members\n- 50 MB cap per file', 60);
  msg(
    E,
    'eng1',
    'uAdmin',
    'Draft of `storage.rules` for attachments:\n```\nmatch /channels/{channelId}/{messageId}/{file} {\n  allow read:  if isMember(channelId);\n  allow write: if isMember(channelId)\n    && request.resource.size < 50 * 1024 * 1024;\n}\n```',
    40,
    { replyCount: 3, lastReplyAt: at(8), replyUserIds: ['uMember2', 'uMember'] },
  );
  msg(E, 'eng1r1', 'uMember2', 'Should we also block executables? Something like a `contentType` check.', 32, { threadParentId: 'eng1' });
  msg(E, 'eng1r2', 'uAdmin', 'Good call, adding it to the PR.', 29, { threadParentId: 'eng1' });
  msg(E, 'eng1r3', 'uMember', 'Also add a test for a non-member trying to read. That is the one that matters most.', 8, { threadParentId: 'eng1' });
  msg(E, 'eng2', 'uMember', '<@uMember2> new composer mockup and the upload limits doc. Can you review before lunch?', 12, { mentions: ['uMember2'] });
  msg(E, 'eng3', 'uMember2', 'On it 👍 will leave comments in the thread.', 5);
  b.update(db.doc(`channels/${E}`), { lastMessageAt: at(5), lastMessage: { text: 'On it 👍 will leave comments in the thread.', authorId: 'uMember2' } });

  const DM = 'dm_uAdmin_uMember2';
  b.set(db.doc(`channels/${DM}`), {
    name: '',
    type: 'dm',
    memberIds: ['uAdmin', 'uMember2'],
    createdBy: 'uAdmin',
    archived: false,
    createdAt: at(300),
    lastMessageAt: at(3),
    lastMessage: { text: 'Sounds good, merging after lunch', authorId: 'uMember2' },
  });
  msg(DM, 'd1', 'uAdmin', 'Can you take a look at the invite flow when you have a minute?', 20);
  msg(DM, 'd2', 'uMember2', 'Sure. The expiry copy reads well. One nit: say *7 days* explicitly.', 15);
  msg(DM, 'd3', 'uMember2', 'Sounds good, merging after lunch', 3);

  b.set(db.doc('users/uMember2/activity/a1'), {
    kind: 'mention',
    channelId: E,
    messageId: 'eng2',
    threadParentId: null,
    authorId: 'uMember',
    preview: '@Tomás Araya new composer mockup and the upload limits doc. Can you review before lunch?',
    createdAt: at(12),
  });
  b.set(db.doc('users/uMember2/activity/a2'), {
    kind: 'reply',
    channelId: E,
    messageId: 'eng1r3',
    threadParentId: 'eng1',
    authorId: 'uMember',
    preview: 'Also add a test for a non-member trying to read. That is the one that matters most.',
    createdAt: at(8),
  });
  await b.commit();
}

/** Test helper: direct admin write to Firestore (e.g. expire an invite). */
export async function adminDb() {
  return admin().db;
}
export { FieldValue, Timestamp };
