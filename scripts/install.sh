#!/usr/bin/env bash
# Flack installer: sets up a Firebase project (new or existing) and deploys Flack to it.
#
#   npm run setup            # or: scripts/install.sh
#
# Safe to re-run: every step checks what already exists. Works on a laptop (with the Google
# Cloud SDK installed) and in Google Cloud Shell (nothing to install).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

bold=$'\e[1m'; dim=$'\e[2m'; green=$'\e[32m'; yellow=$'\e[33m'; red=$'\e[31m'; off=$'\e[0m'
step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$off"; }
ok() { printf '  %s✓%s %s\n' "$green" "$off" "$*"; }
warn() { printf '  %s!%s %s\n' "$yellow" "$off" "$*"; }
fail() { printf '\n%s✗ %s%s\n' "$red" "$*" "$off" >&2; exit 1; }
ask() { # ask VAR "Question" "default"
  local answer
  read -r -p "  $2${3:+ ${dim}[$3]${off}}: " answer
  printf -v "$1" '%s' "${answer:-$3}"
}

cat <<EOF

${bold}Flack installer${off}
Team chat on your own Firebase project. Firebase's Blaze plan is pay-as-you-go: a small
team normally stays inside the free quotas (often \$0/month), and this installer sets a
budget alert so you hear about it long before anything surprising happens.
EOF

# --- 1. Tools --------------------------------------------------------------------------------
step "Checking tools"
node_major=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
if (( node_major < 22 )); then
  fail "Node.js 22+ is required (found ${node_major}). With nvm: nvm install 22 && nvm use 22"
fi
ok "Node.js $(node -v)"
command -v gcloud >/dev/null 2>&1 || [[ -x "$HOME/google-cloud-sdk/bin/gcloud" ]] ||
  fail "The Google Cloud SDK (gcloud) is required: https://cloud.google.com/sdk/docs/install — or use Cloud Shell (see README)."
ok "Google Cloud SDK"
if [[ ! -x node_modules/.bin/firebase ]]; then
  echo "  Installing dependencies (npm ci)…"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
fi
ok "Dependencies"

# --- 2. Settings -----------------------------------------------------------------------------
step "Settings"
FLACK_PROJECT="" FLACK_REGION="" ADMIN_EMAIL="" BUDGET_USD="" TELEMETRY=""
[[ -f scripts/project.env ]] && source scripts/project.env
suggest="${FLACK_PROJECT:-flack-$(node -p 'require("crypto").randomBytes(3).toString("hex").slice(0, 5)')}"
ask FLACK_PROJECT "Firebase project id (new or existing; 6-30 chars, a-z 0-9 -)" "$suggest"
[[ "$FLACK_PROJECT" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]] || fail "'$FLACK_PROJECT' is not a valid project id."
[[ "$FLACK_PROJECT" != demo-* ]] || fail "Project ids starting with demo- are reserved for the emulators."
ask FLACK_REGION "Region for the database and files" "${FLACK_REGION:-us-central1}"
ask ADMIN_EMAIL "Your Google account email (becomes the first admin)" "${ADMIN_EMAIL:-}"
[[ "$ADMIN_EMAIL" == *@*.* ]] || fail "Enter the email of the Google account you'll sign in with."
ask BUDGET_USD "Monthly budget alert in USD (0 = none)" "${BUDGET_USD:-5}"
echo "  Flack can send its maintainers one small anonymous report a day (version, size ranges,"
echo "  features used, error counts). Never messages, names, emails or anything anyone wrote."
echo "  Details: TELEMETRY.md. You can change this anytime on the admin page."
ask TELEMETRY "Share anonymous usage statistics? (yes/no)" "${TELEMETRY:-yes}"
case "$(echo "$TELEMETRY" | tr '[:upper:]' '[:lower:]')" in
  y | yes | on) TELEMETRY=yes ;;
  n | no | off) TELEMETRY=no ;;
  *) fail "Answer yes or no." ;;
esac

cat > scripts/project.env <<EOF
# Written by scripts/install.sh. The ONLY real Google Cloud / Firebase project these scripts
# may touch; the emulators always use demo-flack.
FLACK_PROJECT="$FLACK_PROJECT"
FLACK_REGION="$FLACK_REGION"
ADMIN_EMAIL="$ADMIN_EMAIL"
BUDGET_USD="$BUDGET_USD"
TELEMETRY="$TELEMETRY"
EOF
ok "Saved scripts/project.env"

