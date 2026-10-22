# Croo Builder

A small menu bar app (click the hammer, a panel pops out) so shipping CrooHQ needs no Terminal commands.

| Button | What it does |
|---|---|
| **Get latest** | Sets aside changes Xcode/npm made on their own (backup in Developer › CrooHQ backups), pulls GitHub, `npm install`, `npm run build`, `npx cap sync ios`. |
| **Run on (device)** | Builds a test version and installs + opens it on your iPhone (App) or Vision Pro (CrooVision). |
| **Ship to TestFlight** | Get latest → shows the **What to Test** notes (from `ios/TESTFLIGHT_NOTES.md`, "Next build") for you to edit → same build number on every app (saved to GitHub so both Macs agree) → archive → upload → notes posted to TestFlight once Apple finishes processing (needs the API key below; without it they're copied for you to paste) → notes filed under the build number. |
| **Save my changes** | Sends anything you changed on this Mac (e.g. in Xcode) to GitHub. |
| **Copy error** | Copies the errors + last lines to paste to Claude. |

## Install (once per Mac; after that it updates itself on Get latest)
```
~/Developer/Croo-App/tools/croo-builder/install.sh
```
It appears in your Applications folder (Home › Applications) and the menu bar. Drag it to the Dock if you like.

## Notes
- The buttons only run the scripts in `scripts/`, so the same steps work from Terminal (`bash tools/croo-builder/scripts/ship.sh`) or, later, from Ferris.
- Optional: an App Store Connect API key at `~/.croo-builder/asc.env` (`ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`) posts the What to Test notes automatically and lets uploads work even if Xcode's account sign-in expires. Make it in App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys (role: App Manager), download the .p8 once, put it in `~/.croo-builder/`, then write the three lines.
- Logs: `~/Library/Caches/CrooBuilder/`.
