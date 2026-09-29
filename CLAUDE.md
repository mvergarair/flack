# Flack: notes for Claude Code

The README has the full picture. The rules that matter most when changing things:

- **Never call the Google Cloud or Firebase CLIs directly.** Use `scripts/gcloud.sh` / `scripts/fb.sh`; a PreToolUse hook blocks direct calls. The only real project is the one in `scripts/project.env` (written by `npm run setup`, gitignored); the emulators use `demo-flack`.
- **Emulator ports** (non-default, to avoid other local projects): Auth 9399, Firestore 8380, RTDB 9300, Storage 9398, Functions 5301, Pub/Sub 8385, UI 4300, hub 4380. Vite dev runs on 5317 and the emulator-mode production preview on 5318.
- **Security rules are the backend.** Any data-model change needs matching updates in `firebase/*.rules` and tests in `firebase/rules-tests/test/`.
- **Every feature ships with tests at all layers:** unit (`web/src/**/*.test.ts`, `firebase/functions/src/**/*.test.ts`), rules/callables (`firebase/rules-tests`), e2e (`e2e/tests/*.spec.ts`, tags `@cross` → WebKit and `@mobile` → iPhone/Pixel).
- **Seeding and e2e helpers.** `scripts/seed-lib.ts` seeds; e2e drives it through `scripts/emu-cli.ts`, because Playwright can't load firebase-admin. Seeding pauses emulator function triggers.
- **Local sign-in** uses the email/password form (emulators only, password `password123`). Production is Google-only, and `scripts/check-build.mjs` fails the build if emulator code leaks into it.
- **Firestore listeners** should use `listenDoc`/`listenQuery` from `web/src/lib/snapshot.ts`, which retry transient permission errors after sign-in.
- **Cost:** keep reads bounded. Paginate (50), use count aggregations for badges, and keep presence/typing in RTDB.
- **Before deploying:** `npm run verify` must pass. Then `npm run deploy`.
