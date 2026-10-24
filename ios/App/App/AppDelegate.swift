import UIKit
import Capacitor
import WebKit

/// A direct WebKit channel for dashboard snapshots. App-local Swift files are
/// not included in Capacitor's generated package plugin list, so this channel
/// deliberately avoids depending on plugin auto-discovery.
private final class WatchSnapshotMessageHandler: NSObject, WKScriptMessageHandler {
    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard message.name == "WatchBridge" else { return }

        let payload: String?
        if let value = message.body as? String {
            payload = value
        } else if let body = message.body as? [String: Any] {
            payload = body["payload"] as? String
        } else {
            payload = nil
        }

        guard let payload, !payload.isEmpty else {
            print("[WatchBridge] direct channel rejected an empty snapshot")
            return
        }

        let delivered = WatchSessionManager.shared.send(payload: payload)
        print("[WatchBridge] direct channel accepted snapshot — delivered: \(delivered), bytes: \(payload.utf8.count)")
    }
}

/// The one Capacitor screen used by every iPhone launch path. Keeping this in
/// AppDelegate.swift ensures Xcode cannot omit the local Watch plugin because
/// of SceneDelegate.swift target-membership drift.
@objc(CrooBridgeViewController)
final class CrooBridgeViewController: CAPBridgeViewController {
    private let watchSnapshotHandler = WatchSnapshotMessageHandler()

    override func webViewConfiguration(for instanceConfiguration: InstanceConfiguration) -> WKWebViewConfiguration {
        let configuration = super.webViewConfiguration(for: instanceConfiguration)
        configuration.userContentController.add(watchSnapshotHandler, name: "WatchBridge")
        print("[WatchBridge] direct WebKit channel installed")
        return configuration
    }

    override func capacitorDidLoad() {
        super.capacitorDidLoad()
        print("[WatchBridge] registering Capacitor plugin")
        bridge?.registerPluginInstance(WatchBridgePlugin())
    }
}

/// croohq://theo (from the "Ask Theo" widget) opens Theo in voice mode. The web app sets
/// window.__theoReady once Theo is mounted, so a cold launch keeps retrying until it is.
enum TheoLauncher {
    static func isTheoURL(_ url: URL) -> Bool { url.scheme == "croohq" && url.host == "theo" }

    static func open(in root: UIViewController?, attempt: Int = 0) {
        guard attempt < 60 else { return }
        // Coming from the Theo call card: hang that call up so the app's Theo gets the mic.
        if attempt == 0, #available(iOS 18.0, *) { Task { @MainActor in TheoCallManager.shared.end() } }
        let js = "(function(){if(window.__theoReady){window.dispatchEvent(new Event('open-theo-voice'));return true;}return false;})()"
        let web = DuoDock.bridgeController(in: root)?.bridge?.webView
        web?.evaluateJavaScript(js) { result, _ in
            if (result as? Bool) == true { return }
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { open(in: root, attempt: attempt + 1) }
        }
        if web == nil {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { open(in: root, attempt: attempt + 1) }
        }
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        let appWindow = UIWindow(windowScene: windowScene)
        // On an iPhone Duo (Xcode 27.1 builds) the screen sits inside the Duo dock; elsewhere it's unchanged.
        appWindow.rootViewController = DuoDock.root(for: CrooBridgeViewController())
        appWindow.makeKeyAndVisible()
        window = appWindow

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
        if connectionOptions.urlContexts.contains(where: { TheoLauncher.isTheoURL($0.url) }) {
            TheoLauncher.open(in: appWindow.rootViewController)
        }
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
        if URLContexts.contains(where: { TheoLauncher.isTheoURL($0.url) }) {
            TheoLauncher.open(in: window?.rootViewController)
        }
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}

@UIApplicationMain
class AppDelegate: UIResponder, UIApplicationDelegate {

    var window: UIWindow?

    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
        // Start the Apple Watch link as early as possible so the watch can
        // receive a snapshot even before the dashboard finishes loading.
        WatchSessionManager.shared.activate()
        // Lets Talk to Theo (Action Button / Siri / Control Center) run a call in the background.
        if #available(iOS 18.0, *) { TheoCallManager.shared.register() }
        return true
    }

    func application(_ application: UIApplication, configurationForConnecting connectingSceneSession: UISceneSession, options: UIScene.ConnectionOptions) -> UISceneConfiguration {
        let configuration = UISceneConfiguration(name: "Default Configuration", sessionRole: connectingSceneSession.role)
        configuration.delegateClass = SceneDelegate.self
        return configuration
    }

    func applicationWillResignActive(_ application: UIApplication) {
        // Sent when the application is about to move from active to inactive state. This can occur for certain types of temporary interruptions (such as an incoming phone call or SMS message) or when the user quits the application and it begins the transition to the background state.
        // Use this method to pause ongoing tasks, disable timers, and invalidate graphics rendering callbacks. Games should use this method to pause the game.
    }

    func applicationDidEnterBackground(_ application: UIApplication) {
        // Use this method to release shared resources, save user data, invalidate timers, and store enough application state information to restore your application to its current state in case it is terminated later.
        // If your application supports background execution, this method is called instead of applicationWillTerminate: when the user quits.
    }

    func applicationWillEnterForeground(_ application: UIApplication) {
        // Called as part of the transition from the background to the active state; here you can undo many of the changes made on entering the background.
    }

    func applicationDidBecomeActive(_ application: UIApplication) {
        // Get Theo's voice pass ready so a Talk to Theo call right after connects faster.
        if #available(iOS 18.0, *) { TheoCallManager.shared.prefetch() }
        // Restart any tasks that were paused (or not yet started) while the application was inactive. If the application was previously in the background, optionally refresh the user interface.
    }

    func applicationWillTerminate(_ application: UIApplication) {
        // Called when the application is about to terminate. Save data if appropriate. See also applicationDidEnterBackground:.
    }

    func application(_ app: UIApplication, open url: URL, options: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
        // Called when the app was launched with a url. Feel free to add additional processing here,
        // but if you want the App API to support tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(app, open: url, options: options)
    }

    func application(_ application: UIApplication, continue userActivity: NSUserActivity, restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void) -> Bool {
        // Called when the app was launched with an activity, including Universal Links.
        // Feel free to add additional processing here, but if you want the App API to support
        // tracking app url opens, make sure to keep this call
        return ApplicationDelegateProxy.shared.application(application, continue: userActivity, restorationHandler: restorationHandler)
    }

}
