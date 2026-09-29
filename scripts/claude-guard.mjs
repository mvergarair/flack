#!/usr/bin/env node
// Claude Code PreToolUse hook: keeps Bash commands from touching any Google Cloud /
// Firebase project other than this repo's. Direct `gcloud` / `firebase` calls are
// blocked; they must go through scripts/gcloud.sh or scripts/fb.sh, which pin the project.
import { readFileSync } from 'node:fs';

let input = '';
try {
  input = readFileSync(0, 'utf8');
} catch {
  process.exit(0);
}
let cmd = '';
try {
  cmd = JSON.parse(input)?.tool_input?.command ?? '';
} catch {
  process.exit(0);
}

const block = (why) => {
  process.stderr.write(`flack-guard: ${why}\nUse scripts/gcloud.sh or scripts/fb.sh (they pin the flack project).\n`);
  process.exit(2);
};

// A CLI invocation: the word at a command position, not part of a path like firebase/functions.
const invokes = (name) =>
  new RegExp(`(^|[;&|(\`]|\\$\\(|\\bnpx\\s+|\\bexec\\s+|\\bxargs\\s+|\\s)${name}(?=\\s|$)`, 'm').test(cmd);

if (invokes('gcloud') || invokes('gsutil') || invokes('bq')) block('direct gcloud/gsutil/bq call');
if (invokes('firebase') || invokes('firebase-tools')) block('direct firebase CLI call');

// Raw REST calls to Google APIs must name the flack project (or be the local emulators).
// Only real Google API hosts count (emulator URLs carry "googleapis.com" in the path, not the host).
if (/(^|[\s;&|(])(curl|wget|xh|http|https)\s/.test(cmd) && /:\/\/[a-z0-9.-]*\.googleapis\.com/.test(cmd) && !/:\/\/fonts\.googleapis\.com/.test(cmd)) {
  let env = '';
  try {
    env = readFileSync(new URL('./project.env', import.meta.url), 'utf8');
  } catch {
    // No project configured yet: every real googleapis.com call is blocked below.
  }
  const project = env.match(/FLACK_PROJECT="([^"]*)"/)?.[1];
  const ok = project && cmd.includes(project);
  const bootstrap = /(cloudresourcemanager|cloudbilling|billingbudgets|serviceusage|firebase)\.googleapis\.com/.test(cmd) && project && cmd.includes(project);
  if (!ok && !bootstrap) block('googleapis.com call that does not name the flack project');
}
process.exit(0);
