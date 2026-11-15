# Ship Deck

A small menu bar app (click the hammer, a panel pops out) so shipping CrooHQ needs no Terminal commands.

Four steps, top to bottom. Each unlocks only after the one before it, and finished steps grey out. The panel always opens at step 1 (“Start over” goes back to it). The “Mac is on: …” label at the top is read-only.

| Step | What it does |
|---|---|
| **1. Pull latest from Git** | Puts this Mac on the **testing** branch, pulls it from GitHub, brings Lovable's newest fixes from **main** into testing, then `npm install`, `npm run build`, `npx cap sync ios`. Sets aside changes Xcode/npm made on their own (backup in Developer › CrooHQ backups). |
| **2. Open in Xcode and test** | Opens the project in Xcode (or run straight on a connected device from the picker). |
| **3. Ship drafts to main** | Type `ship` to unlock. Tags main with a bookmark (`main-before-ship-…`), then sends testing into main. Lovable follows main; the website only changes when you press Publish in Lovable. |
| **4. Ship to TestFlight** | Switches to main → shows the **What to Test** notes (from `ios/TESTFLIGHT_NOTES.md`) → same build number on every app → archive → upload → notes posted once Apple finishes processing → back to testing. |
| **Send local changes to GitHub** | Sends anything new on this Mac to **testing only**, never main. |
| **Only Lovable fixes? Skip to step 4** | For fixes already on main: skips steps 1–3. |
| **Copy error** | Copies the errors + last lines to paste to Claude. |

## Install (once per Mac; after that it updates itself on Get latest)
```
~/Developer/Croo-App/tools/croo-builder/install.sh
```
It appears in your Applications folder (Home › Applications) and the menu bar. Drag it to the Dock if you like.

## Notes
- The buttons only run the scripts in `scripts/`, so the same steps work from Terminal (`bash tools/croo-builder/scripts/ship.sh`) or, later, from Ferris.
- Optional: an App Store Connect API key at `~/.croo-builder/asc.env` (`ASC_KEY_PATH`, `ASC_KEY_ID`, `ASC_ISSUER_ID`) posts the What to Test notes automatically and lets uploads work even if Xcode's account sign-in expires. Make it in App Store Connect → Users and Access → Integrations → App Store Connect API → Team Keys (role: App Manager), download the .p8 once, put it in `~/.croo-builder/` (or, to share one key between Macs, in iCloud Drive in a folder named `Ship Deck`), then write the three lines.
- Logs: `~/Library/Caches/CrooBuilder/`.

## More than one app

Ship Deck can ship several apps from one panel. Pick the app at the top (CrooHQ or ShredPal); the four steps then work on that app only, and step 3 and step 4 say its name.

- Each app has its own folder, its own `testing` and `main`, and its own TestFlight entry. Nothing is shared except Ship Deck itself and your App Store Connect key.
- Per-app settings live at the top of `scripts/common.sh` (a `case` on the app id) and in the `BuilderApp` list in `App/Runner.swift`. To add an app, add it in both places.
- ShredPal uses Swift Package Manager, so it has no Xcode workspace; Ship Deck uses its project file instead. Xcode's own edits to ShredPal's project file are kept, not set aside, because they can be real (for example the signing team). They show up as local changes to send with “Send local changes to GitHub”.
- The first time an app has no `testing` branch, Ship Deck asks before creating one. It is made from main, and any edits already on the Mac come along.
- Ship Deck's own code lives in the CrooHQ project, so it updates itself when you pull CrooHQ.
