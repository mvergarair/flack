# Changelog

All notable changes to Flack. Versions follow [semantic versioning](https://semver.org):
a major version means you need to do something when updating, and the notes say what.

**To update an installed Flack**, run `npm run update` in your Flack folder (or in Cloud
Shell: `cd flack && npm run update`). Your settings are kept. Admins also see an "update
available" note on the People & invites page when a new release is out.

## 1.7.1 (2026-09-29)

- **Ask Flackbot setup: Vertex AI quota.** New Google Cloud projects start with no quota for
  Claude, so questions failed with "too many questions". The installer now requests some
  (60 requests a minute; Google emails you its decision), the admin card has a quota step with
  a link, and admins get a clear message when quota is the problem. If Google denies the
  automatic request, ask for less or contact Google Cloud support from the quotas page.
- The Ask Flackbot question box grows with long questions (wrapped lines included) instead of
  scrolling the first line out of view.

## 1.7.0 (2026-09-29)

- **Ask Flackbot (optional AI).** Ask about anything your team has discussed ("what did I miss
  today?", "what was decided about pricing?") and get a short answer with links to the messages
  it's based on.
  - **Desktop:** a pane on the right (Ask Flackbot in the sidebar) that stays open while you
    browse. **Phones:** a full-screen page from the ✦ button at the top. Questions typed in the
    Flackbot DM get answers too.
  - **It only sees what you can see:** its searches and reads run as you, with the same checks as
    the app. It can't post or change anything.
  - **Claude on Vertex AI in your own Google Cloud project,** billed with the rest of Flack; no
    API key. Claude Sonnet 5.5 by default (a typical question costs 2–5¢); admins can pick
    Claude Haiku 4.5 or Claude Opus 5.5.
  - **Off until an admin turns it on** (People & invites → Ask Flackbot), with a per-person daily
    limit (30) and a monthly budget (US$20) that pauses it when reached. This month's usage and
    cost are shown there.
  - **Setup:** the installer (and `npm run update`) turns on Vertex AI and gives Flack's functions
    permission to use it. One step is yours: enable the Claude model in Vertex AI Model Garden,
    which asks you to accept Anthropic's terms. The admin page links to it and can check the
    connection.

## 1.6.0 (2026-09-29)

- **Flackbot.** A built-in bot with its own DM for everyone:
  - **Reminders arrive from Flackbot**, with a link to the message they're about and a Snooze
    button. They're pushed like any DM and respect Do Not Disturb.
  - **Scheduled messages that can't go out** are reported there too, with a link to fix them.
  - **A welcome message** for each person the first time they open Flack (existing members get
    it after this update). Admins can write their own on the People & invites page.
  - **Automatic answers:** admins set phrases ("wifi password") and replies; when a message
    contains one, Flackbot answers in the same channel or thread. Up to 50.
  - Flackbot isn't a person: it doesn't count as a member, can't be added to channels, and
    nobody can post as it.
- Reminders and failed scheduled messages no longer create Activity items (older ones stay).
- Fixed a console error when scrolling back in a conversation whose first message was still
  sending.

## 1.5.1 (2026-09-29)

- **Installer and update fix.** 1.5.0 added two Google Cloud services, which put the list over
  the 20 Google accepts in one request: new installs stopped at "Turning on the Google Cloud
  services", and `npm run update` skipped the step with a warning. Both now turn services on in
  batches. If you updated to 1.5.0, run `npm run update` again so the Health card can read error
  counts.
- **New projects.** The installer retries creating the Realtime Database and the Storage bucket
  while Google finishes granting a brand-new project's owner access, instead of failing.
- The installer's closing note says "No budget alert set" when you chose 0.

## 1.5.0 (2026-09-29)

- **Health card for admins.** People & invites shows the last 24 hours: messages, members active
  this week, database reads and writes against the free quota, function errors and latency, and
  page-load speed, with a 7-day trend. Data comes from a daily snapshot kept in your project for
  90 days; production also uses Firebase Performance Monitoring in your own console.
- **Anonymous usage statistics** ([TELEMETRY.md](TELEMETRY.md)). Once a day, each install sends
  the maintainers a small anonymous report (version, size ranges, features in use, error counts
  and speed), never messages, names, emails or anything anyone wrote. **On by default**; turn it
  off in People & invites, answer `no` at install, or set `FLACK_TELEMETRY=off`. Admins can see
  exactly what was sent. Aggregates are public at [Flack in numbers](https://flack-telemetry-mv.web.app).
- **Old data cleans itself up.** Daily snapshots, page-load counters and Activity items are
  deleted automatically after 90 days (Firestore TTL policies); the Activity page only shows the
  latest 50 anyway.
- The installer asks about statistics and records the region.
- Fix: functions now reach the Realtime Database outside the US (europe-west1, asia-southeast1).

**Updating:** admins see a one-time note about statistics after updating. The update turns on the
Cloud Monitoring and Error Reporting APIs for the Health card.

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
