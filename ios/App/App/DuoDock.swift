import UIKit
import WebKit
import Capacitor

// iPhone Duo dock — TEST BUILD.
//
// Puts CrooHQ's dock into Apple's side column on the iPhone Duo (folded, or open and sideways), and
// floating at the bottom when the Duo is open and upright. It uses a navigation controller's toolbar,
// which is the bar Apple moves into the side column for apps built with Xcode 27.1 (Swift 6.4).
//
// - Built with an older Xcode: this file compiles to nothing and the app is exactly as before.
// - Any iPhone that isn't a Duo: the toolbar stays hidden and the web dock stays. Nothing changes.
// - On a Duo: the web dock is hidden and the native dock takes over. Its buttons drive the web app
//   (route change, manager dash, profile menu), so no web change is needed for this test.
//
// Look (decided after the device test, Oct 23): Apple's grey glass holder, white icons, the selected
// tab in orange. Apple ignores bar background and bar tint in its column; icon and item tint work.

enum DuoDock {
    /// The window's root: the plain Capacitor screen, or (Xcode 27.1+) that screen inside the dock controller.
    static func root(for bridge: CrooBridgeViewController) -> UIViewController {
        #if compiler(>=6.4)
        return DuoDockController(bridge: bridge)
        #else
        return bridge
        #endif
    }

    /// The Capacitor screen, whether or not it's wrapped.
    static func bridgeController(in root: UIViewController?) -> CAPBridgeViewController? {
        if let bridge = root as? CAPBridgeViewController { return bridge }
        return (root as? UINavigationController)?.viewControllers.first as? CAPBridgeViewController
    }
}

#if compiler(>=6.4)

final class DuoDockController: UINavigationController {
    private struct Tab { let path: String; let title: String; let symbol: String }
    private let tabs: [Tab] = [
        Tab(path: "/dashboard", title: "Dash", symbol: "square.grid.2x2"),
        Tab(path: "/messages", title: "Chat", symbol: "bubble.left"),
        Tab(path: "/tasks", title: "Tasks", symbol: "checkmark.square"),
        Tab(path: "/logbook", title: "Logs", symbol: "doc.text"),
        Tab(path: "/schedule", title: "Schedule", symbol: "calendar"),
    ]
    private enum Look: Int, CaseIterable {
        case orangeSelected, orangeIcons, appleDefault
        var name: String {
            switch self {
            case .orangeSelected: return "Orange selected tab"
            case .orangeIcons: return "Orange icons"
            case .appleDefault: return "Apple default"
            }
        }
    }

    private static let orange = UIColor(red: 235 / 255, green: 125 / 255, blue: 60 / 255, alpha: 1)
    private static let lookKey = "duoDockLook"

    private let bridgeVC: CrooBridgeViewController
    private var tabItems: [String: UIBarButtonItem] = [:]
    private var dockShowing = false
    private var pollTimer: Timer?
    private var currentPath = ""
    private var loggedEdge = ""
    private var lastEdgeRaw = 0

    private var look: Look {
        // Decided Oct 23 after the device test: white icons, the selected tab in orange.
        get { .orangeSelected }
        set { }
    }

    init(bridge: CrooBridgeViewController) {
        bridgeVC = bridge
        super.init(rootViewController: bridge)
        setNavigationBarHidden(true, animated: false)
        setToolbarHidden(true, animated: false)
        print("[DuoDock] dock controller is active (built with Swift 6.4+)")
    }

    required init?(coder: NSCoder) { fatalError("DuoDockController is created in code") }

    // The web app decides status bar, home indicator and rotation, same as before.
    override var childForStatusBarStyle: UIViewController? { topViewController }
    override var childForStatusBarHidden: UIViewController? { topViewController }
    override var childForHomeIndicatorAutoHidden: UIViewController? { topViewController }
    override var supportedInterfaceOrientations: UIInterfaceOrientationMask {
        topViewController?.supportedInterfaceOrientations ?? .allButUpsideDown
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        rebuildItems()
        applyLook()
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        refresh()
        // Resizing the web view here fought Apple's layout on the device (header jumped, dock vanished),
        // so column avoidance moves to the web app: see reportColumn() and the Duo build plan.
        reportColumn()
    }

