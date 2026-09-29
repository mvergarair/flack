// Combines per-device presence into one status per person. Mirrored in
// firebase/functions/src/lib/presence.ts — keep in sync; both copies are unit-tested.

export type PresenceState = 'online' | 'away' | 'offline';

export interface AggregatedPresence {
  state: PresenceState;
  /** Latest change across devices (for "last online"). */
  lastChanged: number;
  /** Channels open on screen on devices that are active right now. */
  activeChannels: string[];
  /** Back-compat for code that reads a single channel. */
  activeChannel?: string;
}

interface DeviceEntry {
  state: PresenceState;
  lastChanged: number;
  activeChannel?: string;
}

const RANK: Record<PresenceState, number> = { online: 2, away: 1, offline: 0 };
const isEntry = (v: unknown): v is DeviceEntry =>
  !!v && typeof v === 'object' && typeof (v as DeviceEntry).state === 'string' && typeof (v as DeviceEntry).lastChanged === 'number';

/**
 * `node` is status/{uid}: { deviceId: {state, lastChanged, activeChannel} } (or the legacy
 * single-entry shape). Active on any device wins, then away, then offline.
 */
export function aggregatePresence(node: unknown): AggregatedPresence | undefined {
  if (!node || typeof node !== 'object') return undefined;
  const devices: DeviceEntry[] = isEntry(node) ? [node] : Object.values(node as Record<string, unknown>).filter(isEntry);
  if (devices.length === 0) return undefined;
  const best = devices.reduce((a, b) => (RANK[b.state] > RANK[a.state] ? b : a));
  const activeChannels = devices.filter((d) => d.state === 'online' && d.activeChannel).map((d) => d.activeChannel!);
  return {
    state: best.state,
    lastChanged: Math.max(...devices.map((d) => d.lastChanged)),
    activeChannels,
    activeChannel: activeChannels[0],
  };
}
