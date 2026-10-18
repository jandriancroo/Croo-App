import SwiftUI
import WebKit

/// Theo, opened straight into voice mode. Uses the CrooHQ web app's Theo, so the first time
/// you'll sign in inside this window; after that it remembers you.
struct TheoWindow: View {
    var body: some View {
        CrooWebView(path: "/dashboard?theo=voice")
    }
}

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
        if let url = URL(string: CrooConfig.webBase + path) { web.load(URLRequest(url: url)) }
        return web
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKUIDelegate {
        // Theo's voice screen needs the microphone; visionOS still asks the wearer once.
        func webView(_ webView: WKWebView,
                     requestMediaCapturePermissionFor origin: WKSecurityOrigin,
                     initiatedByFrame frame: WKFrameInfo,
                     type: WKMediaCaptureType,
                     decisionHandler: @escaping (WKPermissionDecision) -> Void) {
            decisionHandler(origin.host.hasSuffix("croohq.com") ? .grant : .prompt)
        }
    }
}
