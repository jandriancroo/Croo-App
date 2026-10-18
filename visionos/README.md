# CrooHQ for Apple Vision Pro (v1)

A native visionOS shell: a launcher window plus floating windows for the Dashboard, the Schedule and Theo
(opens in voice mode). Each window shows the CrooHQ web app, and all windows share one sign-in.

## Add it to Xcode (about 5 minutes, one time)
1. Open `ios/App/App.xcworkspace`.
2. File > New > Target > visionOS > App. Product Name: `CrooVision`. Bundle ID: `com.croohq.kitchenmate.vision`. Interface: SwiftUI. Finish.
3. Delete the template files Xcode generated (`CrooVisionApp.swift`, `ContentView.swift`, any Reality files).
4. Drag `visionos/CrooVision/CrooVisionApp.swift` into the `CrooVision` group (tick target "CrooVision" only).
5. Select target CrooVision > Info tab: add "Privacy - Microphone Usage Description" = the text in `visionos/CrooVision/Info.plist`.
6. Signing & Capabilities: pick your team. Run on a Vision Pro (or the visionOS simulator) with ⌘R.

## Notes
- Theo window loads `/dashboard?theo=voice`; the web app opens Theo's voice screen once you're signed in.
- v1 uses the live web app, so web improvements show up here automatically.
- Native glass dashboards (pairing like the watch) are a later step.
