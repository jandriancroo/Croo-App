import SwiftUI

@main
struct CrooWatchApp: App {
    @StateObject private var store = WatchDataStore.shared
    @Environment(\.scenePhase) private var scenePhase

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .onAppear { store.start() }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { store.refreshFromAPI() }
                }
        }
    }
}


struct RootView: View {
    @EnvironmentObject var store: WatchDataStore

    var body: some View {
        TabView {
            CubesView()
            ScheduleView()
            SalesSummaryView()
            StatusView()
        }
        .tabViewStyle(.page)
    }
}
