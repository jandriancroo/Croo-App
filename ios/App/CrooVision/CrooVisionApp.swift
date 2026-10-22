import SwiftUI

// CrooHQ for Apple Vision Pro.
// Main window: a native live dashboard (sales, labor, who's on, schedule timeline, events),
// fed by the same read-only data as the watch and widgets. Theo opens in his own window, natively, already listening.

@main
struct CrooVisionApp: App {
    @StateObject private var store = VisionStore()

    var body: some Scene {
        WindowGroup(id: "dashboard") {
            RootView()
                .environmentObject(store)
        }
        .defaultSize(width: 1240, height: 780)

        // Theo: a real 3D orb floating in the room (no glass, no panel). Grab the bar under him to move him.
        WindowGroup("Theo", id: "theo") {
            TheoVolume()
                .environmentObject(store)
        }
        .windowStyle(.volumetric)
        .defaultSize(width: 0.42, height: 0.46, depth: 0.32, in: .meters)
    }
}

struct RootView: View {
    @EnvironmentObject var store: VisionStore

    var body: some View {
        Group {
            if store.isPaired {
                DashboardView()
            } else {
                SignInView()
            }
        }
        .task {
            if store.isPaired { store.startPolling() }
        }
    }
}
