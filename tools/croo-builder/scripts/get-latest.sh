#!/bin/bash
# Get latest: pull GitHub, then build the web app into the iPhone app (npm install, build, cap sync).
source "$(dirname "$0")/common.sh"

step "Checking this Mac for local changes"
reset_auto_files
require_clean
pull_latest

step "Installing web packages (only new ones download)"
npm install --no-audit --no-fund --loglevel=error || fail "npm install failed."

step "Building the web app"
npm run build --silent >"$CACHE/web-build.log" 2>&1 || { tail -30 "$CACHE/web-build.log"; fail "Web build failed."; }
ok "Web app built"

step "Copying the web app into the iPhone app"
npx cap sync ios >"$CACHE/cap-sync.log" 2>&1 || { tail -30 "$CACHE/cap-sync.log"; fail "cap sync failed."; }
reset_auto_files quiet
ensure_pods
ok "Ready: this Mac has the newest app. Open Xcode or press Run / Ship."

# Croo Builder updates itself: if its own code changed, rebuild it once this finishes (it reopens on its own).
APP_PLIST="$HOME/Applications/Croo Builder.app/Contents/Info.plist"
WANT="$(git log -1 --format=%h -- tools/croo-builder/App tools/croo-builder/install.sh)"
HAVE="$(/usr/libexec/PlistBuddy -c 'Print :CrooBuilderSource' "$APP_PLIST" 2>/dev/null || echo none)"
if [[ "${CROO_BUILDER:-}" == "1" && -n "$WANT" && "$WANT" != "$HAVE" ]]; then
  ok "Croo Builder has an update. It will close and reopen in a few seconds."
  nohup bash -c "sleep 3; bash '$ROOT/tools/croo-builder/install.sh'" >"$CACHE/self-update.log" 2>&1 &
  disown || true
fi
