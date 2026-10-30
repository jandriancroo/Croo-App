#!/bin/bash
# Ship drafts to main: promote the tested work from testing into main (the version Lovable follows).
# A bookmark (tag) goes on main first, so you can always return to exactly how it was before.
source "$(dirname "$0")/common.sh"

step "Checking this Mac for local changes"
reset_auto_files
require_clean
ensure_branch "$TEST_BRANCH"
pull_latest "$TEST_BRANCH"
catch_up_with_main

git fetch -q origin main || fail "Couldn't reach GitHub. Copy this log to Claude."
AHEAD="$(git rev-list --count origin/main..HEAD)"
if [[ "$AHEAD" == "0" ]]; then
  ok "Nothing to ship. Main already has everything on testing."
  exit 0
fi

step "Putting a bookmark on main before anything moves"
TAG="main-before-ship-$(date +%Y-%m-%d-%H%M)"
git tag "$TAG" origin/main || fail "Couldn't create the bookmark, so nothing was shipped."
if git push -q origin "$TAG" 2>/dev/null; then ok "Bookmark $TAG saved on GitHub"; else printf '%s\n' "  (Bookmark $TAG is on this Mac; couldn't copy it to GitHub.)"; fi

step "Sending $AHEAD change(s) from testing into main"
if ! git push -q origin "HEAD:main" 2>"$CACHE/push.log"; then
  cat "$CACHE/push.log"
  if grep -qiE "could not read Username|Authentication failed|403" "$CACHE/push.log"; then
    fail "This Mac isn't signed in to GitHub. In Terminal run: brew install gh && gh auth login && gh auth setup-git — then press Ship drafts to main again."
  fi
  fail "Main moved while shipping, so nothing was changed. Press Pull latest from Git, then try again."
fi
git fetch -q origin "main:main" 2>/dev/null || true
git push -q origin "HEAD:$TEST_BRANCH" 2>/dev/null || true
ok "Main now has everything from testing. Lovable can see it. The website only changes when you press Publish in Lovable."
