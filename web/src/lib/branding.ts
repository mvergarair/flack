// Workspace branding set by admins (config/branding): name, logo, sign-in message and two
// colors. Everything else (hover shades, soft backgrounds, readable text) is derived here so
// any color an admin picks stays legible in light and dark mode.

export const DEFAULT_NAME = 'Flack';
export const DEFAULT_TAGLINE = 'Invite-only team chat';
export const NAME_MAX = 40;
export const TAGLINE_MAX = 140;
export const LOGO_MAX_CHARS = 200_000;

export interface Branding {
  name?: string;
  tagline?: string;
  /** Square data URL (PNG / WebP / JPEG), resized in the browser before saving. */
  logo?: string | null;
  /** #rrggbb */
  accent?: string | null;
  /** #rrggbb */
  sidebar?: string | null;
}

export const ACCENT_PRESETS = ['#1f5fc4', '#6d4ad6', '#c2185b', '#d9540f', '#b8860b', '#1d7a4e', '#0f7c8a', '#3e474d'];
export const SIDEBAR_PRESETS = ['#1e2b2f', '#1b1f3a', '#3b1f2b', '#23303f', '#2d2a24', '#113a2e', '#4a154b', '#f4f5f7'];

export const isHex = (c: unknown): c is string => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c);

function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: [number, number, number]): string {
  return `#${[r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')).join('')}`;
}

/** `a` blended toward `b` by `t` (0 = a, 1 = b). */
export function mix(a: string, b: string, t: number): string {
  const [x, y] = [rgb(a), rgb(b)];
  return toHex([x[0] + (y[0] - x[0]) * t, x[1] + (y[1] - x[1]) * t, x[2] + (y[2] - x[2]) * t]);
}

/** WCAG relative luminance. */
export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)].sort((m, n) => n - m);
  return (x + 0.05) / (y + 0.05);
}

/** Whichever of near-white / near-black reads better on `bg`. */
export function readableOn(bg: string): string {
  return contrast(bg, '#ffffff') >= contrast(bg, '#111417') ? '#ffffff' : '#111417';
}

const LIGHT_BG = '#ffffff';
const DARK_BG = '#1b2024';

/** CSS variables for the accent color (light and dark mode). */
export function accentVars(accent: string): { light: Record<string, string>; dark: Record<string, string> } {
  // In dark mode, lift dark accents toward white until they read on the dark background.
  let darkAccent = accent;
  for (let t = 0.15; contrast(darkAccent, DARK_BG) < 4 && t <= 0.9; t += 0.15) darkAccent = mix(accent, '#ffffff', t);
  return {
    light: {
      '--accent': accent,
      '--accent-hover': mix(accent, '#000000', 0.18),
      '--accent-soft': mix(accent, LIGHT_BG, 0.9),
      '--accent-soft-border': mix(accent, LIGHT_BG, 0.65),
      '--on-accent': readableOn(accent),
    },
    dark: {
      '--accent': darkAccent,
      '--accent-hover': mix(darkAccent, '#ffffff', 0.18),
      '--accent-soft': mix(darkAccent, DARK_BG, 0.82),
      '--accent-soft-border': mix(darkAccent, DARK_BG, 0.6),
      '--on-accent': readableOn(darkAccent),
    },
  };
}

/** CSS variables for the sidebar, derived from its background (same in both modes). */
export function sidebarVars(bg: string, accent: string): Record<string, string> {
  const fg = readableOn(bg);
  return {
    '--side-bg': bg,
    '--side-text': mix(fg, bg, 0.18),
    '--side-muted': mix(fg, bg, 0.38),
    '--side-hash': mix(fg, bg, 0.45),
    '--side-raised': mix(bg, fg, 0.12),
    '--side-hover': mix(bg, fg, 0.07),
    '--side-active': accent,
    '--side-strong': fg,
  };
}

/** A stylesheet applying the branding colors over the defaults (both color schemes). */
export function brandingCss(b: Branding): string {
  const rules = (vars: Record<string, string>) =>
    Object.entries(vars)
      .map(([k, v]) => `${k}:${v}`)
      .join(';');
  const light: Record<string, string> = {};
  const dark: Record<string, string> = {};
  if (isHex(b.accent)) {
    const a = accentVars(b.accent);
    Object.assign(light, a.light);
    Object.assign(dark, a.dark);
  }
  if (isHex(b.sidebar)) {
    const active = isHex(b.accent) ? b.accent : '#2f6fd6';
    Object.assign(light, sidebarVars(b.sidebar, active));
    Object.assign(dark, sidebarVars(b.sidebar, active));
  }
  if (!Object.keys(light).length) return '';
  return `:root{${rules(light)}}@media (prefers-color-scheme: dark){:root{${rules(dark)}}}`;
}

/** Warning for colors that make links and buttons hard to read on white, else null. */
export function accentWarning(accent: string): string | null {
  return contrast(accent, LIGHT_BG) < 3 ? 'This color is hard to read on white; links and buttons may be hard to see.' : null;
}

export const workspaceName = (b: Branding | null | undefined) => b?.name?.trim() || DEFAULT_NAME;
export const workspaceTagline = (b: Branding | null | undefined) => b?.tagline?.trim() || DEFAULT_TAGLINE;
