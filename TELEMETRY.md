# Anonymous usage statistics

Flack can send its maintainers **one small anonymous report a day** from each install, so we can
see which versions are in use, what breaks, how fast Flack is and which features matter. It's
**on by default and easy to turn off**, and it never includes anything your team wrote or who
they are.

Aggregate results are public: **[Flack in numbers](https://flack-telemetry-mv.web.app)**.

## Never collected

- Messages, threads, reactions, files, link previews or search queries.
- Names, emails, profile photos, titles or user ids.
- Channel names, topics or ids; the workspace name or logo.
- Your project id, domain or anything that identifies your company.
- IP addresses: reports come from your install's server, not people's browsers, and the
  collector excludes request logs, so no address is stored.
- Error message text (it can contain what someone typed); only counts per Flack function.

## What a report contains

One JSON document a day, exactly like this (admins can see the latest one in the app):

```json
{
  "schema": 1,
  "installId": "6f1c2a9e-3b7d-4c1a-9e2f-0a1b2c3d4e5f",
  "date": "2026-09-29",
  "version": "1.5.0",
  "region": "us-central1",
  "size": { "activeMembers7d": "11-50", "members": "11-50", "channels": "1-10" },
  "activity": { "messages24h": "101-1000" },
  "features": { "api": true, "scheduling": false, "customized": true, "push": true },
  "health": {
    "functionRequests24h": "1001-10000",
    "functionErrors24h": 3,
    "errorsByFunction": [{ "service": "onmessagecreated", "count": 3 }],
    "functionP95Ms": 812,
    "pageLoadP75": "lt2_5s"
  },
  "cost": { "readsPctOfFree": 42, "writesPctOfFree": 16 }
}
```

| Field | What it is | Why |
|---|---|---|
| `installId` | A random id created by your install the first time it reports. Not derived from anything about you | To count installs without knowing who they are |
| `version`, `region` | Flack version; the region you chose at install | Which versions to support; where performance matters |
| `size.*` | Ranges (`1-10`, `11-50`, …) of members, members active this week and channels | Which team sizes to design for |
| `activity.messages24h` | A range of messages sent in the last 24 hours | Load and cost planning |
| `features.*` | Whether the API, reminders/scheduling, custom branding and push are in use (yes/no) | What to invest in |
| `health.*` | Function error count (total and per Flack function), 95th-percentile function latency, page-load bucket | Finding bugs and slowness |
| `cost.*` | Yesterday's database reads and writes as a percentage of Firebase's free daily quota | Keeping Flack free to run |

The collector rejects any report with fields or values beyond these, so nothing else can be
stored. The code is short and auditable:
[`firebase/functions/src/stats/report.ts`](firebase/functions/src/stats/report.ts) builds the
report and [`telemetry/functions/src/validate.ts`](telemetry/functions/src/validate.ts) checks it.

## Turning it off

Any of these stops reports from the next daily run on:

- **In the app:** People & invites → **Anonymous usage statistics** → Off (admins).
- **At install:** answer `no` when `npm run setup` asks.
- **Permanently, for an install:** set `FLACK_TELEMETRY=off` in `firebase/functions/.env.<project>`
  and deploy. The admin switch then can't turn it back on.

Your own admins still get the **Health** card either way: that data stays in your project.

## Retention and access

Reports are kept for **13 months**, then deleted automatically. Only the Flack maintainers can
read individual reports; the public page shows aggregates only (counts per range, shares and
medians, never per-install data).

## Your own data

Separately from these reports, each install keeps daily health snapshots in its own Firebase
project for 90 days (shown to admins on the People & invites page), and production sends
performance data to the install's own Firebase Performance Monitoring. Neither leaves your
project.
