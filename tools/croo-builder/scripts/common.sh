#!/bin/bash
# Shared helpers for the Ship Deck scripts. Every script prints plain-English steps:
#   "▶ step", "✔ done", "✖ problem" (the app colors these lines).
set -euo pipefail

# SCRIPT_ROOT is the CrooHQ checkout these scripts live in (Ship Deck itself updates from there).
# ROOT is the app being worked on: the CROO_APP_DIR Ship Deck passes in, or CrooHQ when run by hand.
SCRIPT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
ROOT="${CROO_APP_DIR:-$SCRIPT_ROOT}"
APP_ID="${CROO_APP_ID:-croohq}"
cd "$ROOT" || { printf '%s\n' "✖ Can't find the app folder: $ROOT"; exit 1; }

# Per-app settings. CrooHQ is exactly as it always was.
APP_NAME="CrooHQ"
APP_BACKUPS="CrooHQ backups"      # Developer › <this folder> holds copies of Xcode project changes that get set aside
RESET_PBX=1                       # 1 = set aside Xcode's own edits to the project file before pulling; 0 = keep them (they may be real)
APP_PIECES="iPhone, widgets, Watch and Vision Pro"
APP_TEAM=""                       # fallback Apple team ID if the Xcode project doesn't carry one yet
NEW_TESTING_NEEDS_OK=0            # 1 = Ship Deck asks before creating this app's testing branch
EXTRA_PRE_PULL_ONLY=()
case "$APP_ID" in
  croohq) ;;
  shredpal)
    APP_NAME="ShredPal"
    APP_BACKUPS="ShredPal backups"
    RESET_PBX=0
    APP_PIECES="the iPhone app"
    APP_TEAM="5Y4D3V56HU"
    NEW_TESTING_NEEDS_OK=1
    # Swift Package Manager list that `cap sync` writes: must stay as cap sync left it, so it's only reset before pulling.
    EXTRA_PRE_PULL_ONLY=("ios/App/CapApp-SPM/Package.swift")
    ;;
  *) printf '%s\n' "✖ Ship Deck doesn't know an app called “$APP_ID”."; exit 1 ;;
esac

PBX="ios/App/App.xcodeproj/project.pbxproj"
# Apps with CocoaPods have a workspace; Swift Package Manager apps (ShredPal) don't, so the project file is used.
WORKSPACE="ios/App/App.xcworkspace"
if [[ -d "$WORKSPACE" ]]; then
  XCTARGET=(-workspace "$WORKSPACE")
else
  XCTARGET=(-project "ios/App/App.xcodeproj")
fi
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
BACKUP_FILES=()
[[ "$RESET_PBX" == "1" ]] && BACKUP_FILES=("$PBX")
REGENERATED_FILES=(
  "package-lock.json"
  "ios/App/App/capacitor.config.json"
  "ios/App/App/config.xml"
)
# Podfile.lock is only reset BEFORE pulling (so a pull never gets blocked); after `cap sync`
# it must stay as CocoaPods left it, or Xcode says "sandbox is not in sync with the Podfile.lock".
PRE_PULL_ONLY=("ios/App/Podfile.lock" ${EXTRA_PRE_PULL_ONLY[@]+"${EXTRA_PRE_PULL_ONLY[@]}"})

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
        backup="$HOME/Developer/$APP_BACKUPS/$stamp"
        mkdir -p "$backup"
        cp "$f" "$backup/$(basename "$f")"
        printf '%s\n' "  Set aside Xcode project changes (copy saved in Developer › $APP_BACKUPS › $stamp)."
      fi
      git checkout -- "$f"
    fi
  done
}

# The one branch where new iOS and Duo work waits to be tested. Lovable never sees it; main is what Lovable follows.
TEST_BRANCH="testing"

current_branch() { git rev-parse --abbrev-ref HEAD; }

# Stops if there are real edits that aren't sent to GitHub yet.
require_clean() {
  local dirty
  dirty="$(git status --porcelain | grep -v '^??' || true)"
  if [[ -n "$dirty" ]]; then
    printf '%s\n' "✖ This Mac has local changes that aren't on GitHub yet:"
    printf '%s\n' "$dirty"
    printf '%s\n' "  Press “Send local changes to GitHub” first (or ask Claude what they are)."
    exit 2
  fi
}

