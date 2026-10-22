import SwiftUI
import AppKit
import UserNotifications
import ServiceManagement

// Croo Builder: one-tap buttons for getting the latest CrooHQ, running it on your iPhone or
// Vision Pro, saving Xcode changes, and shipping to TestFlight. Lives in the menu bar: click
// the hammer and the panel pops out. It runs the scripts in tools/croo-builder/scripts and
// shows what they print, so the same steps work from Terminal or Ferris.

@main
struct CrooBuilderApp: App {
    @StateObject private var runner = Runner()

    init() {
        // Open at login: turned on the first time Croo Builder runs; the footer toggle turns it off.
        let key = "didSetLoginItem"
        if !UserDefaults.standard.bool(forKey: key) {
            UserDefaults.standard.set(true, forKey: key)
            try? SMAppService.mainApp.register()
        }
    }

    var body: some Scene {
        MenuBarExtra {
            PanelView()
                .environmentObject(runner)
                .onAppear { runner.requestNotifications() }
        } label: {
            Image(systemName: runner.isRunning ? "hammer.circle.fill" : "hammer.fill")
        }
        .menuBarExtraStyle(.window)
    }
}
