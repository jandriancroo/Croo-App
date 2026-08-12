import Foundation
import Capacitor
import WatchConnectivity

/// Bridges the CrooHQ web app to the Apple Watch app.
/// Read-only mirror: it forwards a snapshot of the dashboard (Data Cubes,
/// today's schedule, sales summary) to the watch. It never changes phone data.
@objc(WatchBridgePlugin)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridgePlugin"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isPaired", returnType: CAPPluginReturnPromise)
    ]

    private let session = WatchSessionManager.shared

    override public func load() {
        session.activate()
    }

    @objc func sendSnapshot(_ call: CAPPluginCall) {
        guard let payload = call.getString("payload") else {
            call.reject("Missing payload")
            return
        }
        let delivered = session.send(payload: payload)
        call.resolve(["delivered": delivered])
    }

    @objc func isPaired(_ call: CAPPluginCall) {
        call.resolve([
            "paired": session.isPaired,
            "reachable": session.isReachable
        ])
    }
}

/// Thin WatchConnectivity wrapper. Uses application context so the watch always
/// has the latest snapshot, even if it was asleep when the phone sent it.
final class WatchSessionManager: NSObject, WCSessionDelegate {
    static let shared = WatchSessionManager()

    private var latestPayload: String?

    var isPaired: Bool {
        guard WCSession.isSupported() else { return false }
        return WCSession.default.isPaired
    }

    var isReachable: Bool {
        guard WCSession.isSupported() else { return false }
        return WCSession.default.isReachable
    }

    func activate() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
    }

    @discardableResult
    func send(payload: String) -> Bool {
        guard WCSession.isSupported() else {
            print("[WatchBridge] WCSession not supported on this device")
            return false
        }
        latestPayload = payload
        let session = WCSession.default
        guard session.activationState == .activated else {
            print("[WatchBridge] session not activated yet — payload cached")
            return false
        }
        print("[WatchBridge] sending snapshot — paired: \(session.isPaired), watchAppInstalled: \(session.isWatchAppInstalled), reachable: \(session.isReachable)")
        do {
            try session.updateApplicationContext(["snapshot": payload])
            return true
        } catch {
            print("[WatchBridge] updateApplicationContext failed: \(error)")
            return false
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        if let payload = latestPayload, activationState == .activated {
            send(payload: payload)
        }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}

    func sessionDidDeactivate(_ session: WCSession) {
        WCSession.default.activate()
    }

    /// The watch asks for a refresh when it opens.
    func session(_ session: WCSession,
                 didReceiveMessage message: [String: Any],
                 replyHandler: @escaping ([String: Any]) -> Void) {
        if message["request"] as? String == "snapshot" {
            replyHandler(["snapshot": latestPayload ?? ""])
        } else {
            replyHandler([:])
        }
    }
}
