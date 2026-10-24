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
# CocoaPods installed as a Ruby gem lives in one of these.
for d in "$HOME"/.gem/ruby/*/bin /opt/homebrew/lib/ruby/gems/*/bin /usr/local/lib/ruby/gems/*/bin "$HOME/.rbenv/shims"; do
  [[ -d "$d" ]] && PATH="$d:$PATH"
done
export PATH
export LANG="en_US.UTF-8"

step() { printf '%s\n' "▶ $1"; }
ok()   { printf '%s\n' "✔ $1"; }
fail() { printf '%s\n' "✖ $1"; exit 1; }

# Files that tools rewrite on their own (Xcode, npm, CocoaPods, Capacitor) get reset so a pull
# never gets blocked. Only the Xcode project file is worth a backup (you might have changed a
# setting on purpose); the others are always regenerated, so they're reset without a copy.
BACKUP_FILES=("$PBX")
REGENERATED_FILES=(
  "package-lock.json"
  "ios/App/App/capacitor.config.json"
  "ios/App/App/config.xml"
)
# Podfile.lock is only reset BEFORE pulling (so a pull never gets blocked); after `cap sync`
# it must stay as CocoaPods left it, or Xcode says "sandbox is not in sync with the Podfile.lock".
PRE_PULL_ONLY=("ios/App/Podfile.lock")

# reset_auto_files [quiet]  — "quiet" = after our own npm/cap steps: reset everything, no backup.
reset_auto_files() {
  local mode="${1:-}"
  local f
  for f in "${REGENERATED_FILES[@]}"; do
    if [[ -e "$f" ]] && ! git diff --quiet -- "$f" 2>/dev/null; then git checkout -- "$f"; fi
  done
  if [[ "$mode" != "quiet" ]]; then
    for f in "${PRE_PULL_ONLY[@]}"; do
      if [[ -e "$f" ]] && ! git diff --quiet -- "$f" 2>/dev/null; then git checkout -- "$f"; fi
    done
  fi
  for f in "${BACKUP_FILES[@]}"; do
    if [[ -e "$f" ]] && ! git diff --quiet -- "$f" 2>/dev/null; then
      if [[ "$mode" != "quiet" ]]; then
        local stamp backup
        stamp="$(date +%Y-%m-%d_%H%M%S)"
        backup="$HOME/Developer/CrooHQ backups/$stamp"
        mkdir -p "$backup"
        cp "$f" "$backup/$(basename "$f")"
        printf '%s\n' "  Set aside Xcode project changes (copy saved in Developer › CrooHQ backups › $stamp)."
      fi
      git checkout -- "$f"
    fi
  done
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

# Makes sure Xcode's CocoaPods folder matches Podfile.lock (runs `pod install` only when needed).
ensure_pods() {
  local lock="ios/App/Podfile.lock" manifest="ios/App/Pods/Manifest.lock"
  if [[ ! -f "$manifest" ]] || ! cmp -s "$lock" "$manifest"; then
    step "Syncing the iPhone app's libraries (CocoaPods)"
    (cd ios/App && pod install --silent) >"$CACHE/pod-install.log" 2>&1 || { tail -20 "$CACHE/pod-install.log"; grep -q "Unable to find compatibility version string" "$CACHE/pod-install.log" && fail "This Mac's CocoaPods is too old for the Xcode project. Update it once in Terminal: brew upgrade cocoapods (or: sudo gem install cocoapods)."; fail "pod install failed."; }
    ok "Libraries in sync"
  fi
}
