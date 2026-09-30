/**
 * A tripwire for runaway listeners. A Firestore listener that fires over and over while nothing
 * is happening is almost always an effect that writes something it (indirectly) watches: each
 * write triggers the listener, which re-renders, which writes again. It silently burns database
 * reads and writes (it once used ~45% of the free daily quota from one open pane).
 *
 * snapshot.ts records every snapshot here. Past the limit, the listener is reported once: an
 * error in the console, and window.__flackLoops for the end-to-end tests, which fail on it.
 */
export const WINDOW_MS = 10_000;
export const MAX_FIRES = 20;

export class ListenerWatch {
  private hits = new Map<string, number[]>();
  private flagged = new Set<string>();

  /** Records a snapshot for `key`; returns the count in the window the first time it's over the limit. */
  record(key: string, now = Date.now()): number | null {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
    recent.push(now);
    this.hits.set(key, recent);
    if (recent.length > MAX_FIRES && !this.flagged.has(key)) {
      this.flagged.add(key);
      return recent.length;
    }
    return null;
  }
}

const watch = new ListenerWatch();

declare global {
  interface Window {
    __flackLoops?: string[];
  }
}

export function recordSnapshot(key: string): void {
  const count = watch.record(key);
  if (count === null) return;
  console.error(
    `Flack: the listener on ${key} fired ${count} times in ${WINDOW_MS / 1000}s. That usually means an effect writes something it's watching, which burns database reads.`,
  );
  window.__flackLoops = [...(window.__flackLoops ?? []), key];
}
