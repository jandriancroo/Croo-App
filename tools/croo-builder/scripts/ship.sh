#!/bin/bash
# Ship to TestFlight: get latest, bump the build number, archive, and upload to App Store Connect.
# Uses the Apple account already signed in to Xcode on this Mac. Optional App Store Connect API key:
#   ~/.croo-builder/asc.env with ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID.
source "$(dirname "$0")/common.sh"

"$(dirname "$0")/get-latest.sh"

step "Picking the next build number"
CUR="$(grep -oE 'CURRENT_PROJECT_VERSION = [0-9]+;' "$PBX" | grep -oE '[0-9]+' | sort -n | tail -1)"
NEW=$(( CUR + 1 ))
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $NEW;/g" "$PBX"
git add "$PBX"
git commit -q -m "Build $NEW"
git push -q origin HEAD:main || { git pull --rebase -q origin main && git push -q origin HEAD:main; } || fail "Couldn't save the build number to GitHub."
ok "Build $NEW (saved to GitHub so both Macs agree)"

TEAM="$(grep -oE 'DEVELOPMENT_TEAM = [A-Z0-9]+;' "$PBX" | head -1 | grep -oE '[A-Z0-9]{10}')"
OUT="$CACHE/ship-$NEW"
LOG="$OUT/xcodebuild.log"
rm -rf "$OUT"; mkdir -p "$OUT"

AUTH=()
if [[ -f "$HOME/.croo-builder/asc.env" ]]; then
  source "$HOME/.croo-builder/asc.env"
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
fi

ensure_pods

step "Archiving build $NEW (about 5–15 minutes, you can keep working)"
if ! xcodebuild -workspace "$WORKSPACE" -scheme App -configuration Release \
     -destination 'generic/platform=iOS' -archivePath "$OUT/App.xcarchive" \
     -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} archive >"$LOG" 2>&1; then
  grep -E "error:|ARCHIVE FAILED" "$LOG" | head -20
  fail "Archive failed. Press “Copy error” and paste it to Claude. Full log: $LOG"
fi
ok "Archived"

cat >"$OUT/ExportOptions.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>method</key><string>app-store-connect</string>
  <key>destination</key><string>upload</string>
  <key>teamID</key><string>$TEAM</string>
  <key>signingStyle</key><string>automatic</string>
  <key>uploadSymbols</key><true/>
  <key>manageAppVersionAndBuildNumber</key><false/>
</dict></plist>
PLIST

step "Uploading build $NEW to App Store Connect"
if ! xcodebuild -exportArchive -archivePath "$OUT/App.xcarchive" -exportOptionsPlist "$OUT/ExportOptions.plist" \
     -exportPath "$OUT/export" -allowProvisioningUpdates ${AUTH[@]+"${AUTH[@]}"} >>"$LOG" 2>&1; then
  grep -E "error:|EXPORT FAILED|Error Domain" "$LOG" | head -20
  fail "Upload failed. Press “Copy error” and paste it to Claude. Full log: $LOG"
fi
ok "Uploaded build $NEW to TestFlight. Apple emails you when it's ready (usually 10–30 minutes)."
