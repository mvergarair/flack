// Renders web/public/icons/*.png from favicon.svg with Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const dir = new URL('../web/public/icons/', import.meta.url);
const svg = readFileSync(new URL('favicon.svg', dir), 'utf8');
const targets = [
  ['icon-192.png', 192, 0, 'transparent'],
  ['icon-512.png', 512, 0, 'transparent'],
  ['apple-touch-icon.png', 180, 0.08, '#1E2B2F'],
  ['icon-maskable-512.png', 512, 0.12, '#1E2B2F'],
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size, pad, bg] of targets) {
  await page.setViewportSize({ width: size, height: size });
  const inner = Math.round(size * (1 - pad * 2));
  await page.setContent(
    `<html><body style="margin:0;background:${bg};display:flex;align-items:center;justify-content:center;width:${size}px;height:${size}px">` +
      svg.replace('<svg ', `<svg width="${inner}" height="${inner}" `) +
      '</body></html>',
  );
  await page.screenshot({ path: new URL(name, dir).pathname, omitBackground: bg === 'transparent' });
  console.log('wrote', name);
}
await browser.close();
