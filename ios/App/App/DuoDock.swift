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
        // Oct 23 (later): Jordan wants a static dock — no selected-tab highlight. Orange moves to rings around the glass.
        get { .appleDefault }
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
        updateRings()
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
        // Read by name so this builds on any Xcode 27 (the Studio's SDK doesn't list it yet).
        let tc = traitCollection
        if tc.responds(to: NSSelectorFromString("verticalBarEdge")),
           let raw = (tc.value(forKey: "verticalBarEdge") as? NSNumber)?.intValue {
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
        false // fold check removed: it came back empty on the Duo, and older SDKs lack it
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

    private static let collapsedKey = "duoDockCollapsed"
    private var collapsed: Bool {
        get { UserDefaults.standard.bool(forKey: Self.collapsedKey) }
        set { UserDefaults.standard.set(newValue, forKey: Self.collapsedKey) }
    }

    private static let openManagerDashJS = "document.querySelector('.glass-dock .cursor-pointer')?.click()"

    private func setCollapsed(_ value: Bool) {
        collapsed = value
        print("[DuoDock] dock \(value ? "collapsed" : "expanded")")
        rebuildItems()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.updateRings() }
    }

    private func rebuildItems() {
        // Collapsed: only one circle stays, and tapping it brings the dock back.
        if collapsed {
            let expand = UIBarButtonItem(
                title: "Show dock",
                image: icon("chevron.left.2"),
                primaryAction: UIAction { [weak self] _ in self?.setCollapsed(false) }
            )
            expand.menu = UIMenu(children: [
                UIAction(title: "Show dock", image: UIImage(systemName: "chevron.left.2")) { [weak self] _ in self?.setCollapsed(false) },
                UIAction(title: "Open manager dash", image: UIImage(systemName: "chevron.left.circle")) { [weak self] _ in self?.runJS(Self.openManagerDashJS) },
            ])
            if #available(iOS 26.0, *) { expand.sharesBackground = false }
            tabItems = [:]
            bridgeVC.toolbarItems = [expand]
            return
        }

        // The arrow is its own circle. Tap = manager dash (same as the swipe handle today).
        // Press and hold = menu with "Collapse dock".
        let arrow = UIBarButtonItem(
            title: "Manager dash",
            image: icon("chevron.left.circle"),
            primaryAction: UIAction { [weak self] _ in self?.runJS(Self.openManagerDashJS) },
            menu: UIMenu(children: [
                UIAction(title: "Open manager dash", image: UIImage(systemName: "chevron.left.circle")) { [weak self] _ in self?.runJS(Self.openManagerDashJS) },
                UIAction(title: "Collapse dock", image: UIImage(systemName: "chevron.right.2")) { [weak self] _ in self?.setCollapsed(true) },
            ])
        )
        if #available(iOS 26.0, *) { arrow.sharesBackground = false }
        let profile = UIBarButtonItem(
            title: "Profile",
            image: icon("person.crop.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Same as tapping the avatar in the header today.
                self?.runJS("(function(){var m=document.querySelector('button[title=\"More options\"]');if(m&&m.offsetParent!==null){m.click();return}var t=document.querySelector('header.sticky .nav-bar-unified button[aria-haspopup=\"menu\"]');if(t){t.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))}else if(m){m.click()}})()")
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

    // MARK: Orange rings (test of Jordan's Oct 23 idea)

    /// A few points of CrooHQ orange hugging each glass shape in the column (our dock, the arrow circle)
    /// and Apple's status cluster. Apple doesn't hand us these shapes, so we find the glass views inside
    /// the toolbar and ask for the status bar frame. The log lines show what was found.
    private var rings: [UIView] = []
    private var lastRingLog = ""
    private static let ringWidth: CGFloat = 5

    private func collectGlass(in v: UIView, host: UIView, into frames: inout [CGRect], names: inout [String]) {
        for sub in v.subviews where !sub.isHidden && sub.alpha > 0.01 {
            let name = String(describing: type(of: sub))
            let f = sub.convert(sub.bounds, to: host)
            let isGlass = (name.contains("Glass") || sub is UIVisualEffectView) && !name.contains("Background")
            if isGlass, f.width >= 30, f.height >= 30, !(f.width >= toolbar.bounds.width - 1 && f.height >= toolbar.bounds.height - 1) {
                frames.append(f)
                names.append("\(name) \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height))")
            } else {
                collectGlass(in: sub, host: host, into: &frames, names: &names)
            }
        }
    }

    private func updateRings() {
        guard let host = toolbar.superview else { return }
        var frames: [CGRect] = []
        var names: [String] = []
        if dockShowing, !isToolbarHidden, hasSideColumn {
            collectGlass(in: toolbar, host: host, into: &frames, names: &names)
            // Apple's time/battery cluster, if the system reports it inside the column.
            if let sb = view.window?.windowScene?.statusBarManager?.statusBarFrame {
                let f = view.window!.convert(sb, to: host)
                names.append("statusBar \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height))")
                if f.width > 20, f.width < 140, f.height > 60 { frames.append(f) }
            }
        }
        let log = names.joined(separator: " | ")
        if log != lastRingLog { lastRingLog = log; print("[DuoDock] rings: \(log.isEmpty ? "none" : log)") }
        while rings.count < frames.count {
            let r = UIView()
            r.isUserInteractionEnabled = false
            r.backgroundColor = .clear
            r.layer.borderColor = Self.orange.cgColor
            r.layer.borderWidth = Self.ringWidth
            r.layer.cornerCurve = .continuous
            host.insertSubview(r, belowSubview: toolbar)
            rings.append(r)
        }
        for (i, r) in rings.enumerated() {
            guard i < frames.count else { r.isHidden = true; continue }
            let f = frames[i].insetBy(dx: -Self.ringWidth, dy: -Self.ringWidth)
            r.frame = f
            r.layer.cornerRadius = min(f.width, f.height) / 2
            r.isHidden = false
        }
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

    // Also (test of Jordan's gutter idea): the header runs full width into Apple's column and the column continues
    // in the header's color top to bottom (Apple HIG: a header may span the full width; content stays inset). It sits above every web layer,
    // so nothing in the web app shows behind the column. The real build does this in the web app.
    // Test of Jordan's Oct 23 (later) direction: floating headers again (folded: rounded bar short of the column;
    // open: one bar across both panels with logo, location/Ovation, Ask Theo and Theo's Dash line), no colored
    // column, and dialogs/sheets/manager dash kept out of the column. The real build does this in the web app.
    private static let hideDockJS = """
    (function(){var id='croo-duo-dock';if(!document.getElementById(id)){var s=document.createElement('style');s.id=id;s.textContent='nav.mobile-dock-container{display:none!important}header.fixed{top:max(8px,env(safe-area-inset-top))!important;left:max(8px,env(safe-area-inset-left))!important;right:calc(env(safe-area-inset-right) + 8px)!important;width:auto!important;border-radius:20px!important}header.fixed button[title="More options"]{visibility:hidden!important}main.px-safe{padding-left:max(1rem,env(safe-area-inset-left))!important;padding-right:calc(env(safe-area-inset-right) + 1rem)!important}header.sticky>.container{max-width:none!important;padding-right:calc(env(safe-area-inset-right) + 12px)!important}header.sticky .nav-bar-unified>div[class~="gap-0.5"],header.sticky .nav-bar-unified>div.flex-1{display:none!important}header.sticky .nav-bar-unified button[aria-haspopup="menu"]:has(.h-7.w-7){display:none!important}header.sticky .nav-bar-unified>div.px-2{flex:1 1 auto;min-width:0}header.sticky .nav-bar-unified>div.px-2>button[aria-label="Ask Theo"]{order:2}#duo-theo-line{order:3;flex:1 1 auto;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:14px;font-weight:500;padding:0 10px}header.sticky .nav-bar-unified>div.px-2>button[aria-label^="Nudge"]{order:4}@media (min-width:768px){.spookified-dashboard-content>div:first-child>div.text-sm.text-muted-foreground{display:none!important}}[role="dialog"][class*="left-[50%]"]{left:calc(50% - env(safe-area-inset-right) / 2)!important}@media (max-width:767px){[role="dialog"][class*="left-[50%]"]{max-width:calc(100vw - env(safe-area-inset-right) - 24px)!important}}[role="dialog"][class*="right-0"],[role="dialog"][class*="inset-x-0"],[data-vaul-drawer],.cd-panel{right:env(safe-area-inset-right)!important}[role="dialog"][class*="inset-y-0"][class*="right-0"]{max-width:calc(100vw - env(safe-area-inset-right))!important}';document.head.appendChild(s);}})();(function(){var b=document.querySelector('header.sticky .nav-bar-unified>div.px-2');var el=document.getElementById('duo-theo-line');var src=document.querySelector('.spookified-dashboard-content>div:first-child>div.text-sm.text-muted-foreground');if(!b||!src||innerWidth<768||!document.getElementById('croo-duo-dock')){if(el)el.remove();return}if(!el){el=document.createElement('div');el.id='duo-theo-line';b.appendChild(el)}if(el.innerHTML!==src.innerHTML)el.innerHTML=src.innerHTML})()
    """

    private func hideWebDock(_ hide: Bool) {
        if hide {
            runJS(Self.hideDockJS)
        } else {
            runJS("document.getElementById('croo-duo-dock')?.remove();document.getElementById('duo-theo-line')?.remove()")
        }
    }

    /// Once a second while the native dock shows: keep the web dock hidden (survives reloads)
    /// and keep the selected tab in step with the page.
    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.updateRings()
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
