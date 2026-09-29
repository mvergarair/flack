# Flack HTTP API

Read your channels, messages and people, and post messages, from scripts, CI pipelines, bots
and other tools. The API runs inside your own Flack deployment (a Cloud Function behind your
Hosting domain); nothing goes through a third party.

```
https://<your-project>.web.app/api/v1
```

**Every Flack has an interactive reference at `https://<your-project>.web.app/api/docs`** (try
requests with your token right there) and the OpenAPI 3.1 spec at `/api/openapi.json` for
Postman, Insomnia or code generators. This page is the same reference as a readable guide.

- [Authentication](#authentication)
- [Conventions](#conventions): requests, errors, pagination, limits
- [Me](#me) · [Users](#users) · [Channels](#channels) · [Messages](#messages) · [Direct messages](#direct-messages) · [Search](#search)
- [Examples](#examples)

## Authentication

Every request needs a **personal API token**:

```
Authorization: Bearer flk_…
```

**Create one** in Flack: your avatar (bottom left) → **API tokens** → name it, pick the access,
**Create token**, and copy it. It's shown once. Keep it like a password: store it in your CI's
secret store or a password manager, never in code.

**What a token can do.** A token acts as **you**:

- it sees exactly what you see (your channels and DMs, public channel info, active people);
- messages it posts appear as you, with the same notifications, search indexing and link
  previews as messages sent in the app.

For a bot, create a dedicated Flack account (invite `deploy-bot@yourcompany.com`, for example),
sign in once as it, and create the token there.

**Access levels**

| Access | Scope | Allows |
|---|---|---|
| Read only | `read` | All `GET` endpoints |
| Read and post messages | `read`, `write` | Also `POST` endpoints (post messages, open DMs) |

**Security**

- Flack stores only a SHA-256 hash of each token, so tokens can't be recovered from the database.
- Revoke a token anytime from **API tokens**.
- Tokens stop working immediately if their owner is deactivated, and work again if the owner is reactivated.
- **API tokens** shows when each token was last used (updated at most every 10 minutes).
- You can have up to 20 tokens.

## Conventions

- **Requests:** JSON bodies with `Content-Type: application/json`. IDs are strings.
- **Responses:** JSON. Timestamps are milliseconds since the Unix epoch (`1759123456789`) or `null`.
- **Mentions** in message text use Flack's stored format: `<@USER_ID>` for a person, `<!here>`
  and `<!channel>` for everyone online / everyone in the channel. Markdown works as in the app.
- **Errors** use HTTP status codes and a body like:

  ```json
  { "error": { "code": "not_found", "message": "Channel not found (or you are not a member)." } }
  ```

  | Status | `code` | When |
  |---|---|---|
  | 400 | `invalid_argument` | Bad or missing input |
  | 401 | `unauthenticated` | No token, a malformed one, or a revoked one |
  | 403 | `forbidden`, `insufficient_scope` | Owner not active; token lacks `write` |
  | 404 | `not_found` | Unknown endpoint, or something you can't see |
  | 405 | `method_not_allowed` | Wrong HTTP method for the path |
  | 409 | `failed_precondition` | E.g. the channel is archived or the thread doesn't exist |
  | 429 | `rate_limited` | Too many requests; see `Retry-After` |

  Channels you aren't a member of return `404`, the same as channels that don't exist.

- **Pagination:** list endpoints take `limit` (1–100, default 50) and return a cursor
  (`nextBefore` / `nextAfter`), which is `null` on the last page.
- **Rate limit:** about 120 requests per minute per token.
- **Caching:** responses are never cached (`Cache-Control: no-store`).

## Me

### `GET /v1/me`

The token's owner and the token's scopes.

```json
{
  "user": { "id": "uMia", "name": "Mia Member", "title": "Backend", "email": "mia@example.com", "role": "member",
            "status": "active", "photoUrl": null, "timeZone": "America/Santiago", "customStatus": null },
  "scopes": ["read", "write"]
}
```

## Users

A **User**:

| Field | Type | Notes |
|---|---|---|
| `id` | string | Use in mentions as `<@id>` |
| `name` | string | Display name |
| `title` | string | Job title, may be empty |
| `email` | string | |
| `role` | `"admin"` \| `"member"` | |
| `status` | `"active"` \| `"deactivated"` | |
| `photoUrl` | string \| null | |
| `timeZone` | string \| null | IANA time zone, e.g. `Europe/Madrid` |
| `customStatus` | `{ emoji, text, expiresAt }` \| null | Only while it hasn't expired |

### `GET /v1/users`

Everyone active in the workspace, sorted by name: `{ "users": [User, …] }`.

### `GET /v1/users/{userId}`

One person (including deactivated people): `{ "user": User }`.

## Channels

A **Channel**:

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `type` | `"public"` \| `"private"` \| `"dm"` | DMs are 1:1 or group direct messages |
| `name` | string | Without `#`; empty for DMs (use `memberIds`) |
| `topic` | string | |
| `memberIds` | string[] | |
| `archived` | boolean | Archived channels are read-only |
| `createdAt`, `lastMessageAt` | number \| null | |

### `GET /v1/channels`

Channels and DMs you're a member of, most recently active first: `{ "channels": [Channel, …] }`.

### `GET /v1/channels/{channelId}`

`{ "channel": Channel }`. Works for channels you're in and for any public channel.

## Messages

A **Message**:

| Field | Type | Notes |
|---|---|---|
| `id` | string | |
| `channelId` | string | |
| `authorId` | string | |
| `text` | string | Markdown with `<@id>` mentions; empty if deleted |
| `createdAt`, `editedAt` | number \| null | |
| `threadId` | string \| null | For replies: the id of the thread's first message |
| `alsoToChannel` | boolean | A reply that was also sent to the channel |
| `replyCount`, `lastReplyAt` | number, number \| null | For thread starters |
| `mentions` | string[] | User ids, plus `!here` / `!channel` |
| `reactions` | `{ userId: [emoji, …] }` | |
| `attachments` | `[{ name, size, contentType }]` | Metadata only; download files in the app |
| `deleted` | boolean | Deleted messages that had replies stay as placeholders |

### `GET /v1/channels/{channelId}/messages`

The channel's messages, **newest first**: top-level messages plus thread replies that were
also sent to the channel. You must be a member.

| Query | |
|---|---|
| `limit` | 1–100, default 50 |
| `before` | Only messages created before this timestamp: pass the previous page's `nextBefore` |

```json
{ "messages": [Message, …], "nextBefore": 1759120000000 }
```

### `GET /v1/channels/{channelId}/messages/{messageId}`

`{ "message": Message }`.

### `GET /v1/channels/{channelId}/messages/{messageId}/replies`

A thread's replies, **oldest first**.

| Query | |
|---|---|
| `limit` | 1–100, default 50 |
| `after` | Only replies created after this timestamp: pass the previous page's `nextAfter` |

```json
{ "replies": [Message, …], "nextAfter": null }
```

### `POST /v1/channels/{channelId}/messages`

Post a message as the token's owner. Needs the `write` scope and membership of the channel
(including DMs).

| Body field | Type | |
|---|---|---|
| `text` | string, required | Up to 40,000 characters. Markdown and `<@id>` / `<!here>` / `<!channel>` mentions |
| `threadId` | string | Reply in this thread |
| `alsoToChannel` | boolean | With `threadId`: also show the reply in the channel |

| Header | |
|---|---|
| `Idempotency-Key` | Optional (1–200 chars). Retrying with the same key returns the first message instead of posting twice |

Returns **201** `{ "message": Message }`, or **200** with the original message for a repeated
`Idempotency-Key`. Returns **409** if the channel is archived or the thread doesn't exist.

Mentioned people and thread participants are notified as usual (activity feed and push), and
the message is searchable within seconds.

## Direct messages

### `POST /v1/dms`

Open the DM with one or more people (up to 8 others), creating it if needed. Needs `write`.

```json
{ "userIds": ["uAna"] }
```

Returns **201** (created) or **200** (already existed) with `{ "channel": Channel, "created": true }`.
Then post to it with `POST /v1/channels/{channel.id}/messages`. Everyone must be an active member.

## Search

### `GET /v1/search`

The same search as the app (whole words and word beginnings, accent-insensitive, every word
must match), across channels you're a member of. Newest first, 20 per page.

| Query | |
|---|---|
| `q` | Required. Words to find |
| `channelId` | Only this channel |
| `authorId` | Only messages by this person |
| `hasFile` | `true`: only messages with attachments |
| `after` | Only messages after this timestamp |
| `before` | Pagination: pass the previous page's `nextBefore` |

```json
{
  "results": [
    { "messageId": "m1", "channelId": "cEng", "threadId": null, "authorId": "uMia",
      "createdAt": 1759120000000, "snippet": "Finish the upload flow…", "hasFile": false }
  ],
  "nextBefore": null
}
```

## Examples

```bash
FLACK=https://your-project.web.app/api/v1
TOKEN=flk_…   # from API tokens in the app

# Who am I?
curl -s -H "Authorization: Bearer $TOKEN" $FLACK/me

# My channels
curl -s -H "Authorization: Bearer $TOKEN" $FLACK/channels | jq '.channels[] | {id, name}'

# Post to a channel (retry-safe)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -H "Idempotency-Key: deploy-$GITHUB_RUN_ID" \
  -d '{"text": "✅ Deployed **web** to production"}' \
  $FLACK/channels/CHANNEL_ID/messages

# DM someone
DM=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"userIds": ["USER_ID"]}' $FLACK/dms | jq -r .channel.id)
curl -s -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"text": "Your report is ready"}' $FLACK/channels/$DM/messages

# Read the latest 10 messages
curl -s -H "Authorization: Bearer $TOKEN" "$FLACK/channels/CHANNEL_ID/messages?limit=10"

# Search
curl -s -G -H "Authorization: Bearer $TOKEN" --data-urlencode "q=release notes" $FLACK/search
```

**GitHub Actions**: post when a deploy finishes (store the token as the `FLACK_TOKEN` secret):

```yaml
- name: Tell the team
  run: |
    curl -sf -X POST "https://your-project.web.app/api/v1/channels/${{ vars.FLACK_CHANNEL }}/messages" \
      -H "Authorization: Bearer ${{ secrets.FLACK_TOKEN }}" -H "Content-Type: application/json" \
      -H "Idempotency-Key: deploy-${{ github.run_id }}" \
      -d "{\"text\": \"✅ ${{ github.repository }} deployed (${{ github.sha }})\"}"
```

**JavaScript** (Node 18+ or Deno):

```js
const res = await fetch(`${process.env.FLACK}/channels/${channelId}/messages`, {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.FLACK_TOKEN}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ text: 'Hello from a script 👋' }),
});
if (!res.ok) throw new Error((await res.json()).error.message);
const { message } = await res.json();
```

## Finding IDs

- **Channel:** open it in Flack and look at the address bar: `…/c/CHANNEL_ID`. Or `GET /v1/channels`.
- **Person:** `GET /v1/users`.
- **Message:** `GET /v1/channels/{id}/messages`, or search.

## Not in the API yet

Editing or deleting messages, reactions, file uploads and downloads, creating channels, and
admin actions. Open an issue if you need one.
