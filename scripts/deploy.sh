#!/usr/bin/env bash
# Deploys to the project in scripts/project.env (with the deployer service account key if
# present, otherwise your `npm run setup` login). `npm run deploy` runs `npm run verify` first.
#
# Order matters: rules + indexes go first and we wait until every index is READY, so the
# new functions and web app never run queries whose index is still building.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
[[ -n "$FLACK_PROJECT" ]] || die "no project configured: run 'npm run setup' first"
[[ -f "$ROOT/web/.env.production" ]] || die "missing web/.env.production: run 'npm run setup' first"

cd "$ROOT"
npm run build -w firebase/functions
npm run build -w web
node scripts/check-build.mjs

FB="$ROOT/scripts/fb.sh"
echo "== 1/3 Security rules and indexes"
"$FB" deploy --project "$FLACK_PROJECT" --only firestore:rules,firestore:indexes,storage,database --non-interactive --force

echo "== 2/3 Waiting for indexes"
"$ROOT/scripts/wait-indexes.sh"

echo "== 3/3 Functions and hosting"
"$FB" deploy --project "$FLACK_PROJECT" --only functions,hosting --non-interactive --force
echo "Deployed to https://$FLACK_PROJECT.web.app"
