import { useEffect, useState } from 'react';
import { USE_EMULATORS } from '../firebase';
import { isNewer } from '../lib/version';

export const FLACK_VERSION = __FLACK_VERSION__;

export interface Release {
  version: string;
  url: string;
}

const CACHE_KEY = 'flack:latestRelease';
const CACHE_MS = 12 * 60 * 60 * 1000;

function readCache(): (Release & { at: number }) | null {
  try {
    const v = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    return v && Date.now() - v.at < CACHE_MS ? v : null;
  } catch {
    return null;
  }
}

/**
 * The latest Flack release on GitHub when it's newer than this build (for the admin page).
 * Checked at most every 12 hours per browser; failures just mean no notice. Emulator builds
 * only check when a test turns it on (localStorage "flack:updateCheck" = "1").
 */
export function useUpdateAvailable(enabled: boolean): Release | null {
  const [latest, setLatest] = useState<Release | null>(() => readCache());

  useEffect(() => {
    if (!enabled || !__FLACK_UPDATE_REPO__ || readCache()) return;
    try {
      if (USE_EMULATORS && localStorage.getItem('flack:updateCheck') !== '1') return;
    } catch {
      return;
    }
    let alive = true;
    fetch(`https://api.github.com/repos/${__FLACK_UPDATE_REPO__}/releases/latest`, { headers: { Accept: 'application/vnd.github+json' } })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { tag_name?: string; html_url?: string } | null) => {
        if (!alive || !j?.tag_name || !j.html_url) return;
        const release = { version: j.tag_name.replace(/^v/, ''), url: j.html_url };
        try {
          localStorage.setItem(CACHE_KEY, JSON.stringify({ ...release, at: Date.now() }));
        } catch {
          // ignore
        }
        setLatest(release);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [enabled]);

  return latest && isNewer(latest.version, FLACK_VERSION) ? latest : null;
}
