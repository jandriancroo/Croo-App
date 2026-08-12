import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        // Build the Capacitor web view controller directly so we never depend on
        // the storyboard resolving correctly at launch.
        let rootViewController: UIViewController
        if let fromStoryboard = UIStoryboard(name: "Main", bundle: nil).instantiateInitialViewController(),
           fromStoryboard is CAPBridgeViewController {
            rootViewController = fromStoryboard
        } else {
            rootViewController = CAPBridgeViewController()
        }

        let window = UIWindow(windowScene: windowScene)
        window.rootViewController = rootViewController
        window.backgroundColor = .white
        self.window = window
        window.makeKeyAndVisible()
    }
}
