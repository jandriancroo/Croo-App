import Foundation
import Combine
import WatchConnectivity
import SwiftUI

// MARK: - Snapshot model (mirrors the phone payload)

struct WatchMetric: Codable, Hashable {
    let label: String
    let value: String
}

struct WatchCubeFace: Codable, Hashable {
    let title: String
    let metrics: [WatchMetric]
}

struct WatchCube: Codable, Hashable, Identifiable {
    let id: String
    let title: String
    let accentColor: String
    let faces: [WatchCubeFace]
}

struct WatchShift: Codable, Hashable, Identifiable {
    let id: String
    let name: String
    let role: String
    let time: String
    let isMe: Bool
}

struct WatchSnapshot: Codable {
    let updatedAt: String
    let locationName: String
    let cubes: [WatchCube]
    let schedule: [WatchShift]
    let sales: [WatchMetric]

    static let empty = WatchSnapshot(updatedAt: "", locationName: "", cubes: [], schedule: [], sales: [])
}

// MARK: - Store

final class WatchDataStore: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchDataStore()

    @Published var snapshot: WatchSnapshot = .empty
    @Published var hasData: Bool = false
    /// Human-readable link state, shown on the Status tab for troubleshooting.
    @Published var statusLine: String = "Starting…"
    @Published var lastEvent: String = "none"

    private let cacheKey = "croo.watch.snapshot"

    override private init() {
        super.init()
        loadCache()
    }

    func start() {
        guard WCSession.isSupported() else { return }
        let session = WCSession.default
        session.delegate = self
        session.activate()
        // Status + refresh happen in the activation callback — reading session
        // properties before activation completes logs noisy warnings.
    }

    func refreshStatus() {
        guard WCSession.isSupported() else {
            DispatchQueue.main.async { self.statusLine = "WatchConnectivity unsupported" }
            return
        }
        let s = WCSession.default
        guard s.activationState == .activated else {
            DispatchQueue.main.async { self.statusLine = "session: starting…" }
            return
        }
        let state = "activated"
        let companion = s.isCompanionAppInstalled ? "yes" : "no"
        let line = "session: \(state)\niPhone app installed: \(companion)\nreachable: \(s.isReachable ? "yes" : "no")"
        DispatchQueue.main.async { self.statusLine = line }
    }

    func requestRefresh() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }

        session.sendMessage(["request": "snapshot"], replyHandler: { reply in
            if let json = reply["snapshot"] as? String, !json.isEmpty {
                self.apply(json: json)
                DispatchQueue.main.async { self.lastEvent = "reply from iPhone" }
            } else {
                DispatchQueue.main.async { self.lastEvent = "iPhone replied but had no snapshot yet" }
            }
        }, errorHandler: { error in
            DispatchQueue.main.async { self.lastEvent = "request failed: \(error.localizedDescription)" }
        })
    }

    private func apply(json: String) {
        guard let data = json.data(using: .utf8) else {
            DispatchQueue.main.async { self.lastEvent = "snapshot was not valid text" }
            return
        }
        let decoded: WatchSnapshot
        do {
            decoded = try JSONDecoder().decode(WatchSnapshot.self, from: data)
        } catch {
            print("[WatchBridge] snapshot decode failed: \(error.localizedDescription)")
            DispatchQueue.main.async { self.lastEvent = "snapshot decode failed: \(error.localizedDescription)" }
            return
        }
        DispatchQueue.main.async {
            // A snapshot that arrives while the phone dashboard is still loading
            // can have no cubes yet — keep the ones we already have instead of
            // flashing an empty "No Cubes" state.
            var merged = decoded
            if decoded.cubes.isEmpty && !self.snapshot.cubes.isEmpty {
                merged = WatchSnapshot(
                    updatedAt: decoded.updatedAt,
                    locationName: decoded.locationName.isEmpty ? self.snapshot.locationName : decoded.locationName,
                    cubes: self.snapshot.cubes,
                    schedule: decoded.schedule,
                    sales: decoded.sales.isEmpty ? self.snapshot.sales : decoded.sales
                )
            }
            self.snapshot = merged
            self.hasData = true
            if let out = try? JSONEncoder().encode(merged), let outJson = String(data: out, encoding: .utf8) {
                UserDefaults.standard.set(outJson, forKey: self.cacheKey)
            }
            print("[WatchBridge] snapshot applied — cubes: \(merged.cubes.count), shifts: \(merged.schedule.count), sales: \(merged.sales.count)")
        }
    }

    private func loadCache() {
        guard let json = UserDefaults.standard.string(forKey: cacheKey) else { return }
        if let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode(WatchSnapshot.self, from: data) {
            snapshot = decoded
            hasData = true
        }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.lastEvent = error == nil ? "watch session activated" : "activation error: \(error!.localizedDescription)"
        }
        refreshStatus()
        if activationState == .activated {
            if let json = session.receivedApplicationContext["snapshot"] as? String {
                apply(json: json)
                DispatchQueue.main.async { self.lastEvent = "loaded latest phone context" }
            } else {
                print("[WatchBridge] application context has no snapshot")
                DispatchQueue.main.async { self.lastEvent = "phone has not sent a snapshot yet" }
            }
            requestRefresh()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["snapshot"] as? String {
            apply(json: json)
            DispatchQueue.main.async { self.lastEvent = "received context" }
        }
        refreshStatus()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let json = userInfo["snapshot"] as? String {
            apply(json: json)
            DispatchQueue.main.async { self.lastEvent = "received queued snapshot" }
        }
        refreshStatus()
    }

    func sessionReachabilityDidChange(_ session: WCSession) {
        refreshStatus()
        requestRefresh()
    }
}

// MARK: - Helpers

extension Color {
    init(hex: String) {
        let cleaned = hex.trimmingCharacters(in: CharacterSet.alphanumerics.inverted)
        var value: UInt64 = 0
        Scanner(string: cleaned).scanHexInt64(&value)
        let r = Double((value & 0xFF0000) >> 16) / 255
        let g = Double((value & 0x00FF00) >> 8) / 255
        let b = Double(value & 0x0000FF) / 255
        self.init(red: r, green: g, blue: b)
    }
}
