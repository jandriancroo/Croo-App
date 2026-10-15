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
            // Each page sets its own background so a cube's color never
            // carries over to the other pages.
            ScheduleView()
                .containerBackground(Color.black, for: .tabView)
            SalesSummaryView()
                .containerBackground(Color.black, for: .tabView)
            ChatsView()
                .containerBackground(Color.black, for: .tabView)
            StatusView()
                .containerBackground(Color.black, for: .tabView)
        }
        .tabViewStyle(.page(indexDisplayMode: .never))  // hide the dots
    }
}
