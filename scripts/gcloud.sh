#!/usr/bin/env bash
# gcloud, pinned to the flack project and an isolated config dir.
set -euo pipefail
source "$(dirname "$0")/_lib.sh"
[[ -n "$FLACK_PROJECT" ]] || die "no project configured: run 'npm run setup' first (writes scripts/project.env)"
use_deployer_credentials

args=("$@")
for ((i = 0; i < ${#args[@]}; i++)); do
  a="${args[$i]}"
  case "$a" in
    --project=*) allowed_project "${a#--project=}" || die "refusing --project ${a#--project=}" ;;
    --project) allowed_project "${args[$((i + 1))]:-}" || die "refusing --project ${args[$((i + 1))]:-}" ;;
  esac
done
joined=" $* "
# Commands whose positional arg is a project id must name the flack project.
if [[ "$joined" == *" projects "* ]]; then
  [[ "$joined" == *" projects delete "* ]] && die "project deletion is never done from here"
  if [[ "$joined" =~ \ projects\ (create|describe|add-iam-policy-binding|get-iam-policy|link|unlink)\ ([^ ]+) ]]; then
    allowed_project "${BASH_REMATCH[2]}" || die "refusing to act on project ${BASH_REMATCH[2]}"
  fi
fi
[[ "$joined" == *" config set "* || "$joined" == *" configurations activate "* ]] && [[ "$joined" != *" config set project $FLACK_PROJECT "* && "$joined" != *" config set account "* ]] && die "refusing to change gcloud config"

exec gcloud "$@" --project "$FLACK_PROJECT"
