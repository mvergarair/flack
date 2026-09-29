import { afterAll, beforeAll, beforeEach, describe, it } from 'vitest';
import { assertFails, assertSucceeds, type RulesTestEnvironment } from '@firebase/rules-unit-testing';
import { deleteObject, getBytes, ref, uploadBytes, type FirebaseStorage } from 'firebase/storage';
import { as, makeEnv, seed, type Who } from './setup.ts';

let env: RulesTestEnvironment;
beforeAll(async () => {
  env = await makeEnv();
});
afterAll(async () => env.cleanup());
beforeEach(async () => {
  await seed(env);
  await env.clearStorage();
});

const st = (who: Who) => as(env, who).storage() as unknown as FirebaseStorage;
const bytes = (n = 16) => new Uint8Array(n).fill(7);
const up = (who: Who, path: string, opts: { uploaderId?: string | null; type?: string; size?: number } = {}) =>
  uploadBytes(ref(st(who), path), bytes(opts.size), {
    contentType: opts.type ?? 'text/plain',
    customMetadata: opts.uploaderId === null ? {} : { uploaderId: opts.uploaderId ?? who },
  });

describe('attachment uploads', () => {
  it('channel members upload into their channel', async () => {
    await assertSucceeds(up('member', 'channels/pub/msg1/notes.txt'));
    await assertSucceeds(up('member2', 'channels/priv/msg1/photo.png', { type: 'image/png' }));
    await assertSucceeds(up('member', 'channels/dm_member_member2/msg1/a.pdf', { type: 'application/pdf' }));
  });

  it('non-members and deactivated users cannot upload', async () => {
    await assertFails(up('outsider', 'channels/pub/msg1/x.txt'));
    await assertFails(up('admin', 'channels/priv/msg1/x.txt'));
    await assertFails(up('gone', 'channels/pub/msg1/x.txt'));
  });

  it('uploader metadata must be present and truthful', async () => {
    await assertFails(up('member', 'channels/pub/msg1/x.txt', { uploaderId: null }));
    await assertFails(up('member', 'channels/pub/msg1/x.txt', { uploaderId: 'admin' }));
  });

  it('executables are blocked by extension and content type', async () => {
    await assertFails(up('member', 'channels/pub/msg1/setup.exe', { type: 'application/octet-stream' }));
    await assertFails(up('member', 'channels/pub/msg1/run.SH'));
    await assertFails(up('member', 'channels/pub/msg1/innocent.bin', { type: 'application/x-msdownload' }));
  });

  it('files over 50 MB are rejected', async () => {
    await assertFails(up('member', 'channels/pub/msg1/big.bin', { size: 50 * 1024 * 1024 + 1, type: 'application/octet-stream' }));
  }, 60_000);

  it('nothing can be written outside channels/', async () => {
    await assertFails(up('admin', 'avatars/admin.png', { type: 'image/png' }));
    await assertFails(up('member', 'channels/pub/notes.txt'));
  });
});

describe('attachment downloads and deletes', () => {
  beforeEach(async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      const s = ctx.storage() as unknown as FirebaseStorage;
      await uploadBytes(ref(s, 'channels/priv/m1/secret.txt'), bytes(), { customMetadata: { uploaderId: 'member2' } });
    });
  });

  it('members read; non-members and deactivated users cannot', async () => {
    await assertSucceeds(getBytes(ref(st('member'), 'channels/priv/m1/secret.txt')));
    await assertFails(getBytes(ref(st('admin'), 'channels/priv/m1/secret.txt')));
    await assertFails(getBytes(ref(st('outsider'), 'channels/priv/m1/secret.txt')));
    await assertFails(getBytes(ref(env.unauthenticatedContext().storage() as unknown as FirebaseStorage, 'channels/priv/m1/secret.txt')));
  });

  it('only the uploader deletes directly (functions clean up the rest)', async () => {
    await assertFails(deleteObject(ref(st('member'), 'channels/priv/m1/secret.txt')));
    await assertSucceeds(deleteObject(ref(st('member2'), 'channels/priv/m1/secret.txt')));
  });
});