# Everything below goes through the repo's wrappers, pinned to this one project.
source scripts/_lib.sh
G="$ROOT/scripts/gcloud.sh"
FB() { "$ROOT/scripts/fb.sh" "$@" --project "$FLACK_PROJECT"; }
token() { "$G" auth print-access-token; }
api() { # api METHOD URL [JSON]: prints the response; on an HTTP error shows it and fails
  local out code
  out=$(curl -sS -X "$1" "$2" -H "Authorization: Bearer $(token)" -H "x-goog-user-project: $FLACK_PROJECT" \
    -H 'Content-Type: application/json' -w $'\n%{http_code}' ${3:+-d "$3"})
  code=${out##*$'\n'}
  out=${out%$'\n'*}
  if (( code >= 400 )); then printf '%s\n' "$out" >&2; return 1; fi
  printf '%s\n' "$out"
}
retry() { # retry a command for ~2 minutes: new projects take a while to grant their owner access
  local i
  for i in 1 2 3 4 5 6; do
    if (( i == 6 )); then "$@"; return; fi
    "$@" 2>/dev/null && return
    echo "  Google is still setting up access to the new project; retrying in 20s…"
    sleep 20
  done
}
quiet() { # run a command, showing its output only if it fails
  local out
  if ! out=$("$@" 2>&1); then printf '%s\n' "$out" >&2; return 1; fi
}

# --- 3. Sign in ------------------------------------------------------------------------------
step "Signing in to Google Cloud and Firebase"
# Outside Cloud Shell both logins are repo-local (see scripts/_lib.sh): your global Cloud SDK
# and Firebase CLI settings are never touched.
if [[ -n "${CLOUD_SHELL:-}" ]]; then
  ok "Google Cloud: your Cloud Shell account"
else
  if [[ -z "$("$G" auth list --filter=status:ACTIVE --format='value(account)' 2>/dev/null)" ]]; then
    "$G" auth login
  fi
  ok "Google Cloud: $("$G" auth list --filter=status:ACTIVE --format='value(account)')"
fi
if [[ -f "$SA_KEY" ]]; then
  ok "Firebase CLI: deployer service account"
else
  logins=$(FB login:list 2>/dev/null || true)
  if grep -q '@' <<<"$logins"; then
    ok "Firebase CLI: already signed in"
  else
    # The Firebase CLI needs its own login (it can't reuse the Cloud SDK's).
    if [[ -n "${CLOUD_SHELL:-}" ]]; then FB login --no-localhost; else FB login; fi
    ok "Firebase CLI: signed in"
  fi
fi

# --- 4. Project and billing ------------------------------------------------------------------
step "Project $FLACK_PROJECT"
if "$G" projects describe "$FLACK_PROJECT" >/dev/null 2>&1; then
  ok "Using the existing project"
else
  "$G" projects create "$FLACK_PROJECT" --name="Flack" --quiet
  ok "Created the project"
fi

step "Billing (Blaze, pay-as-you-go)"
billing=$("$G" billing projects describe "$FLACK_PROJECT" --format='value(billingAccountName)' 2>/dev/null || true)
if [[ -n "$billing" ]]; then
  ok "Billing already linked (${billing#billingAccounts/})"
else
  accounts=()
  while IFS= read -r line; do [[ -n "$line" ]] && accounts+=("$line"); done \
    < <("$G" billing accounts list --filter=open=true --format='value(name.basename(),displayName)')
  (( ${#accounts[@]} )) || fail "No open billing account. Create one at https://console.cloud.google.com/billing and re-run."
  echo "  Billing accounts:"
  for i in "${!accounts[@]}"; do printf '    %d) %s\n' "$((i + 1))" "${accounts[$i]}"; done
  ask pick "Which one?" "1"
  billing="billingAccounts/$(echo "${accounts[$((pick - 1))]}" | awk '{print $1}')"
  quiet "$G" billing projects link "$FLACK_PROJECT" --billing-account="${billing#billingAccounts/}"
  ok "Linked ${billing#billingAccounts/}"
fi

# --- 5. Services -----------------------------------------------------------------------------
step "Turning on the Google Cloud services Flack uses (takes a minute)"
enable_services
ok "Services enabled"

step "Firebase"
if FB apps:list WEB >/dev/null 2>&1; then
  ok "Firebase is already on"
else
  quiet "$ROOT/scripts/fb.sh" projects:addfirebase "$FLACK_PROJECT" --project "$FLACK_PROJECT"
  ok "Added Firebase to the project"
fi

if "$G" firestore databases describe --database='(default)' >/dev/null 2>&1; then
  ok "Firestore database exists"
else
  quiet "$G" firestore databases create --database='(default)' --location="$FLACK_REGION" --type=firestore-native --quiet
  ok "Created the Firestore database ($FLACK_REGION)"
fi

case "$FLACK_REGION" in europe-*) RTDB_LOC=europe-west1 ;; asia-*) RTDB_LOC=asia-southeast1 ;; *) RTDB_LOC=us-central1 ;; esac
RTDB_NAME="$FLACK_PROJECT-default-rtdb"
instances=$(FB database:instances:list 2>/dev/null || true)
if grep -q "$RTDB_NAME" <<<"$instances"; then
  ok "Realtime Database exists"
else
  # The first (default) instance can only be created through the management API.
  retry api POST "https://firebasedatabase.googleapis.com/v1beta/projects/$FLACK_PROJECT/locations/$RTDB_LOC/instances?databaseId=$RTDB_NAME" \
    '{"type":"DEFAULT_DATABASE"}' >/dev/null
  ok "Created the Realtime Database ($RTDB_LOC)"
fi
case "$RTDB_LOC" in us-central1) RTDB_URL="https://$RTDB_NAME.firebaseio.com" ;; *) RTDB_URL="https://$RTDB_NAME.$RTDB_LOC.firebasedatabase.app" ;; esac

