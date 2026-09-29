# Changelog

All notable changes to Flack. Versions follow [semantic versioning](https://semver.org):
a major version means you need to do something when updating, and the notes say what.

**To update an installed Flack**, run `npm run update` in your Flack folder (or in Cloud
Shell: `cd flack && npm run update`). Your settings are kept. Admins also see an "update
available" note on the People & invites page when a new release is out.

## 1.4.1 (2026-09-29)

- No more empty strip between the last message and the message box: "… is typing" now appears
  in that space only while someone types.
- Dependencies: TypeScript 7, jsdom 30, concurrently 10, and current GitHub Actions.

## 1.4.0 (2026-09-29)

- **Customize your workspace.** Admins: **People & invites → Customize workspace** to set
  - the workspace **name** (replaces "Flack" in the sidebar, sign-in and invite pages, and tab titles),
  - a **logo** (sidebar, sign-in page, browser tab icon),
  - the **accent** and **sidebar colors** (8 presets or any hex; text colors adjust automatically
    for contrast, in light and dark mode),
  - the **sign-in message**, and
  - which public channels **new members join**.

  A live preview shows the result before saving.
- Sign-up no longer fails if a default channel was deleted or archived; it's skipped.

## 1.3.0 (2026-09-29)

- **API reference on your own domain.** `https://<project>.web.app/api/docs` is an interactive
  reference: every endpoint with examples, code snippets and a "Test Request" panel (paste a
  token). The machine-readable spec is at `/api/openapi.json` (OpenAPI 3.1) for Postman,
  Insomnia or code generators. `/api` and `/api/v1` lead there too.
- The spec (`firebase/functions/src/api/openapi.yaml`) is checked against the API's routes in
  tests, so the docs can't drift from the code.

## 1.2.0 (2026-09-29)

- **HTTP API.** Read channels, messages, threads and people, search, open DMs and post
  messages from scripts, CI and bots: `https://<project>.web.app/api/v1`. See
  [docs/API.md](docs/API.md).
- **Personal API tokens.** Avatar → **API tokens**: create read-only or read-and-post tokens
  (shown once, stored only as a hash), see when each was last used, revoke anytime. Tokens act
  as their owner and stop working if the owner is deactivated.
- CI skips the test jobs for documentation-only changes.

## 1.1.0 (2026-09-29)

**Updating from 1.0.0:** 1.0.0 doesn't have `npm run update` yet, so run `git pull` once first,
then `npm run update`. From then on, `npm run update` alone is enough.

- **Update in one command.** `npm run update` pulls the latest code, turns on any Google Cloud
  services a new version needs, and deploys, keeping your settings.
- **Update notices.** Admins see the running version on the People & invites page, and a
  note with the release notes when a newer release is out.
- **New logo:** a chat bubble with typing dots rising like embers.

## 1.0.0 (2026-09-28)

First public release.

- Channels (public and private), DMs and group DMs, threads with “also send to channel”,
  @mentions, @here and @channel.
- ⌘K search across channels, people and messages, with filters.
- Reminders (`/remind`), scheduled messages (`/schedule`) and a Later page.
- Web push notifications, per-channel levels and Do Not Disturb.
- Reactions, pins, saved messages, presence, custom status, profile cards, link previews
  and file uploads.
- Invite-only sign-in with Google, admin roles and instant deactivation.
- `npm run setup` installer and Cloud Shell tutorials (English and Spanish).
