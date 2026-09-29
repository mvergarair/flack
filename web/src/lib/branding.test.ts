import { describe, expect, it } from 'vitest';
import { ACCENT_PRESETS, SIDEBAR_PRESETS, accentVars, accentWarning, brandingCss, contrast, isHex, mix, readableOn, sidebarVars, workspaceName, workspaceTagline } from './branding';

describe('colors', () => {
  it('validates and mixes hex colors', () => {
    expect(isHex('#1f5fc4')).toBe(true);
    expect(isHex('#fff')).toBe(false);
    expect(isHex('red')).toBe(false);
    expect(isHex('#1f5fc4;}body{display:none')).toBe(false);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('#808080');
    expect(mix('#123456', '#123456', 0.3)).toBe('#123456');
  });

  it('picks readable text for any background', () => {
    expect(readableOn('#ffffff')).toBe('#111417');
    expect(readableOn('#1e2b2f')).toBe('#ffffff');
    expect(readableOn('#ffd54f')).toBe('#111417');
    for (const c of [...ACCENT_PRESETS, ...SIDEBAR_PRESETS]) expect(contrast(c, readableOn(c))).toBeGreaterThanOrEqual(4.5);
  });

  it('keeps accents readable in dark mode', () => {
    for (const c of [...ACCENT_PRESETS, '#000080', '#222222']) {
      const { dark, light } = accentVars(c);
      expect(contrast(dark['--accent'], '#1b2024')).toBeGreaterThanOrEqual(4);
      expect(contrast(light['--accent'], light['--on-accent'])).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('derives a legible sidebar from light or dark backgrounds', () => {
    for (const bg of SIDEBAR_PRESETS) {
      const v = sidebarVars(bg, '#1f5fc4');
      expect(contrast(v['--side-text'], bg)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(v['--side-strong'], bg)).toBeGreaterThanOrEqual(7);
    }
  });

  it('warns about accents that are hard to read on white', () => {
    expect(accentWarning('#ffd54f')).toMatch(/hard to read/);
    expect(accentWarning('#1f5fc4')).toBeNull();
  });
});

describe('branding css', () => {
  it('is empty without colors and scoped to both schemes with them', () => {
    expect(brandingCss({ name: 'Acme' })).toBe('');
    const css = brandingCss({ accent: '#c2185b', sidebar: '#113a2e' });
    expect(css).toContain(':root{--accent:#c2185b');
    expect(css).toContain('--side-bg:#113a2e');
    expect(css).toContain('@media (prefers-color-scheme: dark)');
  });

  it('ignores anything that is not a hex color (no CSS injection)', () => {
    expect(brandingCss({ accent: 'red;}body{display:none' })).toBe('');
  });
});

describe('names', () => {
  it('fall back to Flack defaults', () => {
    expect(workspaceName(null)).toBe('Flack');
    expect(workspaceName({ name: '  ' })).toBe('Flack');
    expect(workspaceName({ name: 'Acme' })).toBe('Acme');
    expect(workspaceTagline({})).toBe('Invite-only team chat');
  });
});
