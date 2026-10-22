#!/bin/bash
# Run on device: build a test version and install + open it on a connected iPhone or Vision Pro.
# Usage: run-device.sh <scheme: App|CrooVision> <device-udid> <platform: iOS|visionOS>
source "$(dirname "$0")/common.sh"

SCHEME="${1:?scheme}"; UDID="${2:?device}"; PLATFORM="${3:-iOS}"
SDKDIR="Debug-iphoneos"; [[ "$PLATFORM" == "visionOS" ]] && SDKDIR="Debug-xros"
DD="$CACHE/DerivedData"
LOG="$CACHE/run-$(date +%Y%m%d-%H%M%S).log"

step "Building $SCHEME for your device (first build takes a few minutes)"
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
     -destination "id=$UDID" -derivedDataPath "$DD" -allowProvisioningUpdates build >"$LOG" 2>&1; then
  grep -E "error:|BUILD FAILED" "$LOG" | head -20
  fail "Build failed. Press “Copy error” and paste it to Claude. Full log: $LOG"
fi
ok "Built"

APP="$(find "$DD/Build/Products/$SDKDIR" -maxdepth 1 -name '*.app' -print -quit)"
[[ -n "$APP" ]] || fail "Couldn't find the built app."
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"

step "Installing on the device (keep it unlocked)"
xcrun devicectl device install app --device "$UDID" "$APP" >>"$LOG" 2>&1 || { tail -15 "$LOG"; fail "Install failed. Is the device unlocked and on the same Wi-Fi?"; }
step "Opening it"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE" >>"$LOG" 2>&1 || printf '%s\n' "  Installed. Open it on the device."
ok "Running on your device"
