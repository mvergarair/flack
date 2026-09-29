/** "v1.2.3" / "1.2.3" → [1, 2, 3]; null if it isn't a plain version. */
export function parseVersion(v: string): [number, number, number] | null {
  const m = v.trim().match(/^v?(\d+)\.(\d+)\.(\d+)$/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** True when `latest` is a newer version than `current`. */
export function isNewer(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (!a || !b) return false;
  for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] > b[i];
  return false;
}
