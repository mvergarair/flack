#!/usr/bin/env bash
# One-time production setup that a normal deploy doesn't cover. Safe to re-run.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
G="$ROOT/scripts/gcloud.sh"
NUM=$("$G" projects describe "$FLACK_PROJECT" --format='value(projectNumber)')
BUCKET="gs://$FLACK_PROJECT.firebasestorage.app"

# 1. The web client downloads attachments with getBlob() (never public URLs), which needs CORS
#    for the app's own origins.
CORS="$(mktemp)"
trap 'rm -f "$CORS"' EXIT
cat > "$CORS" <<EOF
[{
  "origin": ["https://$FLACK_PROJECT.web.app", "https://$FLACK_PROJECT.firebaseapp.com"],
  "method": ["GET", "HEAD"],
  "responseHeader": ["Content-Type", "Content-Disposition", "Authorization", "x-goog-meta-uploaderId"],
  "maxAgeSeconds": 3600
}]
EOF
"$G" storage buckets update "$BUCKET" --cors-file="$CORS"

# 2. Storage rules call firestore.get() (channel membership); the Storage service agent needs
#    permission to read Firestore for that.
"$G" beta services identity create --service=firebasestorage.googleapis.com >/dev/null 2>&1 || true
"$G" projects add-iam-policy-binding "$FLACK_PROJECT" \
  --member="serviceAccount:service-$NUM@gcp-sa-firebasestorage.iam.gserviceaccount.com" \
  --role="roles/firebaserules.firestoreServiceAgent" --condition=None --quiet >/dev/null
echo "prod setup done"
