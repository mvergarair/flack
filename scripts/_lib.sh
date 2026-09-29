# shellcheck shell=bash
# Shared by gcloud.sh / fb.sh / deploy.sh. Isolates every CLI from the user's global config.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FLACK_PROJECT="${FLACK_PROJECT:-}"
# Settings written by `npm run setup` (see scripts/project.env.example). FLACK_PROJECT_ENV
# points the wrappers at another settings file (e.g. telemetry/project.env for the maintainers'
# statistics project); they stay pinned to whichever project it names.
PROJECT_ENV="${FLACK_PROJECT_ENV:-$ROOT/scripts/project.env}"
# shellcheck source=/dev/null
[[ -f "$PROJECT_ENV" ]] && source "$PROJECT_ENV"
if [[ -z "${CLOUD_SHELL:-}" ]]; then
  # Cloud Shell is a throwaway VM already signed in to the user's account; elsewhere, fence
  # every CLI into repo-local config so the user's other projects are never touched.
  export CLOUDSDK_CONFIG="$ROOT/.gcloud/config"      # isolated gcloud config dir (never ~/.config/gcloud)
  export XDG_CONFIG_HOME="$ROOT/.gcloud/xdg"         # isolated firebase-tools login store
  mkdir -p "$CLOUDSDK_CONFIG" "$XDG_CONFIG_HOME"
fi
SA_KEY="$ROOT/.secrets/flack-deployer.json"
# Real-project credentials for firebase-tools: a deployer service account key if there is one,
# otherwise the repo-local `firebase login` made by `npm run setup`.
use_deployer_credentials() {
  # Only for the project the key belongs to (it has no rights anywhere else).
  if [[ -f "$SA_KEY" ]] && grep -q "\"project_id\": *\"$FLACK_PROJECT\"" "$SA_KEY"; then
    export GOOGLE_APPLICATION_CREDENTIALS="$SA_KEY"
  fi
  return 0
}

die() { echo "flack-guard: $*" >&2; exit 64; }

allowed_project() {
  [[ "$1" == demo-flack || ( -n "$FLACK_PROJECT" && "$1" == "$FLACK_PROJECT" ) ]]
}

# The emulators need Java 21+; GUI-launched shells may have an older default on PATH.
if [[ -x /usr/libexec/java_home ]] && JH="$(/usr/libexec/java_home -v 21+ 2>/dev/null)"; then
  export JAVA_HOME="$JH"
  export PATH="$JAVA_HOME/bin:$PATH"
fi

# GUI-launched shells may also miss the Cloud SDK or default to an older Node (nvm order).
if ! command -v gcloud >/dev/null 2>&1 && [[ -x "$HOME/google-cloud-sdk/bin/gcloud" ]]; then
  export PATH="$HOME/google-cloud-sdk/bin:$PATH"
fi
if [[ "$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)" -lt 22 ]]; then
  N22="$(ls -d "$HOME"/.nvm/versions/node/v22.* 2>/dev/null | sort -V | tail -1)"
  [[ -n "$N22" ]] && export PATH="$N22/bin:$PATH"
fi
