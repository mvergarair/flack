// Post-build assertions for the production bundle (run by `npm run verify`).
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const dist = new URL('../web/dist/', import.meta.url);
const read = (p) => readFileSync(new URL(p, dist), 'utf8');
const fail = [];
const check = (ok, msg) => ok || fail.push(msg);

const js = readdirSync(new URL('assets/', dist)).filter((f) => f.endsWith('.js')).map((f) => read(`assets/${f}`)).join('\n') + read('sw.js');
for (const needle of ['demo-flack', '127.0.0.1', 'Emulator sign-in', 'emulator-login', 'password123']) {
  check(!js.includes(needle), `production bundle contains emulator-only code: "${needle}"`);
}
// With a configured project (scripts/project.env from `npm run setup`), the bundle must carry
// its Firebase config. CI builds without one only get the emulator checks above.
const envFile = new URL('./project.env', import.meta.url);
const project = existsSync(envFile) ? readFileSync(envFile, 'utf8').match(/FLACK_PROJECT="([^"]+)"/)?.[1] : undefined;
if (project) check(js.includes(project), `production bundle is missing the Firebase config for ${project}`);
else console.log('No scripts/project.env: skipping the Firebase config check.');

const html = read('index.html');
check(/<link rel="manifest"/.test(html), 'index.html has no manifest link');
check(existsSync(new URL('sw.js', dist)), 'sw.js missing');
const manifest = JSON.parse(read('manifest.webmanifest'));
check(manifest.display === 'standalone' && manifest.icons?.some((i) => i.sizes === '512x512'), 'manifest incomplete');
for (const icon of manifest.icons ?? []) check(existsSync(new URL(icon.src.slice(1), dist)), `missing icon ${icon.src}`);

if (fail.length) {
  console.error('Build check failed:\n - ' + fail.join('\n - '));
  process.exit(1);
}
console.log('Build check passed.');
