import Foundation
import SwiftUI

/// Pairs this Vision Pro the same way the watch does (a read-only device token from
/// watch-device-service), then keeps the live snapshot fresh. Your password is used once
/// to get the token and is never saved.
@MainActor
final class VisionStore: ObservableObject {
    @Published private(set) var snapshot: VSnapshot?
    @Published private(set) var locations: [VLocation] = []
    @Published var selectedLocationId: String?
    @Published private(set) var isPaired = false
    @Published private(set) var loading = false
    @Published var errorText: String?

    private let defaults = UserDefaults.standard
    private let tokenKey = "croo.vision.token"
    private let locationKey = "croo.vision.location"
    private let locationsKey = "croo.vision.locations"
    private var pollTask: Task<Void, Never>?

    init() {
        isPaired = token != nil
        selectedLocationId = defaults.string(forKey: locationKey)
        if let data = defaults.data(forKey: locationsKey),
           let list = try? JSONDecoder().decode([VLocation].self, from: data) {
            locations = list
        }
    }

    private var token: String? {
        let t = defaults.string(forKey: tokenKey)
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
            guard let first = locs.first else { throw VError("No locations found for this account.") }
            let issued = try await issueToken(accessToken: access, locationId: first.id)
            defaults.set(issued.token, forKey: tokenKey)
            let list = issued.locations?.isEmpty == false ? issued.locations! : locs
            saveLocations(list)
            selectLocation(issued.locationId ?? first.id)
            isPaired = true
            await refresh()
            startPolling()
        } catch {
            errorText = (error as? VError)?.message ?? "Couldn't sign in. Check your email and password."
        }
    }

    func signOut() {
        pollTask?.cancel()
        defaults.removeObject(forKey: tokenKey)
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
                try? await Task.sleep(nanoseconds: 60 * 1_000_000_000)
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
                errorText = "This Vision Pro was unpaired. Sign in again."
                signOut()
                return
            }
            let env = try JSONDecoder().decode(VEnvelope.self, from: data)
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

    private func saveLocations(_ list: [VLocation]) {
        locations = list
        if let data = try? JSONEncoder().encode(list) { defaults.set(data, forKey: locationsKey) }
    }

    // MARK: Network helpers

    private struct VError: Error {
        let message: String
        init(_ m: String) { message = m }
    }

    private struct IssueResponse: Decodable {
        var token: String
        var locationId: String?
        var locations: [VLocation]?
        var error: String?
    }

    private func passwordSignIn(email: String, password: String) async throws -> String {
        guard let url = URL(string: CrooConfig.supabaseURL + "/auth/v1/token?grant_type=password") else { throw VError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["email": email, "password": password])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let access = obj["access_token"] as? String else {
            throw VError("Couldn't sign in. Check your email and password.")
        }
        return access
    }

    private func fetchLocations(accessToken: String) async throws -> [VLocation] {
        guard let url = URL(string: CrooConfig.supabaseURL + "/rest/v1/locations?select=id,name&order=name") else { throw VError("Bad URL") }
        var req = URLRequest(url: url)
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try? JSONDecoder().decode([VLocation].self, from: data)) ?? []
    }

    private func issueToken(accessToken: String, locationId: String) async throws -> IssueResponse {
        guard let url = URL(string: CrooConfig.deviceServiceURL) else { throw VError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(accessToken)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": "issue", "locationId": locationId, "label": "Vision Pro"])
        let (data, _) = try await URLSession.shared.data(for: req)
        if let r = try? JSONDecoder().decode(IssueResponse.self, from: data), !r.token.isEmpty { return r }
        let msg = (try? JSONSerialization.jsonObject(with: data) as? [String: Any])?["error"] as? String
        throw VError(msg ?? "Couldn't pair this Vision Pro. You need to be an admin of the organization.")
    }
}
