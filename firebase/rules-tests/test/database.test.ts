import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { get, ref, remove, serverTimestamp, set, type Database } from 'firebase/database';
import { as, makeEnv } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => env.clearDatabase());

const rdb = (ctx: ReturnType<typeof as> | ReturnType<RulesTestEnvironment['unauthenticatedContext']>) => ctx.database() as unknown as Database;
const online = { state: 'online', lastChanged: serverTimestamp() };
const KEY = 't_' + 'a1B2c3D4e5F6g7H8i9J0k1';

describe('presence', () => {
  it('users write their own status and read everyone’s', async () => {
    await assertSucceeds(set(ref(rdb(as(env, 'member')), 'status/member/dev1'), online));
    await assertSucceeds(set(ref(rdb(as(env, 'member')), 'status/member/dev1'), { ...online, state: 'away' }));
    await assertSucceeds(get(ref(rdb(as(env, 'member2')), 'status')));
  });

  it("nobody writes someone else's status", async () => {
    await assertFails(set(ref(rdb(as(env, 'member')), 'status/member2/dev1'), online));
    await assertFails(set(ref(rdb(as(env, 'admin')), 'status/member/dev1'), { state: 'offline', lastChanged: 1 }));
  });

  it('status must be well-formed', async () => {
    const db = rdb(as(env, 'member'));
    await assertFails(set(ref(db, 'status/member/dev1'), { state: 'busy', lastChanged: 1 }));
    await assertFails(set(ref(db, 'status/member/dev1'), { state: 'online' }));
    await assertFails(set(ref(db, 'status/member/dev1'), { state: 'online', lastChanged: 1, extra: true }));
    // The channel on screen is private (viewing/), never in the readable status tree.
    await assertFails(set(ref(db, 'status/member/dev1'), { state: 'online', lastChanged: 1, activeChannel: 'dm_member_member2' }));
  });

  it('the channel on screen is write-only for its owner (only functions read it)', async () => {
    const db = rdb(as(env, 'member'));
    await assertSucceeds(set(ref(db, 'viewing/member/dev1'), 'dm_member_member2'));
    await assertSucceeds(remove(ref(db, 'viewing/member/dev1')));
    await assertFails(get(ref(db, 'viewing/member')));
    await assertFails(get(ref(rdb(as(env, 'member2')), 'viewing')));
    await assertFails(set(ref(rdb(as(env, 'member2')), 'viewing/member/dev1'), 'pub'));
    await assertFails(set(ref(db, 'viewing/member/dev1'), { channel: 'pub' }));
  });

  it('signed-out and deactivated users can neither read nor write', async () => {
    await assertFails(get(ref(rdb(env.unauthenticatedContext()), 'status')));
    const gone = env.authenticatedContext('gone', { role: 'member', active: false });
    await assertFails(get(ref(rdb(gone), 'status')));
    await assertFails(set(ref(rdb(gone), 'status/gone/dev1'), online));
  });

  it('device ids are bounded and users can clear their own node (legacy cleanup)', async () => {
    const db = rdb(as(env, 'member'));
    await assertFails(set(ref(db, `status/member/${'x'.repeat(41)}`), online));
    await assertSucceeds(set(ref(db, 'status/member/dev2'), online));
    await assertSucceeds(set(ref(db, 'status/member'), null));
    await assertFails(set(ref(rdb(as(env, 'member2')), 'status/member'), null));
  });

  it('nothing outside status/ and typing/ is readable or writable', async () => {
    await assertFails(get(ref(rdb(as(env, 'admin')), '/')));
    await assertFails(set(ref(rdb(as(env, 'admin')), 'other/x'), 1));
  });
});

describe('typing', () => {
  it('users set and clear their own typing flag under the channel’s secret key', async () => {
    const db = rdb(as(env, 'member'));
    await assertSucceeds(set(ref(db, `typing/${KEY}/member`), serverTimestamp()));
    await assertSucceeds(get(ref(rdb(as(env, 'member2')), `typing/${KEY}`)));
    await assertSucceeds(remove(ref(db, `typing/${KEY}/member`)));
    // Threads use "{typingKey}:{threadId}".
    await assertSucceeds(set(ref(db, `typing/${KEY}:m1/member`), serverTimestamp()));
  });

  it('raw channel ids are not usable, and the key list is not readable', async () => {
    const db = rdb(as(env, 'member'));
    await assertFails(set(ref(db, 'typing/dm_member_member2/member'), serverTimestamp()));
    await assertFails(get(ref(db, 'typing/dm_member_member2')));
    await assertFails(get(ref(db, 'typing')));
  });

  it("can't fake someone else typing or write junk", async () => {
    await assertFails(set(ref(rdb(as(env, 'member')), `typing/${KEY}/member2`), serverTimestamp()));
    await assertFails(set(ref(rdb(as(env, 'member')), `typing/${KEY}/member`), 'yes'));
  });
});

describe('Flackbot drafts', () => {
  it('only their owner reads them, and nobody writes them (functions only)', async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await set(ref(ctx.database() as unknown as Database, 'botDrafts/member'), { status: 'Thinking', text: '', questionId: 'q', conversationId: 'c', at: 1 });
    });
    await assertSucceeds(get(ref(rdb(as(env, 'member')), 'botDrafts/member')));
    await assertFails(get(ref(rdb(as(env, 'member2')), 'botDrafts/member')));
    await assertFails(get(ref(rdb(as(env, 'member')), 'botDrafts')));
    await assertFails(set(ref(rdb(as(env, 'member')), 'botDrafts/member'), { status: 'fake', text: 'hi' }));
    await assertFails(remove(ref(rdb(as(env, 'member')), 'botDrafts/member')));
  });
});
