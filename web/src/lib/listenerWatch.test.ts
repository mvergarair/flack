import { describe, expect, it } from 'vitest';
import { ListenerWatch, MAX_FIRES, WINDOW_MS } from './listenerWatch';

describe('ListenerWatch', () => {
  it('flags a listener that fires more than the limit within the window, once', () => {
    const w = new ListenerWatch();
    for (let i = 0; i < MAX_FIRES; i++) expect(w.record('users/u/reads/c', i * 100)).toBeNull();
    expect(w.record('users/u/reads/c', MAX_FIRES * 100)).toBe(MAX_FIRES + 1);
    // Reported once, however long it keeps going.
    expect(w.record('users/u/reads/c', MAX_FIRES * 100 + 50)).toBeNull();
  });

  it('ignores the same number of snapshots spread over time, and other listeners', () => {
    const w = new ListenerWatch();
    const spacing = WINDOW_MS / MAX_FIRES + 10;
    for (let i = 0; i < MAX_FIRES * 3; i++) expect(w.record('channels/c/messages', i * spacing)).toBeNull();
    for (let i = 0; i < MAX_FIRES; i++) {
      expect(w.record(`a${i % 2}`, i)).toBeNull();
    }
  });
});
