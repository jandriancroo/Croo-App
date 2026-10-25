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
    /// Open (unfolded) Duo = the app is wide (600+ points). Folded = narrow. Both have the side column.
    private var duoOpen = false
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
        // Folded vs open is decided by width, not by the side column: the column is there in both
        // (seen on the device: 466 wide folded, 951 wide open, both with the column).
        let nowOpen = (isDuo || side) && view.bounds.width >= 600
        if nowOpen != duoOpen {
            duoOpen = nowOpen
            rebuildItems()
        }
        runJS(duoClassesJS(folded: (isDuo || side) && !nowOpen, open: nowOpen))
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
    private static let toggleManagerDashJS = "(function(){var c=document.querySelector('.cd-panel button[aria-label=\"Close\"]');if(c){c.click()}else{document.querySelector('.glass-dock .cursor-pointer')?.click()}})()"
    private var arrowItem: UIBarButtonItem?
    private var nudgeItem: UIBarButtonItem?
    private var lastNudgeLate = -1
    private var dashOpen = false

    /// Arrow points up while the manager dash is closed, down while it's open (it slides up and down).
    private func setDashOpen(_ open: Bool) {
        guard open != dashOpen else { return }
        dashOpen = open
        arrowItem?.image = icon(open ? "chevron.down.circle" : "chevron.up.circle")
        arrowItem?.title = open ? "Close manager dash" : "Manager dash"
    }

    private func setCollapsed(_ value: Bool) {
        collapsed = value
        print("[DuoDock] dock \(value ? "collapsed" : "expanded")")
        rebuildItems()
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in self?.updateRings() }
    }

    /// JS that sends real pointer events to the element the selector finds (Radix and React listen for these).
    private static func pressJS(_ find: String) -> String {
        "(function(){var b=\(find);if(!b)return;['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){b.dispatchEvent(new (t.indexOf('pointer')==0?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))})})()"
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
                UIAction(title: "Open manager dash", image: UIImage(systemName: "chevron.up.circle")) { [weak self] _ in self?.runJS(Self.openManagerDashJS) },
            ])
            if #available(iOS 26.0, *) { expand.sharesBackground = false }
            arrowItem = nil
            tabItems = [:]
            bridgeVC.toolbarItems = [expand]
            return
        }

        // The arrow is its own circle. Tap = manager dash (same as the swipe handle today).
        // Press and hold = menu with "Collapse dock".
        let arrow = UIBarButtonItem(
            title: dashOpen ? "Close manager dash" : "Manager dash",
            image: icon(dashOpen ? "chevron.down.circle" : "chevron.up.circle"),
            primaryAction: UIAction { [weak self] _ in
                guard let self else { return }
                self.runJS(Self.toggleManagerDashJS)
                self.setDashOpen(!self.dashOpen) // flip right away; the poll corrects it within a second
            },
            menu: UIMenu(children: [
                UIAction(title: "Open manager dash", image: UIImage(systemName: "chevron.up.circle")) { [weak self] _ in self?.runJS(Self.openManagerDashJS) },
                UIAction(title: "Collapse dock", image: UIImage(systemName: "chevron.right.2")) { [weak self] _ in self?.setCollapsed(true) },
            ])
        )
        if #available(iOS 26.0, *) { arrow.sharesBackground = false }
        arrowItem = arrow
        nudgeItem = nil
        let profile = UIBarButtonItem(
            title: "Profile",
            image: icon("person.crop.circle"),
            primaryAction: UIAction { [weak self] _ in
                // Opens the profile menu: the phone menu sheet when it exists (folded), else the header's avatar menu.
                // Radix triggers listen for pointer events, so send those, not just click().
                self?.runJS("(function(){var d=Array.prototype.slice.call(document.querySelectorAll('[role=\"dialog\"][data-state=\"open\"]')).filter(function(x){return /^\\s*Menu/.test(x.innerText||'')})[0];if(d){var e=function(t){return new KeyboardEvent(t,{key:'Escape',code:'Escape',keyCode:27,which:27,bubbles:true,cancelable:true})};document.dispatchEvent(e('keydown'));document.dispatchEvent(e('keyup'));return}var f=function(b){['pointerdown','mousedown','pointerup','mouseup','click'].forEach(function(t){b.dispatchEvent(new (t.indexOf('pointer')==0?PointerEvent:MouseEvent)(t,{bubbles:true,cancelable:true,button:0,pointerType:'mouse'}))})};window.dispatchEvent(new Event('open-profile-menu'));var m=document.querySelector('button[title=\"More options\"]');if(m){f(m);return}var t=Array.prototype.slice.call(document.querySelectorAll('header button[aria-haspopup=\"menu\"]')).filter(function(x){return x.querySelector('.h-7.w-7')})[0];if(t)f(t)})()")
            }
        )
        // Open Duo: the manager dash is closed-mode only, so the arrow leaves the dock.
        // One action button. Tapping it opens a menu of actions for the page you're on;
        // page navigation lives in the web slide-out menu.
        let onDash = currentPath == "/" || currentPath.hasPrefix("/dashboard") || currentPath.hasPrefix("/org-dash")
        var actionChildren: [UIMenuElement] = [
            UIAction(title: "Ask Theo", image: UIImage(systemName: "sparkles")) { [weak self] _ in self?.runJS("window.dispatchEvent(new Event('open-theo'))") },
            UIAction(title: "Nudge", image: UIImage(systemName: "hand.point.up.left.fill")) { [weak self] _ in self?.runJS("window.dispatchEvent(new Event('open-nudge'))") },
        ]
        if onDash {
            actionChildren.append(UIAction(title: "Edit layout", image: UIImage(systemName: "slider.horizontal.3")) { [weak self] _ in self?.runJS("window.dispatchEvent(new Event('open-edit-layout'))") })
        }
        let actions = UIBarButtonItem(title: "Actions", image: icon("ellipsis.circle"), menu: UIMenu(children: actionChildren))
        if #available(iOS 27.1, *) { actions.visibilityPriority = .high }
        nudgeItem = actions
        lastNudgeLate = -1
        var items: [UIBarButtonItem] = duoOpen ? [actions, profile] : [arrow, actions, profile]
        // Page navigation lives in the web slide-out menu now; the dock holds actions only.
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

    private var dumpedTree = false
    /// One-time list of the views inside the toolbar, so the rings can be aimed if the first guess misses.
    private func dumpTree(_ v: UIView, host: UIView, depth: Int) {
        guard depth < 9 else { return }
        for sub in v.subviews {
            let f = sub.convert(sub.bounds, to: host)
            print("[DuoDock] tree \(String(repeating: "  ", count: depth))\(String(describing: type(of: sub))) \(Int(f.minX)),\(Int(f.minY)) \(Int(f.width))x\(Int(f.height))\(sub.isHidden ? " hidden" : "")")
            dumpTree(sub, host: host, depth: depth + 1)
        }
    }

    private func updateRings() {
        // Orange rings retired: the Duo look is neutral glass.
        rings.forEach { $0.isHidden = true }
        return
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
        if dockShowing, hasSideColumn, !dumpedTree, toolbar.bounds.height > 0 {
            dumpedTree = true
            print("[DuoDock] toolbar frame \(toolbar.frame) in \(String(describing: type(of: host)))")
            dumpTree(toolbar, host: host, depth: 0)
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
            // Oct 23: no color, just a soft lighter glass bubble behind the selected tab.
            item.isSelected = false
            if #available(iOS 26.0, *) {
                item.style = on ? .prominent : .plain
                item.tintColor = on ? UIColor.white.withAlphaComponent(0.28) : nil
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
    // The web app (Lovable) now owns every Duo layout: headers, splits, dialogs, menu. The shell only hides the
    // web dock (native tabs replace it) and tells the page which Duo state it's in.
    private static let hideDockJS = """
    (function(){var id='croo-duo-dock';if(!document.getElementById(id)){var s=document.createElement('style');s.id=id;s.textContent='nav.mobile-dock-container{display:none!important}';document.head.appendChild(s);}})()
    """

    /// Tells the web app which Duo state we're in: html.duo, plus duo-folded or duo-open.
    private func duoClassesJS(folded: Bool, open: Bool) -> String {
        let on = isDuo || folded || open
        return """
        (function(){var c=document.documentElement.classList;\
        c.toggle('duo',\(on));c.toggle('duo-folded',\(folded));c.toggle('duo-open',\(open));})()
        """
    }

    private func hideWebDock(_ hide: Bool) {
        if hide {
            runJS(Self.hideDockJS)
        } else {
            runJS("document.getElementById('croo-duo-dock')?.remove();document.documentElement.classList.remove('duo','duo-folded','duo-open')")
        }
    }

    /// Once a second while the native dock shows: keep the web dock hidden (survives reloads)
    /// and keep the selected tab in step with the page.
    private func startPolling() {
        stopPolling()
        pollTimer = Timer.scheduledTimer(withTimeInterval: 1, repeats: true) { [weak self] _ in
            guard let self else { return }
            self.updateRings()
            self.runJS(Self.hideDockJS + ";" + self.duoClassesJS(folded: !self.duoOpen, open: self.duoOpen) + ";" + self.lastColumnJS + ";location.pathname+'|'+(document.querySelector('.cd-panel')?1:0)+'|'+(document.documentElement.dataset.nudgeLate||'0')") { result in
                guard let parts = (result as? String)?.split(separator: "|", omittingEmptySubsequences: false), parts.count == 3 else { return }
                self.setDashOpen(parts[1] == "1")
                self.setNudgeBadge(Int(parts[2]) ?? 0)
                let path = String(parts[0])
                guard path != self.currentPath else { return }
                self.currentPath = path
                self.rebuildItems()
                self.markSelected(path)
            }
        }
    }

    /// Late-nudge count on the dock's Nudge button (web publishes it as html[data-nudge-late]).
    private func setNudgeBadge(_ n: Int) {
        guard n != lastNudgeLate, let item = nudgeItem else { return }
        lastNudgeLate = n
        if #available(iOS 26.0, *) { item.badge = n > 0 ? .count(n) : nil }
    }

    private func stopPolling() {
        pollTimer?.invalidate()
        pollTimer = nil
    }
}

#endif