BUCKET="$FLACK_PROJECT.firebasestorage.app"
if "$G" storage buckets describe "gs://$BUCKET" >/dev/null 2>&1; then
  ok "Storage bucket exists"
else
  retry api POST "https://firebasestorage.googleapis.com/v1alpha/projects/$FLACK_PROJECT/defaultBucket" "{\"location\":\"$FLACK_REGION\"}" >/dev/null
  ok "Created the Storage bucket"
fi

step "Sign-in (Identity Platform, invite-only)"
api POST "https://identitytoolkit.googleapis.com/v2/projects/$FLACK_PROJECT/identityPlatform:initializeAuth" '{}' >/dev/null 2>&1 || true
ok "Identity Platform on"

# --- 6. Config -------------------------------------------------------------------------------
step "Writing the app config"
if grep -q "^VITE_FIREBASE_PROJECT_ID=$FLACK_PROJECT$" web/.env.production 2>/dev/null; then
  ok "web/.env.production already set up for $FLACK_PROJECT (kept as is)"
else
app_id=$(FB apps:list WEB --json 2>/dev/null | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8")).result||[];console.log(r[0]?.appId||"")')
if [[ -z "$app_id" ]]; then
  quiet FB apps:create WEB Flack
  app_id=$(FB apps:list WEB --json | node -e 'console.log((JSON.parse(require("fs").readFileSync(0,"utf8")).result||[])[0]?.appId||"")')
fi
FB apps:sdkconfig WEB "$app_id" --json | RTDB_URL="$RTDB_URL" BUCKET="$BUCKET" node -e '
  const c = JSON.parse(require("fs").readFileSync(0, "utf8")).result.sdkConfig;
  const lines = [
    "# Written by scripts/install.sh. Public Firebase web config (not secret; shipped in the bundle).",
    "VITE_USE_EMULATORS=false",
    `VITE_FIREBASE_API_KEY=${c.apiKey}`,
    `VITE_FIREBASE_AUTH_DOMAIN=${c.authDomain}`,
    `VITE_FIREBASE_PROJECT_ID=${c.projectId}`,
    `VITE_FIREBASE_STORAGE_BUCKET=${process.env.BUCKET}`,
    `VITE_FIREBASE_DATABASE_URL=${process.env.RTDB_URL}`,
    `VITE_FIREBASE_APP_ID=${c.appId}`,
    `VITE_FIREBASE_MESSAGING_SENDER_ID=${c.messagingSenderId}`,
  ];
  require("fs").writeFileSync("web/.env.production", lines.join("\n") + "\n");'
ok "web/.env.production"
fi
cat > "firebase/functions/.env.$FLACK_PROJECT" <<EOF
# Written by scripts/install.sh. The first account with this email to sign in becomes admin.
FIRST_ADMIN_EMAIL=$ADMIN_EMAIL
APP_URL=https://$FLACK_PROJECT.web.app
FLACK_REGION=$FLACK_REGION
# Anonymous usage statistics (TELEMETRY.md): on or off. Admins can also switch them off in the app.
FLACK_TELEMETRY=$([[ "$TELEMETRY" == yes ]] && echo on || echo off)
EOF
ok "firebase/functions/.env.$FLACK_PROJECT"

step "Storage access for the app"
quiet "$ROOT/scripts/prod-setup.sh"
ok "CORS and rules access configured"

if [[ "$BUDGET_USD" != "0" ]]; then
  step "Budget alert (US\$$BUDGET_USD / month)"
  budget_projects=$("$G" billing budgets list --billing-account="${billing#billingAccounts/}" --format='value(budgetFilter.projects)' 2>/dev/null || true)
  num=$("$G" projects describe "$FLACK_PROJECT" --format='value(projectNumber)')
  if grep -q "projects/$num" <<<"${budget_projects:-}"; then
    ok "This project already has a budget alert"
  elif "$G" billing budgets create --billing-account="${billing#billingAccounts/}" --display-name="Flack $FLACK_PROJECT" \
    --budget-amount="${BUDGET_USD}USD" --filter-projects="projects/$FLACK_PROJECT" \
    --threshold-rule=percent=0.5 --threshold-rule=percent=0.9 --threshold-rule=percent=1.0 >/dev/null 2>&1; then
    ok "Emails go to the billing account's admins at 50%, 90% and 100%"
  else
    warn "Couldn't create the budget (needs Billing Account Administrator). Set one at https://console.cloud.google.com/billing/budgets"
  fi
fi

# --- 6b. Ask Flackbot quota -----------------------------------------------------------------
# New projects get no Vertex AI quota for Claude. Ask Google for a modest amount now (it's often
# approved within minutes, and costs nothing until Ask Flackbot is turned on and used).
step "Vertex AI quota for Ask Flackbot (optional AI)"
if api POST "https://cloudquotas.googleapis.com/v1/projects/$FLACK_PROJECT/locations/global/quotaPreferences?quotaPreferenceId=flackbot-claude-sonnet" \
  "{\"service\":\"aiplatform.googleapis.com\",\"quotaId\":\"GlobalOnlinePredictionRequestsPerMinutePerProjectPerBaseModel\",\"dimensions\":{\"base_model\":\"anthropic-claude-sonnet\"},\"quotaConfig\":{\"preferredValue\":\"60\"},\"contactEmail\":\"$ADMIN_EMAIL\",\"justification\":\"Internal team chat assistant (Flack): answers employees' questions about their workspace messages. Low volume.\"}" >/dev/null 2>&1; then
  ok "Requested 60 Claude Sonnet requests/minute (Google emails $ADMIN_EMAIL when it's decided)"
else
  warn "Couldn't request it (it may already exist). You can ask later: https://console.cloud.google.com/iam-admin/quotas?project=$FLACK_PROJECT"
fi

# --- 7. Deploy -------------------------------------------------------------------------------
step "Deploying (first deploy takes 5-10 minutes)"
if ! "$ROOT/scripts/deploy.sh"; then
  warn "First deploys sometimes fail while Google finishes setting up service accounts. Retrying in 60s…"
  sleep 60
  "$ROOT/scripts/deploy.sh"
fi

if [[ "$BUDGET_USD" == 0 ]]; then budget_note="No budget alert set."; else budget_note="Your budget alert: US\$$BUDGET_USD/month."; fi
cat <<EOF

${green}${bold}Flack is deployed: https://$FLACK_PROJECT.web.app${off}

${bold}One last click${off} (Google doesn't allow scripts to do this):
  1. Open https://console.firebase.google.com/project/$FLACK_PROJECT/authentication/providers
  2. Add new provider → ${bold}Google${off} → Enable → pick a support email → Save.

Then open https://$FLACK_PROJECT.web.app and sign in as ${bold}$ADMIN_EMAIL${off}.
You'll be the admin; invite everyone else from the Admin page.

Costs: Blaze is pay-as-you-go. See README → Costs. $budget_note

${bold}Optional: Ask Flackbot (AI answers over your team's messages)${off}
  Everything is set up except one step Google keeps for people: accepting Anthropic's terms.
  1. Open https://console.cloud.google.com/vertex-ai/publishers/anthropic/model-garden/claude-sonnet-5-5?project=$FLACK_PROJECT
  2. Click ${bold}Enable${off} and follow the form.
  3. Wait for Google to approve the Claude quota requested above (an email to $ADMIN_EMAIL).
  4. In Flack: People & invites → Ask Flackbot → Check the connection, then turn it on.
EOF
