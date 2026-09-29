#!/usr/bin/env bash
# Updates an installed Flack to the latest version, keeping your settings:
#
#   npm run update
#
# Pulls the latest code, installs dependencies, turns on any Google Cloud services the new
# version needs and deploys. It doesn't run the test suite (that needs Java and test
# browsers); `npm run deploy` does, for contributors.
set -euo pipefail

main() {
  ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
  cd "$ROOT"
  local bold=$'\e[1m' green=$'\e[32m' yellow=$'\e[33m' red=$'\e[31m' off=$'\e[0m'
  step() { printf '\n%s▸ %s%s\n' "$bold" "$*" "$off"; }
  ok() { printf '  %s✓%s %s\n' "$green" "$off" "$*"; }
  warn() { printf '  %s!%s %s\n' "$yellow" "$off" "$*"; }
  fail() { printf '\n%s✗ %s%s\n' "$red" "$*" "$off" >&2; exit 1; }
  version() { node -p 'require("./package.json").version'; }

  [[ -f scripts/project.env ]] || fail "No Flack project is configured in this folder. Run 'npm run setup' first."
  (($(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0) >= 22)) ||
    fail "Node.js 22+ is required. With nvm: nvm install 22 && nvm use 22"

  if [[ "${1:-}" != --pulled ]]; then
    step "Getting the latest version"
    local before
    before=$(version)
    if [[ -d .git ]]; then
      git pull --ff-only ||
        fail "Couldn't update automatically (you probably changed Flack's code). Run 'git pull', resolve any conflicts, then 'npm run update' again."
    else
      fail "This folder isn't a git clone. Download the latest code over it (keep scripts/project.env, web/.env.production and firebase/functions/.env.*), then run 'npm run update' again."
    fi
    # Continue with the freshly pulled copy of this script, so updates can change how updating works.
    FLACK_VERSION_BEFORE="$before" exec "$ROOT/scripts/update.sh" --pulled
  fi

  local before="${FLACK_VERSION_BEFORE:-}" after
  after=$(version)
  if [[ -n "$before" && "$before" != "$after" ]]; then ok "Flack $before → $after"; else ok "Flack $after (already the latest code)"; fi

  step "Dependencies"
  npm ci --no-audit --no-fund --loglevel=error >/dev/null
  ok "Installed"

  step "Google Cloud services"
  source "$ROOT/scripts/_lib.sh"
  if enable_services >/dev/null 2>&1; then
    ok "Everything this version needs is on"
  else
    warn "Couldn't check services (your login may not be allowed to); continuing."
  fi

  step "Deploying"
  "$ROOT/scripts/deploy.sh"

  printf '\n%s%sFlack %s is live: https://%s.web.app%s\n' "$green" "$bold" "$after" "$FLACK_PROJECT" "$off"
  echo "What changed: CHANGELOG.md"
}

main "$@"