# First time for an app: its testing branch doesn't exist yet. Make it from main (keeping any edits already on this Mac,
# so they can be sent to testing instead of being thrown away). Apps that need an OK first stop here with code 3.
create_testing_if_missing() {
  git fetch -q origin 2>/dev/null || true
  git show-ref --verify --quiet "refs/heads/$TEST_BRANCH" && return 0
  git show-ref --verify --quiet "refs/remotes/origin/$TEST_BRANCH" && return 0
  if [[ "$NEW_TESTING_NEEDS_OK" == "1" && "${CROO_CREATE_TESTING:-}" != "1" ]]; then
    printf '%s\n' "✖ $APP_NAME has no testing branch yet. Ship Deck will ask for your OK to create one (nothing was changed)."
    exit 3
  fi
  [[ "$(current_branch)" == "main" ]] || fail "$APP_NAME has no testing branch, and this Mac isn't on main, so it can't create one safely. Ask Claude."
  git merge-base --is-ancestor HEAD origin/main && git merge-base --is-ancestor origin/main HEAD || fail "This Mac's main differs from GitHub's main, so a testing branch wasn't created. Ask Claude."
  git checkout -q -b "$TEST_BRANCH" || fail "Couldn't create the testing branch."
  ok "Created the testing branch for $APP_NAME (from main). Any edits already on this Mac came along."
}

# Puts this Mac on the given branch (needs a clean tree; creates it from GitHub if this Mac doesn't have it yet).
ensure_branch() {
  local want="$1"
  [[ "$(current_branch)" == "$want" ]] && return 0
  git fetch -q origin 2>/dev/null || true
  if git show-ref --verify --quiet "refs/heads/$want"; then
    git checkout -q "$want" || fail "Couldn't switch this Mac to $want."
  elif git show-ref --verify --quiet "refs/remotes/origin/$want"; then
    git checkout -q -b "$want" "origin/$want" || fail "Couldn't switch this Mac to $want."
  elif [[ "$want" == "$TEST_BRANCH" ]]; then
    create_testing_if_missing
    git show-ref --verify --quiet "refs/heads/$want" || git checkout -q -b "$want" origin/main || fail "Couldn't create $want."
  else
    fail "This Mac has no branch called $want."
  fi
  ok "Switched this Mac to $want"
}

pull_latest() {
  local b="${1:-$(current_branch)}"
  step "Getting the latest $b from GitHub"
  git fetch -q origin || fail "Couldn't reach GitHub. Copy this log to Claude."
  if git show-ref --verify --quiet "refs/remotes/origin/$b"; then
    git pull --rebase --quiet origin "$b" || fail "Couldn't pull $b from GitHub. Copy this log to Claude."
  else
    printf '%s\n' "  ($b isn't on GitHub yet. It gets created the first time local changes are sent.)"
  fi
  ok "Up to date with GitHub ($(git log -1 --format='%h · %s' | cut -c1-70))"
}

# Brings Lovable's newest fixes (which land on main) into testing, so a test build includes them.
catch_up_with_main() {
  step "Catching up with main (Lovable's latest fixes)"
  git fetch -q origin main || fail "Couldn't reach GitHub. Copy this log to Claude."
  if git merge-base --is-ancestor origin/main HEAD; then
    ok "Testing already has everything on main"
    return 0
  fi
  if git merge --no-edit -q origin/main >/dev/null 2>&1; then
    ok "Brought main's newest changes into testing"
  else
    git merge --abort 2>/dev/null || true
    fail "Main and testing changed the same lines, so nothing was merged and nothing was lost. Press “Copy error” and paste it to Claude."
  fi
}

# Makes sure Xcode's CocoaPods folder matches Podfile.lock (runs `pod install` only when needed).
ensure_pods() {
  local lock="ios/App/Podfile.lock" manifest="ios/App/Pods/Manifest.lock"
  [[ -f ios/App/Podfile ]] || return 0   # Swift Package Manager apps have no CocoaPods
  if [[ ! -f "$manifest" ]] || ! cmp -s "$lock" "$manifest"; then
    step "Syncing the iPhone app's libraries (CocoaPods)"
    (cd ios/App && pod install --silent) >"$CACHE/pod-install.log" 2>&1 || { tail -20 "$CACHE/pod-install.log"; grep -q "Unable to find compatibility version string" "$CACHE/pod-install.log" && fail "This Mac's CocoaPods is too old for the Xcode project. Update it once in Terminal: brew upgrade cocoapods (or: sudo gem install cocoapods)."; fail "pod install failed."; }
    ok "Libraries in sync"
  fi
}
