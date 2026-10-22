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