    /// Tells the web app how wide Apple's column is and which side it's on, as CSS variables
    /// --duo-col-left / --duo-col-right on <html> (0px when there's no column). The web app will use
    /// them to keep pages and overlays out of the column. Nothing in the web app reads them yet.
    private var lastColumnJS = ""
    private func reportColumn() {
        let insets = view.safeAreaInsets
        var left: CGFloat = 0, right: CGFloat = 0
        if dockShowing, lastEdgeRaw != 0 {
            let onLeft = insets.left > insets.right + 20 || (insets.left == insets.right && lastEdgeRaw == 1)
            let reported = onLeft ? insets.left : insets.right
            let column = reported > 40 ? reported : 74
            if onLeft { left = column } else { right = column }
        }
        let js = "document.documentElement.style.setProperty('--duo-col-left','\(Int(left))px');document.documentElement.style.setProperty('--duo-col-right','\(Int(right))px')"
        guard js != lastColumnJS else { return }
        lastColumnJS = js
        runJS(js)
        print("[DuoDock] column left \(Int(left)) right \(Int(right)); safe area L\(Int(insets.left)) R\(Int(insets.right)); edge \(lastEdgeRaw)")
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        refresh()
    }

    // MARK: Is this a Duo right now?

    /// Apple's side column is showing. Apple reports UIVerticalBarEdge: 0 = no side column,
    /// 1 and 2 = one edge or the other (seen on Jordan's Duo: folded upright 2, folded sideways 1).
    private var hasSideColumn: Bool {
        if #available(iOS 27.1, *) {
            let raw = traitCollection.verticalBarEdge.rawValue
            lastEdgeRaw = Int(raw)
            let edge = "\(raw)"
            if edge != loggedEdge {
                loggedEdge = edge
                print("[DuoDock] verticalBarEdge raw = \(raw)")
            }
            if raw != 0 { UserDefaults.standard.set(true, forKey: Self.seenDuoKey) }
            return raw != 0
        }
        return false
    }

    /// Once this phone has shown Apple's side column, it's a Duo. (The open Duo held wide has no
    /// side column, and the fold check below came back empty on the device, so we remember instead.)
    private static let seenDuoKey = "duoDockSeenSideColumn"
    private var isDuo: Bool { UserDefaults.standard.bool(forKey: Self.seenDuoKey) }

    /// The screen has a fold right now (kept for the log; empty on Jordan's Duo so far).
    private var isUnfolded: Bool {
        if #available(iOS 27.1, *) {
            return !view.reservedRegions(kind: .division).isEmpty
        }
        return false
    }

    private var lastReport = ""

    private func refresh() {
        let side = hasSideColumn, open = isUnfolded
        let report = "side column: \(side), fold: \(open), duo: \(isDuo), size: \(Int(view.bounds.width))x\(Int(view.bounds.height))"
        if report != lastReport { lastReport = report; print("[DuoDock] \(report)") }
        // Side column → Apple puts the toolbar in it. Duo without one (open, held wide) → Apple
        // shows the same toolbar floating at the bottom. Any other iPhone → hidden, web dock stays.
        let show = side || open || isDuo
        guard show != dockShowing else { return }
        dockShowing = show
        print("[DuoDock] native dock \(show ? "on" : "off")")
        setToolbarHidden(!show, animated: false)
        hideWebDock(show)
        if show { startPolling() } else { stopPolling() }
    }

    // MARK: Items

    /// Apple ignored the bar color and tint (first test), so color is applied to the icons and the
    /// selected tab directly: "Orange icons" draws the icons orange; "Orange selected tab" fills the
    /// selected tab with orange glass (Apple's prominent style).
    private func icon(_ name: String) -> UIImage? {
        let image = UIImage(systemName: name)
        if look == .orangeIcons { return image?.withTintColor(Self.orange, renderingMode: .alwaysOriginal) }
        return image
    }

    private func rebuildItems() {
        let arrow = UIBarButtonItem(
            title: "Manager dash",
            image: icon("chevron.left.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Same as tapping the dock's swipe handle today.
                self?.runJS("document.querySelector('.glass-dock .cursor-pointer')?.click()")
            }
        )
        let profile = UIBarButtonItem(
            title: "Profile",
            image: icon("person.crop.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Same as tapping the avatar in the header today.
                self?.runJS("document.querySelector('button[title=\"More options\"]')?.click()")
            }
        )
        var items: [UIBarButtonItem] = [arrow, profile]
        tabItems = [:]
        for tab in tabs {
            let item = UIBarButtonItem(
                title: tab.title,
                image: icon(tab.symbol),
                primaryAction: UIAction { [weak self] _ in self?.go(to: tab.path) }
            )
            if #available(iOS 27.1, *) {
                // Keep every tab in the column; let Apple shrink spacing before it hides tabs behind "…".
                item.visibilityPriority = .high
            }
            tabItems[tab.path] = item
            items.append(item)
        }
        bridgeVC.toolbarItems = items
        markSelected(currentPath)
    }

    private func lookMenu() -> UIMenu {
        UIMenu(title: "Dock look (test)", children: Look.allCases.map { option in
            UIAction(title: option.name, state: option == look ? .on : .off) { [weak self] _ in
                self?.look = option
                self?.applyLook()
                self?.rebuildItems()
            }
        })
    }

    private func applyLook() {
        let appearance = UIToolbarAppearance()
        appearance.configureWithDefaultBackground()
        toolbar.standardAppearance = appearance
        toolbar.compactAppearance = appearance
        toolbar.scrollEdgeAppearance = appearance
        toolbar.compactScrollEdgeAppearance = appearance
        let tint: UIColor? = look == .appleDefault ? nil : Self.orange
        toolbar.tintColor = tint
        view.tintColor = tint
    }

    private func markSelected(_ path: String) {
        let key = path.hasPrefix("/org-dash") ? "/dashboard" : path
        for (tabPath, item) in tabItems {
            let on = key == tabPath || key.hasPrefix(tabPath + "/")
            item.isSelected = on
            if #available(iOS 26.0, *), look == .orangeSelected {
                item.style = on ? .prominent : .plain
                item.tintColor = on ? Self.orange : nil
            } else {
                item.style = .plain
                item.tintColor = nil
            }
        }
    }

    // MARK: Talking to the web app

    private var webView: WKWebView? { bridgeVC.bridge?.webView }

    private func runJS(_ js: String, done: ((Any?) -> Void)? = nil) {
        webView?.evaluateJavaScript(js) { result, _ in done?(result) }
    }

    /// Route change the way the browser's back button does it; React Router follows along.
    private func go(to path: String) {
        markSelected(path)
        let js = """
        (function(p){if(location.pathname!==p){history.pushState({},'',p);window.dispatchEvent(new PopStateEvent('popstate',{state:{}}));}})('\(path)')
        """
        runJS(js)
    }

    // Also: Apple already narrows the web view to stop at its column, but env(safe-area-inset-*) still
    // counts the column, so .px-safe padded it twice (squeezed cubes). On the Duo the gutter is 1rem.
    private static let hideDockJS = """
    (function(){var id='croo-duo-dock';if(!document.getElementById(id)){var s=document.createElement('style');s.id=id;s.textContent='nav.mobile-dock-container{display:none!important}.px-safe{padding-left:1rem!important;padding-right:1rem!important}';document.head.appendChild(s);}})()
    """

    private func hideWebDock(_ hide: Bool) {
        if hide {
            runJS(Self.hideDockJS)
        } else {
            runJS("document.getElementById('croo-duo-dock')?.remove()")
        }
    }

    /// Once a second while the native dock shows: keep the web dock hidden (survives reloads)
    /// and keep the selected tab in step with the page.
    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.runJS(Self.hideDockJS + ";" + self.lastColumnJS + ";location.pathname") { result in
                guard let path = result as? String, path != self.currentPath else { return }
                self.currentPath = path
                self.markSelected(path)
            }
        }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}

#endif
