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
// Long-press the arrow button to switch dock looks and compare them on the device:
//   Orange bar · Orange icons · Apple default.

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
        case orangeBar, orangeIcons, appleDefault
        var name: String {
            switch self {
            case .orangeBar: return "Orange bar"
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

    private var look: Look {
        get { Look(rawValue: UserDefaults.standard.integer(forKey: Self.lookKey)) ?? .orangeBar }
        set { UserDefaults.standard.set(newValue.rawValue, forKey: Self.lookKey) }
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
    }

    override func traitCollectionDidChange(_ previousTraitCollection: UITraitCollection?) {
        super.traitCollectionDidChange(previousTraitCollection)
        refresh()
    }

    // MARK: Is this a Duo right now?

    /// Apple's side column is showing (folded, or open and sideways).
    private var hasSideColumn: Bool {
        if #available(iOS 27.1, *) {
            // Read without naming the enum's cases, so this compiles whatever Apple called them.
            let edge = String(describing: traitCollection.verticalBarEdge).lowercased()
            if edge != loggedEdge {
                loggedEdge = edge
                print("[DuoDock] verticalBarEdge = \(edge)")
            }
            return edge.contains("leading") || edge.contains("trailing") || edge.contains("left") || edge.contains("right")
        }
        return false
    }

    /// The Duo is open (the screen has a fold), held either way.
    private var isUnfolded: Bool {
        if #available(iOS 27.1, *) {
            let regions = view.reservedRegions(kind: .division)
            return !regions.isEmpty
        }
        return false
    }

    private var lastReport = ""

    private func refresh() {
        let side = hasSideColumn, open = isUnfolded
        let report = "side column: \(side), unfolded: \(open), size: \(Int(view.bounds.width))x\(Int(view.bounds.height))"
        if report != lastReport { lastReport = report; print("[DuoDock] \(report)") }
        let show = side || open
        guard show != dockShowing else { return }
        dockShowing = show
        print("[DuoDock] native dock \(show ? "on" : "off")")
        setToolbarHidden(!show, animated: false)
        hideWebDock(show)
        if show { startPolling() } else { stopPolling() }
    }

    // MARK: Items

    private func rebuildItems() {
        let arrow = UIBarButtonItem(
            title: "Manager dash",
            image: UIImage(systemName: "chevron.left.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Same as tapping the dock's swipe handle today.
                self?.runJS("document.querySelector('.glass-dock .cursor-pointer')?.click()")
            },
            menu: lookMenu()
        )
        let profile = UIBarButtonItem(
            title: "Profile",
            image: UIImage(systemName: "person.crop.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Same as tapping the avatar in the header today.
                self?.runJS("document.querySelector('button[title=\"More options\"]')?.click()")
            }
        )
        var items: [UIBarButtonItem] = [arrow, profile, .fixedSpace(12)]
        tabItems = [:]
        for tab in tabs {
            let item = UIBarButtonItem(
                title: tab.title,
                image: UIImage(systemName: tab.symbol),
                primaryAction: UIAction { [weak self] _ in self?.go(to: tab.path) }
            )
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
        switch look {
        case .orangeBar:
            appearance.configureWithDefaultBackground()
            appearance.backgroundColor = Self.orange.withAlphaComponent(0.92)
            toolbar.tintColor = .white
        case .orangeIcons:
            appearance.configureWithDefaultBackground()
            toolbar.tintColor = Self.orange
        case .appleDefault:
            appearance.configureWithDefaultBackground()
            toolbar.tintColor = nil
        }
        toolbar.standardAppearance = appearance
        toolbar.compactAppearance = appearance
        toolbar.scrollEdgeAppearance = appearance
        toolbar.compactScrollEdgeAppearance = appearance
    }

    private func markSelected(_ path: String) {
        let key = path.hasPrefix("/org-dash") ? "/dashboard" : path
        for (tabPath, item) in tabItems {
            item.isSelected = key == tabPath || key.hasPrefix(tabPath + "/")
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

    private static let hideDockJS = """
    (function(){var id='croo-duo-dock';if(!document.getElementById(id)){var s=document.createElement('style');s.id=id;s.textContent='nav.mobile-dock-container{display:none!important}';document.head.appendChild(s);}})()
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
            self.runJS(Self.hideDockJS + ";location.pathname") { result in
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
