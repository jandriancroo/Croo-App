#!/bin/bash
# One-time (and after updates): builds Croo Builder from this folder and puts it in ~/Applications.
# Run from Terminal:  ~/Developer/Croo-App/tools/croo-builder/install.sh
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$DIR/../.." && pwd)"
APP="$HOME/Applications/Croo Builder.app"

echo "▶ Building Croo Builder (about a minute)"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
xcrun swiftc -O -swift-version 5 -parse-as-library \
  -target "$(uname -m)-apple-macos14.0" \
  -o "$APP/Contents/MacOS/CrooBuilder" "$DIR"/App/*.swift

cat > "$APP/Contents/Info.plist" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>CrooBuilder</string>
  <key>CFBundleIdentifier</key><string>com.croohq.builder</string>
  <key>CFBundleName</key><string>Croo Builder</string>
  <key>CFBundleDisplayName</key><string>Croo Builder</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>1.0</string>
  <key>CFBundleVersion</key><string>1</string>
  <key>CFBundleIconFile</key><string>AppIcon</string>
  <key>LSMinimumSystemVersion</key><string>14.0</string>
  <key>NSHighResolutionCapable</key><true/>
  <key>CrooRepoPath</key><string>$ROOT</string>
</dict></plist>
PLIST

# Icon from the CrooHQ app icon.
SRC="$ROOT/ios/App/App/Assets.xcassets/AppIcon.appiconset/crooios.png"
if [[ -f "$SRC" ]]; then
  SET="$(mktemp -d)/AppIcon.iconset"; mkdir -p "$SET"
  for s in 16 32 128 256 512; do
    sips -z $s $s "$SRC" --out "$SET/icon_${s}x${s}.png" >/dev/null
    sips -z $((s*2)) $((s*2)) "$SRC" --out "$SET/icon_${s}x${s}@2x.png" >/dev/null
  done
  iconutil -c icns "$SET" -o "$APP/Contents/Resources/AppIcon.icns" || true
fi

codesign --force --deep -s - "$APP" >/dev/null 2>&1 || true
echo "✔ Installed: $APP"
open "$APP"
