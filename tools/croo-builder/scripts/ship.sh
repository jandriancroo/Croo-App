#!/bin/bash
# Ship to TestFlight: get latest, bump the build number, archive, and upload to App Store Connect.
# Uses the Apple account already signed in to Xcode on this Mac. Optional App Store Connect API key:
#   ~/.croo-builder/asc.env with ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID.
source "$(dirname "$0")/common.sh"

"$(dirname "$0")/get-latest.sh"

step "Checking this Mac can upload to GitHub"
git push --dry-run -q origin HEAD:main >/dev/null 2>&1 || fail "This Mac isn't signed in to GitHub, so the build number can't be saved. In Terminal run: gh auth login   (pick GitHub.com → HTTPS → Login with a web browser), then: gh auth setup-git   — then press Ship again."
ok "GitHub sign-in OK"

step "Picking the next build number"
CUR="$(grep -oE 'CURRENT_PROJECT_VERSION = [0-9]+;' "$PBX" | grep -oE '[0-9]+' | sort -n | tail -1)"
NEW=$(( CUR + 1 ))
sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $NEW;/g" "$PBX"
git add "$PBX"
git commit -q -m "Build $NEW"
git push -q origin HEAD:main || { git pull --rebase --autostash -q origin main && git push -q origin HEAD:main; } || fail "Couldn't save the build number to GitHub."
ok "Build $NEW (saved to GitHub so both Macs agree)"

# Every piece (iPhone app, widgets, Watch app, Vision Pro app) must carry the same version and build,
# or App Store Connect rejects the upload.
VERSIONS="$(grep -oE 'MARKETING_VERSION = [^;]+;' "$PBX" | sort -u | wc -l | tr -d ' ')"
BUILDS="$(grep -oE 'CURRENT_PROJECT_VERSION = [^;]+;' "$PBX" | sort -u | wc -l | tr -d ' ')"
[[ "$VERSIONS" == "1" && "$BUILDS" == "1" ]] || fail "The apps don't all have the same version/build number. Tell Claude: 'version mismatch in ship'."
ok "iPhone, widgets, Watch and Vision Pro all on $(grep -oE 'MARKETING_VERSION = [^;]+' "$PBX" | head -1 | cut -d' ' -f3) ($NEW)"

TEAM="$(grep -oE 'DEVELOPMENT_TEAM = [A-Z0-9]+;' "$PBX" | head -1 | grep -oE '[A-Z0-9]{10}')"
OUT="$CACHE/ship-$NEW"
LOG="$OUT/xcodebuild.log"
rm -rf "$OUT"; mkdir -p "$OUT"

AUTH=()
if [[ -f "$HOME/.croo-builder/asc.env" ]]; then
  source "$HOME/.croo-builder/asc.env"
  ASC_KEY_PATH="${ASC_KEY_PATH/#\~/$HOME}"
  [[ -f "$ASC_KEY_PATH" ]] || fail "Your App Store Connect key file isn't at $ASC_KEY_PATH. Put the AuthKey_XXXX.p8 file there (or fix ASC_KEY_PATH in ~/.croo-builder/asc.env), then Ship again."
  AUTH=(-authenticationKeyPath "$ASC_KEY_PATH" -authenticationKeyID "$ASC_KEY_ID" -authenticationKeyIssuerID "$ASC_ISSUER_ID")
else
  fail "This Mac has no App Store Connect key yet (~/.croo-builder/asc.env). Uploading needs it. Copy the AuthKey .p8 and asc.env from your other Mac, or create a key in App Store Connect → Users and Access → Integrations (role: App Manager). See the Croo Builder README."
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

# TestFlight notes: Croo Builder posts them (or copies them) after this. Here we file them under
# this build in ios/TESTFLIGHT_NOTES.md and start a fresh "Next build" section.
if [[ -n "${CROO_NOTES_FILE:-}" && -f "$CROO_NOTES_FILE" ]] && command -v python3 >/dev/null 2>&1; then
  step "Filing the TestFlight notes under build $NEW"
  if python3 - "$CROO_NOTES_FILE" "$NEW" "ios/TESTFLIGHT_NOTES.md" <<'PY'
import sys, datetime, os
notes_file, build, path = sys.argv[1], sys.argv[2], sys.argv[3]
notes = open(notes_file, encoding="utf-8").read().strip()
text = open(path, encoding="utf-8").read() if os.path.exists(path) else "# TestFlight notes\n\n## Next build\n"
lines = text.split("\n")
out, i, done = [], 0, False
while i < len(lines):
    line = lines[i]
    if not done and line.lower().startswith("## next build"):
        i += 1
        while i < len(lines) and not lines[i].startswith("## "):
            i += 1  # drop the old "next build" text (the edited notes replace it)
        stamp = datetime.date.today().strftime("%b %-d, %Y")
        out += ["## Next build", "", f"## Build {build} · {stamp}", "", notes, ""]
        done = True
        continue
    out.append(line)
    i += 1
if not done:
    out += ["", "## Next build", "", f"## Build {build}", "", notes, ""]
open(path, "w", encoding="utf-8").write("\n".join(out).rstrip() + "\n")
PY
  then
    git add ios/TESTFLIGHT_NOTES.md
    git commit -q -m "TestFlight notes for build $NEW" || true
    git push -q origin HEAD:main || { git pull --rebase --autostash -q origin main && git push -q origin HEAD:main; } || true
    ok "Notes filed under build $NEW"
  fi
fi
