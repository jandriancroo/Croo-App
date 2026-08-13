import Foundation
import Combine
import WatchConnectivity
import SwiftUI

// MARK: - Snapshot model (mirrors the phone payload / API response)

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
    /// "active" | "later" | "completed" — optional so older cached payloads still decode.
    let status: String?
    let hours: Double?

    var resolvedStatus: String { status ?? "later" }
    var hoursLabel: String {
        guard let hours, hours > 0 else { return "" }
        return String(format: hours.rounded() == hours ? "%.0fh" : "%.1fh", hours)
    }
}

struct WatchLocation: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct WatchSnapshot: Codable {
    let updatedAt: String
    let locationName: String
    let cubes: [WatchCube]
    let schedule: [WatchShift]
    let sales: [WatchMetric]
    /// Which location this snapshot is for, and every location this watch may switch to.
    let locationId: String?
    let locations: [WatchLocation]?

    init(updatedAt: String, locationName: String, cubes: [WatchCube], schedule: [WatchShift],
         sales: [WatchMetric], locationId: String? = nil, locations: [WatchLocation]? = nil) {
        self.updatedAt = updatedAt
        self.locationName = locationName
        self.cubes = cubes
        self.schedule = schedule
        self.sales = sales
        self.locationId = locationId
        self.locations = locations
    }

    static let empty = WatchSnapshot(updatedAt: "", locationName: "", cubes: [], schedule: [], sales: [])
}

private struct SnapshotEnvelope: Codable {
    let snapshot: WatchSnapshot?
    let error: String?
}

// MARK: - Pairing (location-scoped device token)

struct WatchPairing: Codable {
    let token: String
    let locationId: String
    let locationName: String
    let apiUrl: String

    static let defaultApiUrl = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/watch-device-service"
}

/// Small Keychain wrapper so the device token isn't kept in plain UserDefaults.
private enum TokenKeychain {
    private static let service = "com.croohq.watch.deviceToken"
    private static let account = "pairing"

    static func save(_ value: String) {
        let data = Data(value.utf8)
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
        var add = query
        add[kSecValueData as String] = data
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read() -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne
        ]
        var out: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &out) == errSecSuccess,
              let data = out as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func clear() {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account
        ]
        SecItemDelete(query as CFDictionary)
    }
}

// MARK: - API client

final class WatchAPIClient {
    static let shared = WatchAPIClient()

    /// Read-only snapshot fetch. Works with the iPhone app closed.
    func fetchSnapshot(pairing: WatchPairing, locationId: String?) async throws -> WatchSnapshot {
        let urlString = pairing.apiUrl.isEmpty ? WatchPairing.defaultApiUrl : pairing.apiUrl
        guard let url = URL(string: urlString) else { throw URLError(.badURL) }

        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 20
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(pairing.token, forHTTPHeaderField: "x-watch-token")
        var payload: [String: Any] = ["action": "snapshot"]
        if let locationId, !locationId.isEmpty { payload["locationId"] = locationId }
        request.httpBody = try JSONSerialization.data(withJSONObject: payload)

        let (data, response) = try await URLSession.shared.data(for: request)
        if let http = response as? HTTPURLResponse, http.statusCode == 401 {
            throw NSError(domain: "CrooWatch", code: 401,
                          userInfo: [NSLocalizedDescriptionKey: "This watch is no longer paired"])
        }
        let envelope = try JSONDecoder().decode(SnapshotEnvelope.self, from: data)
        if let snapshot = envelope.snapshot { return snapshot }
        throw NSError(domain: "CrooWatch", code: 0,
                      userInfo: [NSLocalizedDescriptionKey: envelope.error ?? "No snapshot returned"])
    }
}

// MARK: - Store

final class WatchDataStore: NSObject, ObservableObject, WCSessionDelegate {
    static let shared = WatchDataStore()

