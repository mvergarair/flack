// Builds the API reference into web/dist after `vite build`:
//   /api/openapi.json  the spec (firebase/functions/src/api/openapi.yaml, stamped with the version)
//   /api/docs/         an interactive reference rendered by Scalar (MIT), bundled locally
// Hosting serves these static files before the /api/** → function rewrite applies.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { parse } from 'yaml';

const root = new URL('../', import.meta.url);
// Output: web/dist (production build) or another build folder, e.g. `node … web/dist-emu`.
const out = new URL(`${process.argv[2] ?? 'web/dist'}/api/`, root);
const { version } = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));

const spec = parse(readFileSync(new URL('firebase/functions/src/api/openapi.yaml', root), 'utf8'));
spec.info.version = version;
mkdirSync(new URL('docs/', out), { recursive: true });
writeFileSync(new URL('openapi.json', out), JSON.stringify(spec, null, 2));

// The package's main entry is dist/index.js; the self-contained browser build sits next to it.
const main = createRequire(new URL('web/package.json', root)).resolve('@scalar/api-reference');
copyFileSync(new URL('browser/standalone.js', pathToFileURL(main)), new URL('docs/scalar.js', out));

const config = {
  url: '/api/openapi.json',
  // Never route "try it" requests (and tokens) through Scalar's servers: the API is same-origin.
  proxyUrl: '',
  telemetry: false,
  hideClientButton: true,
  // Keep it a plain reference: no Scalar AI assistant, MCP generator or developer toolbar.
  agent: { disabled: true },
  mcp: { disabled: true },
  showDeveloperTools: 'never',
  documentDownloadType: 'json',
  withDefaultFonts: false,
  defaultHttpClient: { targetKey: 'shell', clientKey: 'curl' },
  authentication: { preferredSecurityScheme: 'token' },
  metaData: { title: 'Flack API' },
  customCss: `
    :root { --scalar-font: 'IBM Plex Sans', system-ui, sans-serif; --scalar-font-code: 'IBM Plex Mono', ui-monospace, monospace; }
    .light-mode { --scalar-color-accent: #d9540f; }
    .dark-mode { --scalar-color-accent: #ffa23a; }
  `,
};
writeFileSync(new URL('docs/init.js', out), `window.Scalar.createApiReference('#app', ${JSON.stringify(config)});\n`);

// Same policy as the app (firebase.json), repeated here so previews and the emulator match.
const csp = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

writeFileSync(
  new URL('docs/index.html', out),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta http-equiv="Content-Security-Policy" content="${csp}" />
    <title>Flack API</title>
    <meta name="description" content="Reference for this Flack's HTTP API: channels, messages, people, search and posting." />
    <link rel="icon" href="/icons/favicon.svg" type="image/svg+xml" />
    <link rel="preconnect" href="https://fonts.googleapis.com" />
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link href="https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap" rel="stylesheet" />
  </head>
  <body>
    <div id="app"></div>
    <script src="/api/docs/scalar.js"></script>
    <script src="/api/docs/init.js"></script>
  </body>
</html>
`,
);
console.log(`API docs built (Flack ${version}) in ${out.pathname}`);
