# Notes for coding agents (and humans in a hurry)

Flack welcomes contributions made with AI coding agents (Claude Code, Codex, Cursor, Copilot…).
These are the rules that keep changes safe; [CONTRIBUTING.md](CONTRIBUTING.md) has the workflow
and the README has the full picture.

## Ground rules

- **Never touch a real Google Cloud project from a task.** Development and every test run use the
  local emulators (project `demo-flack`; the `demo-` prefix makes the SDKs refuse real services).
  Deploys go through `scripts/deploy.sh` / `npm run update` only, run by a person. Use
  `scripts/gcloud.sh` / `scripts/fb.sh` instead of the raw CLIs: they pin the one project in
  `scripts/project.env` (gitignored, written by `npm run setup`). In Claude Code, a PreToolUse hook
  (`.claude/settings.json` → `scripts/claude-guard.mjs`) blocks direct CLI and Google API calls.
- **Security rules are the backend.** Clients talk to Firestore, Storage and the Realtime Database
  directly, so any data-model change needs matching rules in `firebase/*.rules` and tests in
  `firebase/rules-tests/test/`, including the cases that must be *denied*.
- **Every change ships with tests at every layer it touches:**
  - unit: `web/src/**/*.test.ts`, `firebase/functions/src/**/*.test.ts`
  - rules and functions: `firebase/rules-tests/test/`
  - end to end: `e2e/tests/*.spec.ts` (tag `@cross` to also run in WebKit, `@mobile` for iPhone/Pixel)
- **`npm run verify` must pass** before you say you're done. CI runs the same checks on every PR.
- **Never commit** secrets, `scripts/project.env`, `web/.env.production`,
  `firebase/functions/.env.<project>`, or anything personal (emails, project ids, billing ids).

## Things that will bite you

- **Emulator ports are non-default** (so they don't clash with other projects): Auth 9399,
  Firestore 8380, RTDB 9300, Storage 9398, Functions 5301, Pub/Sub 8385, UI 4300, hub 4380. Vite
  dev runs on 5317, the emulator-mode production preview on 5318.
- **Seeding and e2e helpers.** `scripts/seed-lib.ts` seeds; e2e drives it through
  `scripts/emu-cli.ts` because Playwright can't load firebase-admin. Seed data is flagged
  `seeded: true` so message triggers skip it. `emu.runScheduled({ backdate: true })` runs the
  10-minute scheduled-items sweep on demand.
- **Local sign-in** uses the email/password form (emulators only, password `password123`).
  Production is Google-only, and `scripts/check-build.mjs` fails the build if emulator code leaks in.
- **Firestore listeners** use `listenDoc` / `listenQuery` from `web/src/lib/snapshot.ts`, which
  retry transient permission errors right after sign-in.
- **Cost:** keep reads bounded. Paginate (50), use count aggregations for badges, keep presence
  and typing in the Realtime Database, and never add an always-on listener over a whole collection.
- **Releases:** bump `version` in the root `package.json` and add a `CHANGELOG.md` entry. New
  Google Cloud APIs go in `scripts/services.txt`, so installed copies turn them on with
  `npm run update`. Changes must work for existing data (or migrate it lazily, like `typingKey`).
- **Node 22+.** If `vitest` fails with a `styleText` import error, your shell picked an older Node.