    @Published var snapshot: WatchSnapshot = .empty
    @Published var hasData: Bool = false
    @Published var isPaired: Bool = false
    @Published var pairedLocationName: String = ""
    /// Every location this watch may show, and the one currently selected.
    @Published var locations: [WatchLocation] = []
    @Published var selectedLocationId: String = ""
    @Published var isSwitchingLocation: Bool = false
    /// Human-readable link state, shown on the Status tab for troubleshooting.
    @Published var statusLine: String = "Starting…"
    @Published var lastEvent: String = "none"

    private let cacheKey = "croo.watch.snapshot"
    private let pairingKey = "croo.watch.pairing"
    private let selectedLocationKey = "croo.watch.selectedLocationId"
    private let locationsKey = "croo.watch.locations"
    private var refreshTimer: Timer?

    private(set) var pairing: WatchPairing? {
        didSet {
            let name = pairing?.locationName ?? ""
            DispatchQueue.main.async {
                self.isPaired = self.pairing != nil
                self.pairedLocationName = name
            }
        }
    }

    override private init() {
        super.init()
        loadPairing()
        loadLocations()
        loadCache()
    }

    func start() {
        if WCSession.isSupported() {
            let session = WCSession.default
            session.delegate = self
            session.activate()
        }
        // Independent fetch — does not need the iPhone app to be open.
        refreshFromAPI()
        refreshTimer?.invalidate()
        refreshTimer = Timer.scheduledTimer(withTimeInterval: 300, repeats: true) { [weak self] _ in
            self?.refreshFromAPI()
        }
    }

    // MARK: API refresh

    func refreshFromAPI() {
        guard let pairing else {
            DispatchQueue.main.async { self.lastEvent = "not paired yet — pair from the iPhone app" }
            return
        }
        Task {
            do {
                let target = selectedLocationId.isEmpty ? pairing.locationId : selectedLocationId
                let fresh = try await WatchAPIClient.shared.fetchSnapshot(pairing: pairing, locationId: target)
                await MainActor.run {
                    self.merge(fresh)
                    self.isSwitchingLocation = false
                    self.lastEvent = "loaded from CrooHQ (\(fresh.locationName.isEmpty ? "location" : fresh.locationName))"
                }
            } catch {
                await MainActor.run {
                    self.isSwitchingLocation = false
                    self.lastEvent = "fetch failed: \(error.localizedDescription)"
                }
            }
        }
    }

    // MARK: Location selection

    var currentLocationName: String {
        if let match = locations.first(where: { $0.id == selectedLocationId }) { return match.name }
        if !snapshot.locationName.isEmpty { return snapshot.locationName }
        return pairedLocationName
    }

    /// Persist the pick and immediately reload cubes / schedule / sales for it.
    func selectLocation(_ id: String) {
        guard id != selectedLocationId else { return }
        selectedLocationId = id
        UserDefaults.standard.set(id, forKey: selectedLocationKey)
        isSwitchingLocation = true
        refreshFromAPI()
    }

    private func loadLocations() {
        if let json = UserDefaults.standard.string(forKey: locationsKey),
           let data = json.data(using: .utf8),
           let decoded = try? JSONDecoder().decode([WatchLocation].self, from: data) {
            locations = decoded
        }
        // Default: last selected, else first available, else the paired location.
        let saved = UserDefaults.standard.string(forKey: selectedLocationKey) ?? ""
        if !saved.isEmpty && (locations.isEmpty || locations.contains(where: { $0.id == saved })) {
            selectedLocationId = saved
        } else {
            selectedLocationId = locations.first?.id ?? (pairing?.locationId ?? "")
        }
    }

    private func storeLocations(_ list: [WatchLocation]) {
        guard !list.isEmpty else { return }
        locations = list
        if let out = try? JSONEncoder().encode(list), let json = String(data: out, encoding: .utf8) {
            UserDefaults.standard.set(json, forKey: locationsKey)
        }
        if selectedLocationId.isEmpty || !list.contains(where: { $0.id == selectedLocationId }) {
            selectedLocationId = list.first?.id ?? selectedLocationId
            UserDefaults.standard.set(selectedLocationId, forKey: selectedLocationKey)
        }
    }

    // MARK: Pairing

