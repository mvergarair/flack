# Backlog

Things we decided to do later, with enough context to pick them up cold.

## Privacy / security
- **Proxy link-preview images.** Preview images currently load directly from the linked
  site (`referrerPolicy=no-referrer`, but the site still sees the viewer's IP). Slack relays
  them. Plan: the unfurl function downloads `og:image` (same SSRF guards, size cap ~2 MB,
  image/* only), stores it at `previews/{hash}.webp` in Storage, and the client loads it via
  the SDK (`getBlob`), like attachments. Add storage rules (read: any active user) and a
  cleanup job for unreferenced previews.
- **Verify the Storage "no overwrite" rule in production.** `allow update: if false` should
  block overwriting another member's attachment, but the Storage emulator treats overwrites
  as `create`, so it isn't covered by the rules tests. Check once against prod (or a staging
  bucket).
- **Test the daily orphan-upload cleanup** (`cleanuporphanuploads`); the delete-with-message
  path is tested, the scheduled sweep isn't.

## Scale pass (before ~100–200 users)
The app is sized for ≤50 people. Two app-wide listeners grow with headcount × headcount:
- **Presence:** every client listens to the whole `status/` tree, so every status change is
  sent to every open app. At 1,000 users that's several GB/day of RTDB download (billed per
  GB after 10 GB/month). Fix: listen to `status/{uid}` only for people on screen (DM
  partners, visible members, message authors in view); the notifications function should
  read only its targets' status nodes instead of the whole tree.
- **User directory:** `WorkspaceProvider` loads every `users` doc on app start (~1,000 reads
  per open at 1,000 users). Fix: fetch profiles on demand with an IndexedDB cache refreshed
  via an `updatedAt > lastSync` query; ⌘K people search and @-autocomplete use a
  name-prefix query (`nameLower >= q`, limit 10) instead of filtering everyone locally.
- **@channel fan-out:** pushes go out per recipient; batch them (`sendEach`, ≤500 per call)
  for big channels.

## Reliability / ops
- **Code-split the bundle** (~390 KB gzipped, one chunk): lazy-load admin, emoji picker,
  messaging and link-preview code.
- **Real-device push check** (Mac, Android, iPhone home-screen app) — never verified end to
  end; FCM isn't emulated.

## Features (from the Slack comparison)
- **Search upgrade (if needed).** v1 is a Firestore word index (whole words + word
  beginnings, AND across words, no ranking/typos). If people want phrases, ranking or typo
  tolerance: mirror messages to Cloudflare D1 (SQLite FTS5) behind a Worker — also scales to
  zero; the Search page and `searchmessages` contract can stay the same.
- **Threads view** (all threads I'm in, with unread replies).
- **Scheduled messages with attachments** (v1 is text only; files would need to stay uploaded until the send time).
- **Huddles** (audio + screen share; LiveKit Cloud or Cloudflare Realtime — see chat notes).
- **GitHub integration** (webhook → channel) and **Claude MCP server** (from the original brief).
- Emoji autocomplete (`:fire:`) and custom emoji upload.
- Starred channels / custom sidebar sections; All-unreads view and Mark all read.
- Message permalinks ("Copy link"), forward/share.
- Profile photo upload (today only Google photos).
- Drafts synced across devices (today per device).
- User groups (`@engineering`).
- Code syntax highlighting.
- Keyword notifications ("notify me about 'deploy'").
- Light/dark/system theme switch.
- Slash commands, polls, clips, canvases, guest accounts.
