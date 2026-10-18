import SwiftUI
import WebKit

// CrooHQ for Apple Vision Pro, v1.
// A small native shell: a launcher window plus floating windows that show the CrooHQ web app
// (Dashboard, Schedule) and Theo in voice mode. All windows share one web session, so you sign in once.

private let croohqBase = "https://croohq.com"

@main
struct CrooVisionApp: App {
    var body: some Scene {
        WindowGroup(id: "launcher") {
            LauncherView()
        }
        .defaultSize(width: 420, height: 420)

        WindowGroup("Dashboard", id: "dashboard") {
            CrooWebView(path: "/dashboard")
        }
        .defaultSize(width: 1100, height: 800)

        WindowGroup("Schedule", id: "schedule") {
            CrooWebView(path: "/schedule")
        }
        .defaultSize(width: 1100, height: 800)

        WindowGroup("Theo", id: "theo") {
            CrooWebView(path: "/dashboard?theo=voice")
        }
        .defaultSize(width: 520, height: 760)
    }
}

struct LauncherView: View {
    @Environment(\.openWindow) private var openWindow

    var body: some View {
        VStack(spacing: 18) {
            Text("CrooHQ").font(.extraLargeTitle2)
            Button { openWindow(id: "theo") } label: {
                Label("Ask Theo", systemImage: "waveform").frame(maxWidth: .infinity)
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.extraLarge)

            HStack(spacing: 14) {
                Button { openWindow(id: "dashboard") } label: {
                    Label("Dashboard", systemImage: "chart.bar.fill").frame(maxWidth: .infinity)
                }
                Button { openWindow(id: "schedule") } label: {
                    Label("Schedule", systemImage: "calendar").frame(maxWidth: .infinity)
                }
            }
            .controlSize(.large)

            Text("Sign in once in any window. Every window shares the session.")
                .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .padding(32)
    }
}

/// One CrooHQ web page in a window. Uses the default website data store so every window stays signed in.
struct CrooWebView: UIViewRepresentable {
    let path: String

    func makeCoordinator() -> Coordinator { Coordinator() }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        let web = WKWebView(frame: .zero, configuration: config)
        web.uiDelegate = context.coordinator
        web.isOpaque = false
        web.backgroundColor = .clear
        web.scrollView.backgroundColor = .clear
        if let url = URL(string: croohqBase + path) { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        // Theo's voice screen needs the microphone; the system still asks the wearer once.
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host.hasSuffix("croohq.com") ? .grant : .prompt)
        }
    }
}
