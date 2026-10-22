#!/bin/bash
# Shared helpers for the Croo Builder scripts. Every script prints plain-English steps:
#   "▶ step", "✔ done", "✖ problem" (the app colors these lines).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
cd "$ROOT"

PBX="ios/App/App.xcodeproj/project.pbxproj"
WORKSPACE="ios/App/App.xcworkspace"
CACHE="$HOME/Library/Caches/CrooBuilder"
mkdir -p "$CACHE"

# Homebrew / Node paths for apps launched from Finder (no Terminal profile).
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.nvm/versions/node/$(ls "$HOME/.nvm/versions/node" 2>/dev/null | tail -1)/bin:$PATH"
export LANG="en_US.UTF-8"

step() { printf '%s\n' "▶ $1"; }
ok()   { printf '%s\n' "✔ $1"; }
fail() { printf '%s\n' "✖ $1"; exit 1; }

# Files that tools rewrite on their own (Xcode, npm, CocoaPods, Capacitor).
# Changes to these are backed up to the Desktop and reset so a pull never gets blocked.
AUTO_FILES=(
  "$PBX"
  "package-lock.json"
  "ios/App/Podfile.lock"
  "ios/App/App/capacitor.config.json"
  "ios/App/App/config.xml"
)

reset_auto_files() {
  local backup="$HOME/Desktop/CrooHQ backups/$(date +%Y-%m-%d_%H%M%S)"
  local moved=0
  for f in "${AUTO_FILES[@]}"; do
    if [[ -e "$f" ]] && ! git diff --quiet -- "$f" 2>/dev/null; then
      mkdir -p "$backup/$(dirname "$f")"
      cp "$f" "$backup/$f"
      git checkout -- "$f"
      moved=1
    fi
  done
  if (( moved )); then
    printf '%s\n' "  Set aside changes Xcode/npm made on their own (copy saved in Desktop › CrooHQ backups)."
  fi
}

# Stops if there are real edits that aren't saved to GitHub yet.
require_clean() {
  local dirty
  dirty="$(git status --porcelain | grep -v '^??' || true)"
  if [[ -n "$dirty" ]]; then
    printf '%s\n' "✖ This Mac has changes that aren't on GitHub yet:"
    printf '%s\n' "$dirty"
    printf '%s\n' "  Press “Save my changes” first (or ask Claude what they are)."
    exit 2
  fi
}

pull_latest() {
  step "Getting the latest from GitHub"
  git pull --rebase --quiet origin main || fail "Couldn't pull from GitHub. Copy this log to Claude."
  ok "Up to date with GitHub ($(git log -1 --format='%h · %s' | cut -c1-70))"
}
