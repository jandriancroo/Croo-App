# CrooHQ for Apple Vision Pro

Native visionOS app. The main window is a live dashboard built in SwiftUI. It shows sales (today, week or month) with a goal ring, pace and last year; labor % in green or red against goal; who's on the clock; today's schedule timeline with a now line; and today's events, with the next one marked.
- **Ask Theo** (button under the window) opens Theo in his own window, already in voice mode.
- **Store picker:** tap the store name to switch locations, or to unpair.
- **Data:** the same read-only feed as the watch and widgets (`watch-device-service`), refreshed every minute.
- **Pairing:** sign in once with your CrooHQ email and password. The app trades it for a read-only device token, which works like pairing a watch and needs an org admin, and never stores your password. The device shows up as "Vision Pro" in Apple Watch Devices, where you can revoke it.
- **Theo window:** it uses the web app's Theo, so you sign in inside that window the first time.

## Add it to Xcode (one time, about 5 minutes)
1. Open `ios/App/App.xcworkspace`.
2. File > New > Target > visionOS > App. Product Name `CrooVision`, Bundle ID `com.croohq.kitchenmate.vision`, Interface SwiftUI, Immersive Space: None. Finish.
3. In the new `CrooVision` group, delete the files Xcode generated (`CrooVisionApp.swift`, `ContentView.swift`, any `RealityKitContent` package and Reality files). Choose "Move to Trash".
4. Drag every `.swift` file from `visionos/CrooVision/` into the `CrooVision` group. Untick "Copy items if needed" and tick only the target `CrooVision`.
   Config.swift, Models.swift, VisionStore.swift, CrooVisionApp.swift, SignInView.swift, DashboardView.swift, TheoWindow.swift
5. Target CrooVision > Info: add "Privacy - Microphone Usage Description" = `CrooHQ uses the microphone so Theo can hear your voice updates and questions.`
6. Signing & Capabilities: pick your team.
7. Pick the scheme CrooVision and run on "Apple Vision Pro" (simulator) or your headset.
