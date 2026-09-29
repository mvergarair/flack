import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { doc, onSnapshot, serverTimestamp, setDoc } from 'firebase/firestore';
import { httpsCallable } from 'firebase/functions';
import { db, functions } from '../firebase';
import { brandingCss, workspaceName, workspaceTagline, type Branding } from '../lib/branding';

const CACHE_KEY = 'flack:branding';
const DEFAULT_FAVICON = '/icons/favicon.svg';
const DEFAULT_THEME = '#1E2B2F';

interface BrandingState {
  branding: Branding;
  /** Workspace name (defaults to "Flack"). */
  name: string;
  tagline: string;
}

const BrandingContext = createContext<BrandingState>({ branding: {}, name: workspaceName(null), tagline: workspaceTagline(null) });

function readCache(): Branding {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Branding;
  } catch {
    return {};
  }
}

/**
 * Loads config/branding (public: the sign-in page needs it) and applies it app-wide: colors as
 * CSS variables, the logo as the tab icon, the sidebar color as the browser theme color. The
 * last value is cached locally so reloads don't flash the default look.
 */
export function BrandingProvider({ children }: { children: ReactNode }) {
  const [branding, setBranding] = useState<Branding>(readCache);

  useEffect(
    () =>
      onSnapshot(
        doc(db, 'config', 'branding'),
        (snap) => {
          const b = (snap.data() ?? {}) as Branding;
          setBranding(b);
          try {
            localStorage.setItem(CACHE_KEY, JSON.stringify(b));
          } catch {
            // Storage full or blocked: branding still applies for this visit.
          }
        },
        () => undefined,
      ),
    [],
  );

  useEffect(() => {
    let style = document.getElementById('flack-branding') as HTMLStyleElement | null;
    if (!style) {
      style = document.createElement('style');
      style.id = 'flack-branding';
      document.head.appendChild(style);
    }
    style.textContent = brandingCss(branding);

    const icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    if (icon) {
      icon.href = branding.logo || DEFAULT_FAVICON;
      icon.type = branding.logo ? branding.logo.slice(5, branding.logo.indexOf(';')) : 'image/svg+xml';
    }
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', branding.sidebar || DEFAULT_THEME);
  }, [branding]);

  return (
    <BrandingContext.Provider value={{ branding, name: workspaceName(branding), tagline: workspaceTagline(branding) }}>{children}</BrandingContext.Provider>
  );
}

export const useBranding = () => useContext(BrandingContext);

/** Sets the tab title to "<title> · <workspace name>". */
export function usePageTitle(title: string | null) {
  const { name } = useBranding();
  useEffect(() => {
    document.title = title ? `${title} · ${name}` : name;
  }, [title, name]);
}

/** Admins: save the branding (validated again by the security rules). */
export async function saveBranding(uid: string, b: Branding) {
  await setDoc(doc(db, 'config', 'branding'), {
    name: b.name?.trim() ?? '',
    tagline: b.tagline?.trim() ?? '',
    logo: b.logo ?? null,
    accent: b.accent ?? null,
    sidebar: b.sidebar ?? null,
    updatedAt: serverTimestamp(),
    updatedBy: uid,
  });
}

/** Admins: which public channels new members join (checked server-side). */
export async function setDefaultChannels(channelIds: string[]) {
  await httpsCallable<{ channelIds: string[] }>(functions, 'setdefaultchannels')({ channelIds });
}

/** Resizes an uploaded image to a 256px square (contained) data URL for the logo. */
export async function logoFromFile(file: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(file.type)) throw new Error('Use a PNG, JPG or WebP image.');
  if (file.size > 5 * 1024 * 1024) throw new Error('That image is over 5 MB.');
  const bitmap = await createImageBitmap(file);
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const scale = Math.min(size / bitmap.width, size / bitmap.height);
  const w = bitmap.width * scale;
  const h = bitmap.height * scale;
  ctx.drawImage(bitmap, (size - w) / 2, (size - h) / 2, w, h);
  bitmap.close();
  // WebP where the browser can encode it (smaller), PNG otherwise (e.g. older Safari).
  let url = canvas.toDataURL('image/webp', 0.9);
  if (!url.startsWith('data:image/webp')) url = canvas.toDataURL('image/png');
  if (url.length > 200_000) throw new Error('That image is too detailed to use as a logo. Try a simpler one.');
  return url;
}
