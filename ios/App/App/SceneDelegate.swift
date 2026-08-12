import UIKit
import Capacitor

class SceneDelegate: UIResponder, UIWindowSceneDelegate {

    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        // Main.storyboard creates and retains CAPBridgeViewController. Keeping
        // startup storyboard-driven matches Capacitor's stable iOS app shell
        // while still supporting the scene lifecycle required by newer iOS.
        SceneDelegateProxy.shared.scene(
            scene,
            willConnectTo: session,
            options: connectionOptions
        )
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
