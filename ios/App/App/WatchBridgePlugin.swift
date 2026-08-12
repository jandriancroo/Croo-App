import Foundation
import Capacitor
import WatchConnectivity

/// Bridges the CrooHQ web app to the Apple Watch app.
/// Read-only mirror: it forwards a snapshot of the dashboard (Data Cubes,
/// today's schedule, sales summary) to the watch. It never changes phone data.
@objc(WatchBridge)
public class WatchBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "WatchBridge"
    public let jsName = "WatchBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "sendSnapshot", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "isPaired", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "pairWatch", returnType: CAPPluginReturnPromise)
    ]

    private let session = WatchSessionManager.shared

    override public func load() {
        print("[WatchBridge] Capacitor plugin loaded — JavaScript calls are ready")
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

    /// One-time handoff of a location-scoped device token so the watch can fetch
    /// its own data without the iPhone app being open.
    @objc func pairWatch(_ call: CAPPluginCall) {
        guard let token = call.getString("token"),
              let locationId = call.getString("locationId") else {
            call.reject("Missing token or locationId")
            return
        }
        let delivered = session.sendPairing([
            "token": token,
            "locationId": locationId,
            "locationName": call.getString("locationName") ?? "",
            "apiUrl": call.getString("apiUrl") ?? ""
        ])
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

    private let payloadCacheKey = "croo.phone.watch.latestSnapshot"
    private var latestPayload: String? {
        get { UserDefaults.standard.string(forKey: payloadCacheKey) }
        set { UserDefaults.standard.set(newValue, forKey: payloadCacheKey) }
    }

    var isPaired: Bool {
        guard WCSession.isSupported() else { return false }
        return WCSession.default.isPaired
    }

    var isReachable: Bool {
        guard WCSession.isSupported() else { return false }
        return WCSession.default.isReachable
    }

    func activate() {
        guard WCSession.isSupported() else {
            print("[WatchBridge] WCSession not supported on this device")
            return
        }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        print("[WatchBridge] phone session activation requested — cached snapshot: \(latestPayload == nil ? "no" : "yes")")
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
        guard session.isPaired else {
            print("[WatchBridge] no Apple Watch is paired with this iPhone")
            return false
        }
        guard session.isWatchAppInstalled else {
            print("[WatchBridge] CrooWatch is not recognized as this iPhone app's companion — verify its bundle identifier")
            return false
        }
        print("[WatchBridge] sending snapshot — paired: \(session.isPaired), watchAppInstalled: \(session.isWatchAppInstalled), reachable: \(session.isReachable)")
        do {
            try session.updateApplicationContext(["snapshot": payload])
            // Also queue a guaranteed-delivery copy so the watch still gets the
            // snapshot if it was asleep or launched later.
            session.transferUserInfo(["snapshot": payload])
            return true
        } catch {
            print("[WatchBridge] updateApplicationContext failed: \(error)")
            return false
        }
    }

    // MARK: - WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        print("[WatchBridge] phone session activation = \(activationState.rawValue), error = \(error?.localizedDescription ?? "none"), paired = \(session.isPaired), watchAppInstalled = \(session.isWatchAppInstalled)")
        if let payload = latestPayload, activationState == .activated {
            _ = send(payload: payload)
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
