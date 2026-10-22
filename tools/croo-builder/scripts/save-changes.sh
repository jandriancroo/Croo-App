#!/bin/bash
# Save my changes: commit anything changed on this Mac (e.g. in Xcode) and push it to GitHub,
# so the other Mac gets it on its next "Get latest".
source "$(dirname "$0")/common.sh"

step "Looking for changes on this Mac"
git fetch -q origin main 2>/dev/null || true
UNSENT="$(git rev-list --count origin/main..HEAD 2>/dev/null || echo 0)"
if [[ -z "$(git status --porcelain)" && "$UNSENT" == "0" ]]; then
  ok "Nothing to save. This Mac matches GitHub."
  exit 0
fi
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  git add -A
  git commit -q -m "Changes from $(scutil --get ComputerName 2>/dev/null || hostname)"
else
  printf '%s\n' "  Sending changes saved earlier that didn't reach GitHub yet."
fi
pull_latest
step "Sending to GitHub"
if ! git push -q origin HEAD:main 2>"$CACHE/push.log"; then
  cat "$CACHE/push.log"
  if grep -qiE "could not read Username|Authentication failed|403" "$CACHE/push.log"; then
    fail "This Mac isn't signed in to GitHub. In Terminal run: brew install gh && gh auth login && gh auth setup-git — then press Save my changes again."
  fi
  fail "Couldn't push to GitHub. Copy this log to Claude."
fi
ok "Saved to GitHub. The other Mac gets these on its next “Get latest”."
