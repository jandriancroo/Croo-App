#!/bin/bash
# Save my changes: commit anything changed on this Mac (e.g. in Xcode) and push it to GitHub,
# so the other Mac gets it on its next "Get latest".
source "$(dirname "$0")/common.sh"

step "Looking for changes on this Mac"
if [[ -z "$(git status --porcelain)" ]]; then
  ok "Nothing to save. This Mac matches GitHub."
  exit 0
fi
git status --short
git add -A
git commit -q -m "Changes from $(scutil --get ComputerName 2>/dev/null || hostname)"
pull_latest
step "Sending to GitHub"
git push -q origin HEAD:main || fail "Couldn't push to GitHub. Copy this log to Claude."
ok "Saved to GitHub. The other Mac gets these on its next “Get latest”."
