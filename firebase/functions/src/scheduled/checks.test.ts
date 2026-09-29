import { describe, expect, it } from 'vitest';
import { cannotSend } from './checks.js';
import type { ChannelDoc, MessageDoc, UserDoc } from '../lib/types.js';

const user = { status: 'active' } as UserDoc;
const channel = { memberIds: ['u1'], archived: false } as unknown as ChannelDoc;
const base = { uid: 'u1', user, channel, threadParentId: null, parent: undefined };

describe('cannotSend', () => {
  it('allows an active member posting to a live channel', () => {
    expect(cannotSend(base)).toBeNull();
    expect(cannotSend({ ...base, threadParentId: 'p', parent: { threadParentId: null } as MessageDoc })).toBeNull();
  });
  it('explains every blocker', () => {
    expect(cannotSend({ ...base, user: { status: 'deactivated' } as UserDoc })).toMatch(/not active/);
    expect(cannotSend({ ...base, channel: undefined })).toMatch(/no longer exists/);
    expect(cannotSend({ ...base, channel: { ...channel, memberIds: ['u2'] } })).toMatch(/no longer a member/);
    expect(cannotSend({ ...base, channel: { ...channel, archived: true } })).toMatch(/archived/);
    expect(cannotSend({ ...base, threadParentId: 'p' })).toMatch(/thread/);
  });
});

