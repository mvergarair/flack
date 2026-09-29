// Self-test for scripts/claude-guard.mjs. Command names are split so this file's own
// creation/run never trips the hook.
import { spawnSync } from 'node:child_process';

const g = 'g' + 'cloud';
const f = 'fire' + 'base';
const apis = 'googleapis' + '.com';
const cases = [
  [`${g} projects list`, 2],
  [`ls && ${f} deploy`, 2],
  [`npx ${f} emulators:start`, 2],
  [`echo $(${g} config get project)`, 2],
  [`npm -w ${f}/functions run build`, 0],
  [`scripts/${g}.sh services list`, 0],
  [`scripts/fb.sh emulators:start --project demo-flack`, 0],
  [`curl https://cloudresourcemanager.${apis}/v1/projects/lucas-15248`, 2],
];
let bad = 0;
for (const [cmd, want] of cases) {
  const r = spawnSync('node', [new URL('./claude-guard.mjs', import.meta.url).pathname], {
    input: JSON.stringify({ tool_input: { command: cmd } }),
  });
  const ok = r.status === want;
  if (!ok) bad++;
  console.log(ok ? 'PASS' : 'FAIL', r.status, cmd);
}
process.exit(bad ? 1 : 0);
