import SwiftUI

// CrooHQ for Apple Vision Pro.
// Main window: a native live dashboard (sales, labor, who's on, schedule timeline, events),
// fed by the same read-only data as the watch and widgets. Theo opens in his own window in voice mode.

@main
struct CrooVisionApp: App {
    @StateObject private var store = VisionStore()

    var body: some Scene {
        WindowGroup(id: "dashboard") {
            RootView()
                .environmentObject(store)
        }
        .defaultSize(width: 1240, height: 780)

        WindowGroup("Theo", id: "theo") {
            TheoWindow()
        }
        .defaultSize(width: 520, height: 760)
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
