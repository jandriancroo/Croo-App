#!/bin/bash
# Run on device: build a test version and install + open it on a connected iPhone or Vision Pro.
# Usage: run-device.sh <scheme: App|CrooVision> <device-udid> <platform: iOS|visionOS>
source "$(dirname "$0")/common.sh"

SCHEME="${1:?scheme}"; UDID="${2:?device}"; PLATFORM="${3:-iOS}"
DD="$CACHE/DerivedData"
LOG="$CACHE/run-$(date +%Y%m%d-%H%M%S).log"

ensure_pods

step "Building $SCHEME for your device (first build takes a few minutes)"
if ! xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
     -destination "id=$UDID" -derivedDataPath "$DD" -allowProvisioningUpdates build >"$LOG" 2>&1; then
  grep -E "error:|BUILD FAILED" "$LOG" | head -20
  fail "Build failed. Press “Copy error” and paste it to Claude. Full log: $LOG"
fi
ok "Built"

# Ask Xcode where it put the app (folder names differ per device type), then fall back to searching.
SETTINGS="$(xcodebuild -workspace "$WORKSPACE" -scheme "$SCHEME" -configuration Debug \
  -destination "id=$UDID" -derivedDataPath "$DD" -showBuildSettings 2>/dev/null || true)"
TBD="$(printf '%s\n' "$SETTINGS" | awk -F' = ' '/^ *TARGET_BUILD_DIR = /{print $2; exit}')"
FPN="$(printf '%s\n' "$SETTINGS" | awk -F' = ' '/^ *FULL_PRODUCT_NAME = /{print $2; exit}')"
APP=""
if [[ -n "$TBD" && -n "$FPN" && -d "$TBD/$FPN" ]]; then
  APP="$TBD/$FPN"
else
  APP="$(find "$DD/Build/Products" -maxdepth 2 -type d -name '*.app' ! -path '*simulator*' 2>/dev/null \
    | grep -E "/(${SCHEME}|${FPN%.app})\.app$" | head -1 || true)"
  [[ -n "$APP" ]] || APP="$(ls -td "$DD"/Build/Products/*/*.app 2>/dev/null | grep -v simulator | head -1 || true)"
fi
[[ -n "$APP" && -d "$APP" ]] || fail "Built, but couldn't find the app in $DD/Build/Products. Copy this log to Claude."
printf '%s\n' "  App: $APP"
BUNDLE="$(/usr/libexec/PlistBuddy -c 'Print CFBundleIdentifier' "$APP/Info.plist")"

step "Installing on the device (keep it unlocked)"
xcrun devicectl device install app --device "$UDID" "$APP" >>"$LOG" 2>&1 || { tail -15 "$LOG"; fail "Install failed. Is the device unlocked and on the same Wi-Fi?"; }
step "Opening it"
xcrun devicectl device process launch --device "$UDID" "$BUNDLE" >>"$LOG" 2>&1 || printf '%s\n' "  Installed. Open it on the device."
ok "Running on your device"
