import Foundation
import SwiftUI
import Combine
import Security

/// Pairs this Apple TV the same way the Vision Pro and the watch do: a read-only device
/// token from watch-device-service, then a live snapshot every 30 seconds.
/// Your password is used once to get the token and is never saved.
@MainActor
final class TVStore: ObservableObject {
    @Published private(set) var snapshot: TVSnapshot?
    @Published private(set) var locations: [TVLocation] = []
    @Published var selectedLocationId: String?
    @Published private(set) var isPaired = false
    @Published private(set) var loading = false
    @Published var errorText: String?

    private let defaults = UserDefaults.standard
    private let locationKey = "croo.tv.location"
    private let locationsKey = "croo.tv.locations"
    private let tokenKeychainKey = "croo.tv.token"
    private var pollTask: Task<Void, Never>?

    init() {
        isPaired = token != nil
        selectedLocationId = defaults.string(forKey: locationKey)
        if let data = defaults.data(forKey: locationsKey),
           let list = try? JSONDecoder().decode([TVLocation].self, from: data) {
            locations = list
        }
    }

    private var token: String? {
        let t = TVKeychain.read(tokenKeychainKey)
        return (t ?? "").isEmpty ? nil : t
    }

    var selectedLocationName: String {
        if let id = selectedLocationId, let l = locations.first(where: { $0.id == id }) { return l.name }
        return snapshot?.locationName ?? "CrooHQ"
    }

    // MARK: Pairing

    func signIn(email: String, password: String) async {
        errorText = nil
        loading = true
        defer { loading = false }
        do {
            let access = try await passwordSignIn(email: email, password: password)
            let locs = try await fetchLocations(accessToken: access)
            guard let first = locs.first else { throw TVError("No locations found for this account.") }
            let issued = try await issueToken(accessToken: access, locationId: first.id)
            TVKeychain.save(tokenKeychainKey, issued.token)
            let list = issued.locations?.isEmpty == false ? issued.locations! : locs
            saveLocations(list)
            selectLocation(issued.locationId ?? first.id)
            isPaired = true
            await refresh()
            startPolling()
        } catch {
            errorText = (error as? TVError)?.message ?? "Couldn't sign in. Check your email and password."
        }
    }

    func signOut() {
        pollTask?.cancel()
        TVKeychain.delete(tokenKeychainKey)
        snapshot = nil
        isPaired = false
    }

    func selectLocation(_ id: String) {
        selectedLocationId = id
        defaults.set(id, forKey: locationKey)
        Task { await refresh() }
    }

    // MARK: Live data

    func startPolling() {
        pollTask?.cancel()
        pollTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                try? await Task.sleep(nanoseconds: 30 * 1_000_000_000)
            }
        }
    }

    func refresh() async {
        guard let token, let url = URL(string: CrooConfig.deviceServiceURL) else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 15
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-watch-token")
        var body: [String: Any] = ["action": "snapshot"]
        if let id = selectedLocationId { body["locationId"] = id }
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await URLSession.shared.data(for: req)
            if let http = resp as? HTTPURLResponse, http.statusCode == 401 || http.statusCode == 403 {
                errorText = "This Apple TV was unpaired. Sign in again."
                signOut()
                return
            }
            let env = try JSONDecoder().decode(TVEnvelope.self, from: data)
            if let snap = env.snapshot {
                snapshot = snap
                if let list = snap.locations, !list.isEmpty { saveLocations(list) }
                errorText = nil
            } else if let e = env.error {
                errorText = e
            }
        } catch {
            errorText = snapshot == nil ? "Can't reach CrooHQ right now." : nil
        }
    }

    private func saveLocations(_ list: [TVLocation]) {
        locations = list
        if let data = try? JSONEncoder().encode(list) { defaults.set(data, forKey: locationsKey) }
    }

    // MARK: Network helpers

    private struct TVError: Error {
        let message: String
        init(_ m: String) { message = m }
    }

    private struct IssueResponse: Decodable {
        var token: String
        var locationId: String?
        var locations: [TVLocation]?
        var error: String?
    }

    private func passwordSignIn(email: String, password: String) async throws -> String {
        guard let url = URL(string: CrooConfig.supabaseURL + "/auth/v1/token?grant_type=password") else { throw TVError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = obj["access_token"] as? String else {
            throw TVError("Couldn't sign in. Check your email and password.")
        }
        return access
    }

    private func fetchLocations(accessToken: String) async throws -> [TVLocation] {
        guard let url = URL(string: CrooConfig.supabaseURL + "/rest/v1/locations?select=id,name&order=name") else { throw TVError("Bad URL") }
        var req = URLRequest(url: url)
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([TVLocation].self, from: data)) ?? []
    }

    private func issueToken(accessToken: String, locationId: String) async throws -> IssueResponse {
        guard let url = URL(string: CrooConfig.deviceServiceURL) else { throw TVError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": "issue", "locationId": locationId, "label": "Apple TV"])
        let (data, _) = try await URLSession.shared.data(for: req)
        if let r = try? JSONDecoder().decode(IssueResponse.self, from: data), !r.token.isEmpty { return r }
        let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        throw TVError(msg ?? "Couldn't pair this Apple TV. You need to be an admin of the organization.")
    }
}

/// Tiny Keychain wrapper (the Apple TV can clear normal app storage, the Keychain is steadier).
enum TVKeychain {
    private static let service = "com.croohq.tv"

    static func save(_ key: String, _ value: String) {
        delete(key)
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock,
                                kSecValueData as String: Data(value.utf8)]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func read(_ key: String) -> String? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return String(data: d, encoding: .utf8)
    }

    static func delete(_ key: String) {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrService as String: service,
                                kSecAttrAccount as String: key]
        SecItemDelete(q as CFDictionary)
    }
}
