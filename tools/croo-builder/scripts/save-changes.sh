#!/bin/bash
# Send local changes to GitHub: commit anything changed on this Mac (usually code Claude or Grok just wrote here)
# and send it to the testing branch. It never goes to main; "Ship drafts to main" is the only way work reaches main.
source "$(dirname "$0")/common.sh"

BR="$(current_branch)"
if [[ "$BR" != "$TEST_BRANCH" ]]; then
  fail "This Mac is on “$BR”, and local changes only go to “$TEST_BRANCH”. Nothing was sent. Press “Pull latest from Git” (step 1) to switch back, or ask Claude."
fi

step "Looking for local changes"
git fetch -q origin 2>/dev/null || true
if git show-ref --verify --quiet "refs/remotes/origin/$TEST_BRANCH"; then BASE="origin/$TEST_BRANCH"; else BASE="origin/main"; fi
UNSENT="$(git rev-list --count "$BASE..HEAD" 2>/dev/null || echo 0)"
if [[ -z "$(git status --porcelain)" && "$UNSENT" == "0" ]]; then
  ok "Nothing to send. This Mac matches GitHub."
  exit 0
fi
if [[ -n "$(git status --porcelain)" ]]; then
  git status --short
  git add -A
  git commit -q -m "Changes from $(scutil --get ComputerName 2>/dev/null || hostname)"
else
  printf '%s\n' "  Sending changes saved earlier that didn't reach GitHub yet."
fi
pull_latest "$TEST_BRANCH"
step "Sending to GitHub (testing only)"
if ! git push -q origin "HEAD:$TEST_BRANCH" 2>"$CACHE/push.log"; then
  cat "$CACHE/push.log"
  if grep -qiE "could not read Username|Authentication failed|403" "$CACHE/push.log"; then
    fail "This Mac isn't signed in to GitHub. In Terminal run: brew install gh && gh auth login && gh auth setup-git — then press Send local changes to GitHub again."
  fi
  fail "Couldn't push to GitHub. Copy this log to Claude."
fi
ok "Sent to testing on GitHub. Main and Lovable are untouched."
