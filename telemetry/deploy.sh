#!/usr/bin/env bash
# Maintainers only: creates (first run) and deploys the project that collects anonymous
# statistics from Flack installs (TELEMETRY.md). Safe to re-run.
#
#   cp telemetry/project.env.example telemetry/project.env   # set FLACK_PROJECT once
#   BILLING_ACCOUNT=XXXXXX-XXXXXX-XXXXXX telemetry/deploy.sh # billing only needed on first run
#
# Every command goes through the Flack wrappers, pinned to the project in telemetry/project.env.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
export FLACK_PROJECT_ENV="$ROOT/telemetry/project.env"
[[ -f "$FLACK_PROJECT_ENV" ]] || { echo "Create telemetry/project.env first (see telemetry/project.env.example)." >&2; exit 1; }
# shellcheck source=/dev/null
source "$FLACK_PROJECT_ENV"
G="$ROOT/scripts/gcloud.sh"
FB() { "$ROOT/scripts/fb.sh" "$@" --project "$FLACK_PROJECT"; }
REGION="${FLACK_REGION:-us-central1}"

echo "▸ Project $FLACK_PROJECT"
if ! "$G" projects describe "$FLACK_PROJECT" >/dev/null 2>&1; then
  "$G" projects create "$FLACK_PROJECT" --name="Flack telemetry" --quiet
fi
if [[ -z "$("$G" billing projects describe "$FLACK_PROJECT" --format='value(billingAccountName)' 2>/dev/null || true)" ]]; then
  [[ -n "${BILLING_ACCOUNT:-}" ]] || { echo "Set BILLING_ACCOUNT for the first run (Cloud Functions need the Blaze plan)." >&2; exit 1; }
  "$G" billing projects link "$FLACK_PROJECT" --billing-account="$BILLING_ACCOUNT" >/dev/null
fi

echo "▸ Services"
"$G" services enable firebase.googleapis.com firestore.googleapis.com cloudfunctions.googleapis.com run.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com eventarc.googleapis.com pubsub.googleapis.com \
  cloudscheduler.googleapis.com firebasehosting.googleapis.com logging.googleapis.com --quiet

if ! FB apps:list WEB >/dev/null 2>&1; then
  "$ROOT/scripts/fb.sh" projects:addfirebase "$FLACK_PROJECT" --project "$FLACK_PROJECT" >/dev/null
fi
if ! "$G" firestore databases describe --database='(default)' >/dev/null 2>&1; then
  "$G" firestore databases create --database='(default)' --location="$REGION" --type=firestore-native --quiet >/dev/null
fi

echo "▸ No IP addresses in logs"
# Cloud Run request logs record the caller's IP; exclude them for the report endpoint so the
# collector never stores where reports came from.
if ! "$G" logging sinks describe _Default --format='value(exclusions)' 2>/dev/null | grep -q telemetry-no-request-logs; then
  "$G" logging sinks update _Default \
    --add-exclusion='name=telemetry-no-request-logs,filter=resource.type="cloud_run_revision" AND resource.labels.service_name="report" AND log_id("run.googleapis.com/requests")' >/dev/null
fi

echo "▸ Deploying"
npm run build -w telemetry/functions >/dev/null
deploy() { FB deploy --config telemetry/firebase.json --only firestore,functions,hosting --non-interactive --force; }
if ! deploy; then
  echo "  First deploys sometimes fail while Google sets up service accounts. Retrying in 60s…"
  sleep 60
  deploy
fi
echo "Telemetry collector: https://$FLACK_PROJECT.web.app (reports: /v1/report, public stats: /v1/stats)"