    private func loadPairing() {
        guard let token = TokenKeychain.read(),
              let meta = UserDefaults.standard.dictionary(forKey: pairingKey) as? [String: String] else { return }
        pairing = WatchPairing(
            token: token,
            locationId: meta["locationId"] ?? "",
            locationName: meta["locationName"] ?? "",
            apiUrl: meta["apiUrl"] ?? WatchPairing.defaultApiUrl
        )
        isPaired = true
    }

    private func applyPairing(_ dict: [String: Any]) {
        guard let token = dict["token"] as? String, !token.isEmpty,
              let locationId = dict["locationId"] as? String else { return }
        let apiUrl = (dict["apiUrl"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? WatchPairing.defaultApiUrl
        let locationName = dict["locationName"] as? String ?? ""

        TokenKeychain.save(token)
        UserDefaults.standard.set(
            ["locationId": locationId, "locationName": locationName, "apiUrl": apiUrl],
            forKey: pairingKey
        )
        pairing = WatchPairing(token: token, locationId: locationId, locationName: locationName, apiUrl: apiUrl)

        // Optional initial location list sent with the pair payload.
        var incoming: [WatchLocation] = []
        if let raw = dict["locations"] as? String, let data = raw.data(using: .utf8) {
            incoming = (try? JSONDecoder().decode([WatchLocation].self, from: data)) ?? []
        } else if let arr = dict["locations"] as? [[String: Any]] {
            incoming = arr.compactMap { item in
                guard let id = item["id"] as? String, let name = item["name"] as? String else { return nil }
                return WatchLocation(id: id, name: name)
            }
        }
        let savedSelection = UserDefaults.standard.string(forKey: selectedLocationKey) ?? ""
        DispatchQueue.main.async {
            if !incoming.isEmpty { self.storeLocations(incoming) }
            if savedSelection.isEmpty || (!incoming.isEmpty && !incoming.contains(where: { $0.id == savedSelection })) {
                self.selectedLocationId = locationId
                UserDefaults.standard.set(locationId, forKey: self.selectedLocationKey)
            }
        }
        DispatchQueue.main.async {
            self.isPaired = true
            self.lastEvent = "paired with \(locationName.isEmpty ? "location" : locationName)"
        }
        refreshFromAPI()
    }

    func unpair() {
        TokenKeychain.clear()
        UserDefaults.standard.removeObject(forKey: pairingKey)
        UserDefaults.standard.removeObject(forKey: locationsKey)
        UserDefaults.standard.removeObject(forKey: selectedLocationKey)
        pairing = nil
        DispatchQueue.main.async {
            self.locations = []
            self.selectedLocationId = ""
        }
        DispatchQueue.main.async {
            self.isPaired = false
            self.lastEvent = "unpaired"
        }
    }

    func refreshStatus() {
        var lines: [String] = []
        lines.append("paired to location: \(isPaired ? (pairing?.locationName.isEmpty == false ? pairing!.locationName : "yes") : "no")")
        if WCSession.isSupported() {
            let s = WCSession.default
            if s.activationState == .activated {
                lines.append("iPhone app installed: \(s.isCompanionAppInstalled ? "yes" : "no")")
                lines.append("iPhone reachable: \(s.isReachable ? "yes" : "no")")
            } else {
                lines.append("iPhone link: starting…")
            }
        } else {
            lines.append("iPhone link: unsupported")
        }
        let line = lines.joined(separator: "\n")
        DispatchQueue.main.async { self.statusLine = line }
    }

    func requestRefresh() {
        refreshFromAPI()

        let session = WCSession.default
        guard WCSession.isSupported(), session.activationState == .activated, session.isReachable else { return }
        session.sendMessage(["request": "snapshot"], replyHandler: { reply in
            if let pairingDict = reply["pairing"] as? [String: Any] {
                self.applyPairing(pairingDict)
            }
            if let json = reply["snapshot"] as? String, !json.isEmpty {
                self.apply(json: json)
            }
        }, errorHandler: { error in
            DispatchQueue.main.async { self.lastEvent = "iPhone request failed: \(error.localizedDescription)" }
        })
    }

    // MARK: Snapshot handling

    private func apply(json: String) {
        guard let data = json.data(using: .utf8) else { return }
        do {
            let decoded = try JSONDecoder().decode(WatchSnapshot.self, from: data)
            DispatchQueue.main.async { self.merge(decoded) }
        } catch {
            print("[WatchBridge] snapshot decode failed: \(error.localizedDescription)")
        }
    }

    /// A snapshot that arrives while the phone dashboard is still loading can have
    /// no cubes yet — keep the ones we already have instead of flashing "No Cubes".
    private func merge(_ decoded: WatchSnapshot) {
        var merged = decoded
        if decoded.cubes.isEmpty && !snapshot.cubes.isEmpty {
            merged = WatchSnapshot(
                updatedAt: decoded.updatedAt,
                locationName: decoded.locationName.isEmpty ? snapshot.locationName : decoded.locationName,
                cubes: snapshot.cubes,
                schedule: decoded.schedule,
                sales: decoded.sales.isEmpty ? snapshot.sales : decoded.sales,
                locationId: decoded.locationId ?? snapshot.locationId,
                locations: (decoded.locations?.isEmpty == false) ? decoded.locations : snapshot.locations
            )
        }
        snapshot = merged
        if let list = merged.locations, !list.isEmpty { storeLocations(list) }
        if let id = merged.locationId, !id.isEmpty, selectedLocationId.isEmpty { selectedLocationId = id }
        hasData = true
        if let out = try? JSONEncoder().encode(merged), let outJson = String(data: out, encoding: .utf8) {
            UserDefaults.standard.set(outJson, forKey: cacheKey)
        }
        print("[WatchBridge] snapshot applied — cubes: \(merged.cubes.count), shifts: \(merged.schedule.count), sales: \(merged.sales.count)")
    }

    private func loadCache() {
        guard let json = UserDefaults.standard.string(forKey: cacheKey),
              let data = json.data(using: .utf8),
              let decoded = try? JSONDecoder().decode(WatchSnapshot.self, from: data) else { return }
        snapshot = decoded
        hasData = true
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        DispatchQueue.main.async {
            self.lastEvent = error == nil ? "watch session activated" : "activation error: \(error!.localizedDescription)"
        }
        refreshStatus()
        if activationState == .activated {
            if let pairingDict = session.receivedApplicationContext["pairing"] as? [String: Any] {
                applyPairing(pairingDict)
            }
            if let json = session.receivedApplicationContext["snapshot"] as? String {
                apply(json: json)
            }
            requestRefresh()
        }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) {
        if let pairingDict = applicationContext["pairing"] as? [String: Any] {
            applyPairing(pairingDict)
        }
        if let json = applicationContext["snapshot"] as? String {
            apply(json: json)
            DispatchQueue.main.async { self.lastEvent = "received context" }
        }
        refreshStatus()
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) {
        if let pairingDict = userInfo["pairing"] as? [String: Any] {
            applyPairing(pairingDict)
        }
        if let json = userInfo["snapshot"] as? String {
            apply(json: json)
            DispatchQueue.main.async { self.lastEvent = "received queued snapshot" }
        }
        refreshStatus()
    }

    /// Direct pair message from the iPhone: {"type":"watch_pair", token, locationId/location_id, locationName/location_name}
    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        handleIncoming(message)
        replyHandler(["ok": true])
    }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) {
        handleIncoming(message)
    }

    private func handleIncoming(_ payload: [String: Any]) {
        if let pairingDict = payload["pairing"] as? [String: Any] {
            applyPairing(pairingDict)
            return
        }
        if (payload["type"] as? String) == "watch_pair" {
            var dict: [String: Any] = [:]
            dict["token"] = payload["token"]
            dict["locationId"] = payload["locationId"] ?? payload["location_id"]
            dict["locationName"] = payload["locationName"] ?? payload["location_name"] ?? ""
            dict["apiUrl"] = payload["apiUrl"] ?? payload["api_url"] ?? ""
            if let locs = payload["locations"] { dict["locations"] = locs }
            applyPairing(dict)
        }
        if let json = payload["snapshot"] as? String, !json.isEmpty {
            apply(json: json)
        }
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
