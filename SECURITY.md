# Security policy

Flack runs on each installer's own Firebase project, so its security rules and functions are
what protect every team's messages and files. Reports are very welcome.

## Reporting a vulnerability

Please **don't open a public issue**. Use GitHub's private reporting instead:
[Report a vulnerability](https://github.com/mvergarair/flack/security/advisories/new).

Include what an attacker can do, the steps to reproduce (ideally against the local emulators)
and the version (the admin page shows it). We aim to reply within a week and will credit you in
the release notes unless you'd rather not be named.

## Supported versions

Security fixes go into the latest release. Installed copies get them with `npm run update`.

## Scope

In scope: `firebase/*.rules`, the Cloud Functions in `firebase/functions`, the web app, and the
install and update scripts. Out of scope: Firebase or Google Cloud themselves (report those to
Google), and misconfiguration of an individual installation.
