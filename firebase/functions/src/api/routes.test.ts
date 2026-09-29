import { describe, expect, it } from 'vitest';
import { ApiError, matchRoute, messageJson, normalizePath, pageParams, parseDmBody, parsePostBody, userJson } from './routes.js';

const err = (fn: () => unknown) => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error('expected an error');
};

describe('routing', () => {
  it('serves under /api (Hosting) and / (the function), ignoring trailing slashes', () => {
    expect(normalizePath('/api/v1/me')).toBe('/v1/me');
    expect(normalizePath('/v1/me/')).toBe('/v1/me');
    expect(normalizePath('/api')).toBe('/');
  });

  it('matches every endpoint with its scope and params', () => {
    expect(matchRoute('GET', '/api/v1/me')).toMatchObject({ name: 'me', scope: 'read', params: [] });
    expect(matchRoute('GET', '/v1/channels/c1/messages')).toMatchObject({ name: 'listMessages', params: ['c1'] });
    expect(matchRoute('POST', '/v1/channels/c1/messages')).toMatchObject({ name: 'postMessage', scope: 'write' });
    expect(matchRoute('GET', '/v1/channels/c1/messages/m9/replies')).toMatchObject({ name: 'listReplies', params: ['c1', 'm9'] });
    expect(matchRoute('POST', '/v1/dms')).toMatchObject({ name: 'openDm', scope: 'write' });
    expect(matchRoute('GET', '/v1/search')).toMatchObject({ name: 'search', scope: 'read' });
  });

  it('404s unknown paths and 405s wrong methods', () => {
    expect(err(() => matchRoute('GET', '/v1/nope')).status).toBe(404);
    expect(err(() => matchRoute('GET', '/v1/channels/a/b/c/d/e')).status).toBe(404);
    expect(err(() => matchRoute('DELETE', '/v1/me')).status).toBe(405);
    expect(err(() => matchRoute('GET', '/v1/channels/../users')).status).toBe(404);
  });
});

describe('input validation', () => {
  it('pages between 1 and 100 with a millisecond cursor', () => {
    expect(pageParams({})).toEqual({ limit: 50, before: null });
    expect(pageParams({ limit: '10', before: '1700000000000' })).toEqual({ limit: 10, before: 1700000000000 });
    expect(err(() => pageParams({ limit: '0' })).status).toBe(400);
    expect(err(() => pageParams({ limit: '101' })).status).toBe(400);
    expect(err(() => pageParams({ before: 'yesterday' })).status).toBe(400);
  });

  it('checks message bodies', () => {
    expect(parsePostBody({ text: 'hi' })).toEqual({ text: 'hi', threadId: null, alsoToChannel: false });
    expect(parsePostBody({ text: 'r', threadId: 'm1', alsoToChannel: true })).toEqual({ text: 'r', threadId: 'm1', alsoToChannel: true });
    expect(err(() => parsePostBody(null)).status).toBe(400);
    expect(err(() => parsePostBody({ text: '  ' })).message).toMatch(/text/);
    expect(err(() => parsePostBody({ text: 'x'.repeat(40_001) })).status).toBe(400);
    expect(err(() => parsePostBody({ text: 'x', threadId: '../x' })).status).toBe(400);
    expect(err(() => parsePostBody({ text: 'x', alsoToChannel: true })).message).toMatch(/thread/);
  });

  it('checks DM members', () => {
    expect(parseDmBody({ userIds: ['b', 'a', 'b', 'me'] }, 'me')).toEqual(['b', 'a']);
    expect(parseDmBody({ userIds: ['me'] }, 'me')).toEqual([]);
    expect(err(() => parseDmBody({ userIds: [] }, 'me')).status).toBe(400);
    expect(err(() => parseDmBody({ userIds: Array.from({ length: 9 }, (_, i) => `u${i}`) }, 'me')).message).toMatch(/9 people/);
  });
});

describe('response shapes', () => {
  it('never leaks internal fields', () => {
    const u = userJson('u1', { displayName: 'Ana', email: 'a@x.co', role: 'member', status: 'active', emailLower: 'a@x.co', dnd: {}, quickReactions: [] });
    expect(Object.keys(u).sort()).toEqual(['customStatus', 'email', 'id', 'name', 'photoUrl', 'role', 'status', 'timeZone', 'title']);
    const m = messageJson('c1', 'm1', { text: 'x', authorId: 'u1', attachments: [{ name: 'f.pdf', size: 3, contentType: 'application/pdf', storagePath: 'channels/c1/m1/f.pdf' }], seeded: true });
    expect(m.attachments).toEqual([{ name: 'f.pdf', size: 3, contentType: 'application/pdf' }]);
    expect(m).not.toHaveProperty('seeded');
  });

  it('hides the text of deleted messages', () => {
    expect(messageJson('c1', 'm1', { text: 'secret', deleted: true }).text).toBe('');
  });
});
