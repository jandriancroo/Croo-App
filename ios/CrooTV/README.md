# CrooTV (Apple TV)

Personal-use Apple TV app for CrooHQ. Own Xcode project, so it cannot break the iPhone app build.

- `CrooTV.xcodeproj` : open this in Xcode, pick the `CrooTV` scheme and your Apple TV.
- Bundle id `com.croohq.kitchenmate.CrooTV`, team `5Y4D3V56HU`, tvOS 27.0.
- Pages: dashboard (sales, labor, hourly chart, on the clock, schedule) and a fireplace screensaver
  (looping video + crackle sound). Swipe right on the remote for the fireplace, left to return.
  Hold the center button 2 seconds to unpair.
- Data: the same read-only `watch-device-service` snapshot the Watch and Vision Pro use
  (`hourlyToday` already comes from the server, no server change needed).
- Pairing (v1): sign in with email + password once (the Apple TV hands typing to your iPhone keyboard).
  The password is never saved; the app keeps only the read-only device token in the Keychain.
  A show-a-code-on-the-TV pairing is a later upgrade and needs a new server action.

## Not verified yet
Written without compiling. First build may show small Swift errors; fix on `testing`.
No app icon / top-shelf image yet (needed before TestFlight, not for running from Xcode).
Fire footage and crackle live in `CrooTV/Resources/` (about 2 MB total).
