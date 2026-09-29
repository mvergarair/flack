# Changelog

All notable changes to Flack. Versions follow [semantic versioning](https://semver.org):
a major version means you need to do something when updating, and the notes say what.

**To update an installed Flack**, run `npm run update` in your Flack folder (or in Cloud
Shell: `cd flack && npm run update`). Your settings are kept. Admins also see an "update
available" note on the People & invites page when a new release is out.

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
