#!/bin/bash
# Pull latest from Git: put this Mac on the right branch (testing, or main when CROO_BRANCH=main), pull GitHub,
# catch testing up with Lovable's fixes on main, then build the web app into the iPhone app (npm install, build, cap sync).
source "$(dirname "$0")/common.sh"
BRANCH="${CROO_BRANCH:-$TEST_BRANCH}"

step "Checking this Mac for local changes"
reset_auto_files
require_clean
ensure_branch "$BRANCH"
pull_latest "$BRANCH"
if [[ "$BRANCH" == "$TEST_BRANCH" ]]; then
  catch_up_with_main
  if git push -q origin "HEAD:$TEST_BRANCH" 2>/dev/null; then
    ok "testing is saved on GitHub"
  else
    printf '%s\n' "  (Couldn't send testing to GitHub just now. It isn't a problem; press “Send local changes to GitHub” later.)"
  fi
fi

step "Installing web packages (only new ones download)"
npm install --no-audit --no-fund --loglevel=error || fail "npm install failed."

step "Building the web app"
npm run build --silent >"$CACHE/web-build.log" 2>&1 || { tail -30 "$CACHE/web-build.log"; fail "Web build failed."; }
ok "Web app built"

step "Copying the web app into the iPhone app"
if ! npx cap sync ios >"$CACHE/cap-sync.log" 2>&1; then
  tail -30 "$CACHE/cap-sync.log"
  if grep -q "Unable to find compatibility version string" "$CACHE/cap-sync.log"; then
    fail "This Mac's CocoaPods is too old for the Xcode project. Update it once in Terminal: brew upgrade cocoapods (or, if that says it isn't installed with brew: sudo gem install cocoapods). Then press Get latest again."
  fi
  fail "cap sync failed."
fi
reset_auto_files quiet
ensure_pods
ok "Ready: this Mac (on $BRANCH) has the newest app. Next: Open in Xcode and test."

# Croo Builder updates itself: if its own code changed, rebuild it once this finishes (it reopens on its own).
APP_PLIST="$HOME/Applications/Croo Builder.app/Contents/Info.plist"
WANT="$(git log -1 --format=%h -- tools/croo-builder/App tools/croo-builder/install.sh)"
HAVE="$(/usr/libexec/PlistBuddy -c 'Print :CrooBuilderSource' "$APP_PLIST" 2>/dev/null || echo none)"
if [[ "${CROO_BUILDER:-}" == "1" && -n "$WANT" && "$WANT" != "$HAVE" ]]; then
  ok "Croo Builder has an update. It will close and reopen in a few seconds."
  nohup bash -c "sleep 3; bash '$ROOT/tools/croo-builder/install.sh'" >"$CACHE/self-update.log" 2>&1 &
  disown || true
fi
