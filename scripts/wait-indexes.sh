#!/usr/bin/env bash
# Polls Firestore until every composite index in the flack project is READY.
# New indexes build asynchronously after `firebase deploy`; queries that need them fail
# until then, so deploy.sh waits here before shipping code that uses them.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
G="$ROOT/scripts/gcloud.sh"
TIMEOUT_S="${INDEX_WAIT_TIMEOUT_S:-1200}"
start=$(date +%s)

while :; do
  json=$("$G" firestore indexes composite list --format=json) || die "could not list Firestore indexes"
  pending=$(echo "$json" | node -e '
    const idx = JSON.parse(require("fs").readFileSync(0, "utf8"));
    const notReady = idx.filter((i) => i.state !== "READY");
    for (const i of notReady) console.error(`  ${i.state}: ${i.name.split("/collectionGroups/")[1]}`);
    console.log(notReady.length);')
  if [[ "$pending" == "0" ]]; then
    echo "All Firestore indexes are READY."
    exit 0
  fi
  if (( $(date +%s) - start > TIMEOUT_S )); then
    die "timed out waiting for $pending index(es) to build"
  fi
  echo "Waiting for $pending Firestore index(es) to finish building…"
  sleep 15
done
