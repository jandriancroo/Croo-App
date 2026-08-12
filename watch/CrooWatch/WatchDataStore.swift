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
        requestRefresh()
    }

    func requestRefresh() {
        let session = WCSession.default
        guard session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(["request": "snapshot"], replyHandler: { reply in
            if let json = reply["snapshot"] as? String, !json.isEmpty {
                self.apply(json: json)
            }
        }, errorHandler: nil)
    }

    private func apply(json: String) {
        guard let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
        DispatchQueue.main.async {
            self.snapshot = decoded
            self.hasData = true
            UserDefaults.standard.set(json, forKey: self.cacheKey)
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
        if activationState == .activated {
            if let json = session.receivedApplicationContext["snapshot"] as? String {
                apply(json: json)
            }
            requestRefresh()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let json = applicationContext["snapshot"] as? String {
            apply(json: json)
        }
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
