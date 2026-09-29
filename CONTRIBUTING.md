# Contributing to Flack

Thanks for helping! Bug fixes, features, docs, translations and tests are all welcome, and so
are **contributions made with AI coding agents**. The bar is the same for everyone: the change is
tested at every layer it touches, CI is green, and you can explain the change in the PR.

## Setup

Requirements: Node.js 22+, Java 21+ (for the Firebase emulators) and Playwright's browsers.

```bash
git clone https://github.com/mvergarair/flack && cd flack
npm install
npx playwright install chromium webkit
npm run emulators      # terminal 1: local Firebase (no Google account needed)
npm run seed           # demo users, channels and messages
npm run dev -w web     # terminal 2: http://127.0.0.1:5317
```

Sign in with the email/password form under the Google button (emulators only):
`admin@flack.test` / `password123` (see the README for the other demo users).

Nothing here touches a real Google Cloud project: the emulators use the `demo-flack` project.

## Making a change

1. **Open an issue first** for anything bigger than a bug fix, so we can agree on the approach.
2. **Keep security rules in step.** Clients talk to the databases directly, so data-model changes
   need matching changes in `firebase/*.rules` plus rules tests, including what must be denied.
3. **Add tests at every layer you touch:**

   | Layer | Where | Run |
   |---|---|---|
   | Unit | `web/src/**/*.test.ts`, `firebase/functions/src/**/*.test.ts` | `npm run test:unit` |
   | Security rules + functions | `firebase/rules-tests/test/` | `npm run test:emu` |
   | End to end | `e2e/tests/*.spec.ts` (`@cross` → WebKit, `@mobile` → phones) | `npm run e2e` |

4. **Run everything:** `npm run verify` (typecheck, unit, rules, end-to-end, production build).
   To iterate on one spec: `scripts/fb.sh emulators:exec --project demo-flack --only auth,firestore,database,storage,functions,pubsub "cd e2e && npx playwright test tests/messages.spec.ts"`.
5. **Mind the cost.** Flack is designed to run inside Firebase's free quotas: paginate, use count
   queries for badges, and avoid always-on listeners over whole collections.
6. **User-facing change?** Add a line to `CHANGELOG.md` under an "Unreleased" heading. If it needs
   a new Google Cloud API, add it to `scripts/services.txt`.

## Pull requests

- CI runs on every PR: shell-script lint, typecheck, unit tests, a production build check, the
  security-rules and function tests on the emulators, end-to-end tests in Chromium, WebKit and
  phone viewports, and CodeQL. All must pass before merging.
- Keep PRs focused; one feature or fix per PR.
- Screenshots or a short video help for UI changes (both light and dark mode if you can).
- Never commit secrets or personal data: `scripts/project.env`, `web/.env.production` and
  `firebase/functions/.env.<project>` are gitignored for that reason.

## Using an AI coding agent

Agents are welcome. Point yours at [AGENTS.md](AGENTS.md) (Claude Code reads it through
`CLAUDE.md`): it lists the rules that keep changes safe, like never touching a real project and
never skipping the rules tests. In the PR, say that an agent helped and what you checked
yourself. You're responsible for the change either way.

## Security issues

Please don't open a public issue. See [SECURITY.md](SECURITY.md).

## License

By contributing, you agree that your contributions are licensed under the [MIT License](LICENSE).
