import { describe, expect, it } from 'vitest';
import { hashToken, isTokenFormat, newToken, newTypingKey, parseScopes } from './tokens.js';

describe('API tokens', () => {
  it('are random, well-formed and stored only as a hash', () => {
    const a = newToken();
    const b = newToken();
    expect(a).not.toBe(b);
    expect(isTokenFormat(a)).toBe(true);
    expect(isTokenFormat('flk_short')).toBe(false);
    expect(isTokenFormat(`xyz_${a.slice(4)}`)).toBe(false);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(a)).toBe(hashToken(a));
    expect(hashToken(a)).not.toBe(hashToken(b));
  });

  it('accept only read/write scopes; write implies read', () => {
    expect(parseScopes(['read'])).toEqual(['read']);
    expect(parseScopes(['write'])).toEqual(['read', 'write']);
    expect(parseScopes(['read', 'write', 'read'])).toEqual(['read', 'write']);
    expect(parseScopes([])).toBeNull();
    expect(parseScopes(['admin'])).toBeNull();
    expect(parseScopes('read')).toBeNull();
  });

  it('typing keys match the rules', () => {
    expect(newTypingKey()).toMatch(/^t_[A-Za-z0-9]{24}$/);
  });
});
