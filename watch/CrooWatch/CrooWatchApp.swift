import SwiftUI

@main
struct CrooWatchApp: App {
    @StateObject private var store = WatchDataStore.shared

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .onAppear { store.start() }
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
