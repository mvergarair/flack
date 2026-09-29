# Flack: notes for Claude Code

@AGENTS.md

Claude Code specifics: the PreToolUse hook in `.claude/settings.json` blocks direct Google Cloud
and Firebase CLI calls (use `scripts/gcloud.sh` / `scripts/fb.sh`), and `.claude/launch.json`
has preview configs for the emulators, the web app and the landing site.
