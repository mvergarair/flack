// Warm up the dev server and the functions runtime once before any spec runs.
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';

/** Pages with Open Graph tags for link-preview tests (fetched by the functions emulator). */
function startOgServer() {
  const server = createServer((req, res) => {
    if (req.url?.startsWith('/article')) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><html><head><title>Fallback</title>
        <meta property="og:title" content="Shipping Flack v1">
        <meta property="og:description" content="How we built a team chat on Firebase for almost nothing.">
        <meta property="og:site_name" content="Flack Blog">
        <meta property="og:image" content="/cover.png"></head><body>hi</body></html>`);
    } else if (req.url?.startsWith('/redirect')) {
      res.writeHead(302, { Location: '/article' });
      res.end();
    } else {
      res.writeHead(404);
      res.end();
    }
  });
  server.listen(5399, '127.0.0.1');
  return server;
}

export default async function globalSetup() {
  const og = startOgServer();
  const browser = await chromium.launch();
  const page = await browser.newPage();
  await page.goto('http://127.0.0.1:5317/login?memcache');
  await page.getByRole('heading', { name: 'Sign in to Flack' }).waitFor({ timeout: 90_000 });
  await browser.close();
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    const ok = await fetch('http://127.0.0.1:5301/demo-flack/us-central1/lookupinvite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ data: { token: 'warmup' } }),
    })
      .then((r) => r.ok)
      .catch(() => false);
    if (ok) break;
    await new Promise((r) => setTimeout(r, 500));
  }
  return () => new Promise<void>((resolve) => og.close(() => resolve()));
}
