import SwiftUI
import AppKit
import UserNotifications

// Croo Builder: one-tap buttons for getting the latest CrooHQ, running it on your iPhone or
// Vision Pro, saving Xcode changes, and shipping to TestFlight. It just runs the scripts in
// tools/croo-builder/scripts and shows what they print, so the same steps work from Terminal or Ferris.

@main
struct CrooBuilderApp: App {
    @StateObject private var runner = Runner()

    var body: some Scene {
        Window("Croo Builder", id: "main") {
            ContentView()
                .environmentObject(runner)
                .frame(minWidth: 720, minHeight: 520)
                .onAppear { runner.requestNotifications() }
        }
        .defaultSize(width: 820, height: 600)

        MenuBarExtra {
            MenuView().environmentObject(runner)
        } label: {
            Image(systemName: runner.isRunning ? "hammer.circle.fill" : "hammer.fill")
        }
    }
}

/// The small menu in the menu bar: same buttons, no log.
struct MenuView: View {
    @EnvironmentObject var runner: Runner
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        if runner.isRunning {
            Text("Working: \(runner.currentTitle)…")
            Button("Stop") { runner.stop() }
            Divider()
        }
        Button("Get latest") { runner.run(.getLatest) }.disabled(runner.isRunning)
        Button("Ship to TestFlight") { runner.run(.ship) }.disabled(runner.isRunning)
        Button("Save my changes") { runner.run(.saveChanges) }.disabled(runner.isRunning)
        Button("Open in Xcode") { runner.openXcode() }
        Divider()
        Button("Show window") {
            openWindow(id: "main")
            NSApp.activate(ignoringOtherApps: true)
        }
        Button("Quit Croo Builder") { NSApp.terminate(nil) }
    }
}
