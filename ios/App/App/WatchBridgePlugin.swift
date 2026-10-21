import Foundation
import Capacitor
import WatchConnectivity
import WidgetKit

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
        CAPPluginMethod(name: "pairWatch", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeHandoff", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "nativeSignOut", returnType: CAPPluginReturnPromise)
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
        var payload: [String: String] = [
            "token": token,
            "locationId": locationId,
            "locationName": call.getString("locationName") ?? "",
            "apiUrl": call.getString("apiUrl") ?? ""
        ]
        // Optional initial location list (JSON string of [{id,name}]) so the watch
        // can offer its location switcher before the first snapshot lands.
        if let locationsJson = call.getString("locationsJson"), !locationsJson.isEmpty {
            payload["locations"] = locationsJson
        }
        let delivered = session.sendPairing(payload)
        call.resolve(["delivered": delivered])
    }

    /// Sign-in handoff for Siri, the Theo button and widgets (see NativeAuth.swift).
    @objc func nativeHandoff(_ call: CAPPluginCall) {
        guard let token = call.getString("accessToken"), let userId = call.getString("userId") else {
            call.reject("Missing accessToken or userId")
            return
        }
        Task {
            let reason = await NativeAuth.handoff(webAccessToken: token, userId: userId)
            print("[NativeAuth] handoff: \(reason)")
            call.resolve(["ok": reason == "ok" || reason == "already set up", "reason": reason])
        }
    }

    @objc func nativeSignOut(_ call: CAPPluginCall) {
        NativeAuth.signOut()
        call.resolve(["ok": true])
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
        // Make sure widgets see a pairing that was made before widgets existed.
        if let existing = latestPairing { CrooSharedGroup.writePairing(existing) }
        print("[WatchBridge] phone session activation requested — cached snapshot: \(latestPayload == nil ? "no" : "yes")")
    }

    private let pairingCacheKey = "croo.phone.watch.pairing"
    private var latestPairing: [String: String]? {
        get { UserDefaults.standard.dictionary(forKey: pairingCacheKey) as? [String: String] }
        set {
            UserDefaults.standard.set(newValue, forKey: pairingCacheKey)
            if let value = newValue { CrooSharedGroup.writePairing(value) }
        }
    }

    /// Context always carries the newest snapshot AND the current pairing, since
    /// updateApplicationContext replaces the whole dictionary.
    private func currentContext() -> [String: Any] {
        var ctx: [String: Any] = [:]
        if let payload = latestPayload { ctx["snapshot"] = payload }
        if let pairing = latestPairing { ctx["pairing"] = pairing }
        return ctx
    }

    private func canTalkToWatch(_ session: WCSession) -> Bool {
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
        return true
    }

    @discardableResult
    func send(payload: String) -> Bool {
        guard WCSession.isSupported() else {
            print("[WatchBridge] WCSession not supported on this device")
            return false
        }
        latestPayload = payload
        CrooSharedGroup.writeLocations(fromSnapshot: payload)
        let session = WCSession.default
        guard canTalkToWatch(session) else { return false }
        print("[WatchBridge] sending snapshot — reachable: \(session.isReachable)")
        do {
            try session.updateApplicationContext(currentContext())
            // Also queue a guaranteed-delivery copy so the watch still gets the
            // snapshot if it was asleep or launched later.
            session.transferUserInfo(["snapshot": payload])
            return true
        } catch {
            print("[WatchBridge] updateApplicationContext failed: \(error)")
            return false
        }
    }

    /// Hands the watch its own location-scoped device token (one-time pairing).
    @discardableResult
    func sendPairing(_ pairing: [String: String]) -> Bool {
        guard WCSession.isSupported() else { return false }
        latestPairing = pairing
        let session = WCSession.default
        guard canTalkToWatch(session) else { return false }
        do {
            try session.updateApplicationContext(currentContext())
            session.transferUserInfo(["pairing": pairing])
            print("[WatchBridge] pairing sent to watch for location \(pairing["locationId"] ?? "?")")
            return true
        } catch {
            print("[WatchBridge] pairing transfer failed: \(error)")
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
            var reply: [String: Any] = ["snapshot": latestPayload ?? ""]
            if let pairing = latestPairing { reply["pairing"] = pairing }
            replyHandler(reply)

        } else {
            replyHandler([:])
        }
    }
}


/// Mirrors the watch pairing (and the store list) into the App Group so the iPhone widgets
/// can fetch their own data without the app being open. Read-only data; same device token the watch uses.
enum CrooSharedGroup {
    static let groupId = "group.com.croohq.kitchenmate"
    static let pairingKey = "croo.shared.pairing"
    static let locationsKey = "croo.shared.locations"

    private static var defaults: UserDefaults? { UserDefaults(suiteName: groupId) }

    static func writePairing(_ pairing: [String: String]) {
        guard let defaults else { return }
        var meta: [String: String] = [:]
        for key in ["token", "locationId", "locationName", "apiUrl"] {
            if let v = pairing[key] { meta[key] = v }
        }
        defaults.set(meta, forKey: pairingKey)
        if let json = pairing["locations"], !json.isEmpty { defaults.set(json, forKey: locationsKey) }
        WidgetCenter.shared.reloadAllTimelines()
    }

    static var hasPairing: Bool {
        guard let d = defaults?.dictionary(forKey: pairingKey) as? [String: String] else { return false }
        return !(d["token"] ?? "").isEmpty
    }

    /// Store list for Siri's store picker: [(id, name)].
    static func locations() -> [(id: String, name: String)] {
        guard let json = defaults?.string(forKey: locationsKey), let data = json.data(using: .utf8),
              let arr = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
            if let d = defaults?.dictionary(forKey: pairingKey) as? [String: String], let id = d["locationId"] {
                return [(id, d["locationName"] ?? "My store")]
            }
            return []
        }
        return arr.compactMap { i in
            guard let id = i["id"] as? String, let name = i["name"] as? String else { return nil }
            return (id, name)
        }
    }

    static func pairing() -> [String: String]? { defaults?.dictionary(forKey: pairingKey) as? [String: String] }

    static func clearPairing() {
        defaults?.removeObject(forKey: pairingKey)
        WidgetCenter.shared.reloadAllTimelines()
    }

    /// `locations` from a dashboard snapshot payload: [{id, name}].
    static func writeLocations(fromSnapshot payload: String) {
        guard let defaults,
              let data = payload.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let arr = obj["locations"] as? [[String: Any]] else { return }
        let list: [[String: String]] = arr.compactMap { item in
            guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
            return ["id": id, "name": name]
        }
        guard !list.isEmpty,
              let out = try? JSONSerialization.data(withJSONObject: list),
              let json = String(data: out, encoding: .utf8) else { return }
        defaults.set(json, forKey: locationsKey)
    }
}
