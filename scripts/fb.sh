#!/usr/bin/env bash
# firebase-tools (repo-local version), pinned to demo-flack or the flack project.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"

project=""
args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  case "${args[$i]}" in
    --project=*) project="${args[$i]#--project=}" ;;
    --project | -P) project="${args[$((i + 1))]:-}" ;;
  esac
done
[[ -n "$project" ]] || die "pass --project explicitly (demo-flack or \$FLACK_PROJECT)"
allowed_project "$project" || die "refusing project '$project'"
[[ " $* " == *" use "* ]] && die "'firebase use' is not allowed; pass --project"
# Real credentials only for the real project; emulator runs (demo-flack) get none at all.
if [[ "$project" == demo-flack ]]; then
  unset GOOGLE_APPLICATION_CREDENTIALS
else
  use_deployer_credentials
fi

cd "$ROOT"
exec "$ROOT/node_modules/.bin/firebase" "$@"
