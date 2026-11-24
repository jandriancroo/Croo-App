import SwiftUI
import UIKit

// CrooHQ for Apple TV.
// Page 1: the wall dashboard. Page 2: the fireplace screensaver.
// Swipe right on the Siri Remote for the fireplace, swipe left to come back.
// Hold the center button for 2 seconds to unpair.

@main
struct CrooTVApp: App {
    @StateObject private var store = TVStore()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environmentObject(store)
                .preferredColorScheme(.dark)
                .onAppear {
                    // It's a wall display: don't let the TV's own screensaver take over.
                    UIApplication.shared.isIdleTimerDisabled = true
                }
        }
    }
}

struct RootView: View {
    @EnvironmentObject var store: TVStore
    @State private var page = 0
    @State private var confirmUnpair = false
    @FocusState private var focused: Bool

    var body: some View {
        Group {
            if store.isPaired {
                ZStack {
                    if page == 0 {
                        DashboardView().transition(.opacity)
                    } else {
                        FireplaceView().transition(.opacity)
                    }
                }
                .overlay(alignment: .bottom) {
                    HStack(spacing: 14) {
                        Circle().fill(page == 0 ? TVColor.cream : TVColor.muted.opacity(0.6)).frame(width: 12, height: 12)
                        Circle().fill(page == 1 ? TVColor.cream : TVColor.muted.opacity(0.6)).frame(width: 12, height: 12)
                    }
                    .padding(.bottom, 20)
                }
                .focusable()
                .focused($focused)
                .onMoveCommand { direction in
                    withAnimation(.easeInOut(duration: 0.6)) {
                        if direction == .right { page = 1 }
                        else if direction == .left { page = 0 }
                    }
                }
                .onLongPressGesture(minimumDuration: 2) { confirmUnpair = true }
                .confirmationDialog("Unpair this Apple TV?", isPresented: $confirmUnpair, titleVisibility: .visible) {
                    Button("Unpair", role: .destructive) { store.signOut() }
                    Button("Cancel", role: .cancel) {}
                }
                .onAppear { focused = true }
                .task { store.startPolling() }
            } else {
                SignInView()
            }
        }
        .background(TVColor.bg.ignoresSafeArea())
    }
}
