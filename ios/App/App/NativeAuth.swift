import Foundation
import Security
import WidgetKit

/// Native side of the iPhone app's sign-in, for Siri, the Theo button and the widgets.
///
/// The web app hands over its access token once (NativeHandoff in src/lib/nativeHandoff.ts). We trade it for:
///  1. our OWN session for the same person (watch-device-service native_session → /auth/v1/verify),
///     kept in the Keychain, so Siri can ask Theo as them without touching the web view's session;
///  2. a read-only device token (watch-device-service issue_self) written to the App Group,
///     so widgets and Siri's store numbers work without the Apple Watch pairing screen.
/// Shift managers and up only; the server decides.
enum NativeAuth {
    static let supabaseURL = "https://lmodeiyrpwvgyqcvjkjr.supabase.co"
    static let anonKey = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg"
    static let deviceServiceURL = supabaseURL + "/functions/v1/watch-device-service"

    private static let refreshKey = "croo.native.refresh"
    private static let userKey = "croo.native.userId"
    private static let selfPairingKey = "croo.native.selfPairing"

    private static var accessToken: String?
    private static var accessExpiry = Date.distantPast

    static var userId: String? { UserDefaults.standard.string(forKey: userKey) }
    static var hasSession: Bool { NativeKeychain.read(refreshKey) != nil }

    // MARK: Handoff from the web app

    /// Returns a short reason for logs ("ok", "skipped", "not a manager", …).
    static func handoff(webAccessToken: String, userId newUser: String) async -> String {
        // Same person and already set up: nothing to do.
        if newUser == userId, hasSession, CrooSharedGroup.hasPairing { return "already set up" }
        if newUser != userId { signOut(keepWatchPairing: true) }

        var result = "ok"
        // 1. Own session (for Siri asking Theo).
        do {
            let link = try await call(action: "native_session", body: [:], bearer: webAccessToken)
            guard let hash = link["token_hash"] as? String else {
                return (link["error"] as? String) ?? "no session"
            }
            let session = try await verify(tokenHash: hash, type: link["type"] as? String ?? "magiclink")
            save(session)
            UserDefaults.standard.set(newUser, forKey: userKey)
        } catch {
            result = "session failed"
        }
        // 2. Device token for widgets / store numbers, only if this phone has no pairing yet
        //    (an Apple Watch pairing made from the app keeps priority).
        if !CrooSharedGroup.hasPairing {
            do {
                let issued = try await call(action: "issue_self", body: ["label": "iPhone"], bearer: webAccessToken)
                if let token = issued["token"] as? String, let loc = issued["locationId"] as? String {
                    var pairing: [String: String] = [
                        "token": token, "locationId": loc,
                        "locationName": issued["locationName"] as? String ?? "",
                        "apiUrl": deviceServiceURL,
                    ]
                    if let list = issued["locations"],
                       let data = try? JSONSerialization.data(withJSONObject: list),
                       let json = String(data: data, encoding: .utf8) { pairing["locations"] = json }
                    CrooSharedGroup.writePairing(pairing)
                    UserDefaults.standard.set(true, forKey: selfPairingKey)
                } else if result == "ok" {
                    result = (issued["error"] as? String) ?? "no device token"
                }
            } catch {
                if result == "ok" { result = "device token failed" }
            }
        }
        if #available(iOS 18.0, *) { CrooShortcuts.updateAppShortcutParameters() }
        return result
    }

    /// Called when the person signs out of the app.
    static func signOut(keepWatchPairing: Bool = true) {
        NativeKeychain.delete(refreshKey)
        UserDefaults.standard.removeObject(forKey: userKey)
        accessToken = nil
        accessExpiry = .distantPast
        if UserDefaults.standard.bool(forKey: selfPairingKey) {
            CrooSharedGroup.clearPairing()
            UserDefaults.standard.set(false, forKey: selfPairingKey)
        }
    }

    // MARK: Session for Siri / Theo

    /// A fresh access token for the signed-in person, refreshed when close to expiring.
    static func validAccessToken() async throws -> String {
        if let t = accessToken, accessExpiry > Date().addingTimeInterval(60) { return t }
        guard let refresh = NativeKeychain.read(refreshKey),
              let url = URL(string: supabaseURL + "/auth/v1/token?grant_type=refresh_token") else {
            throw NativeAuthError.signedOut
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["access_token"] is String else {
            NativeKeychain.delete(refreshKey)
            throw NativeAuthError.signedOut
        }
        save(obj)
        return accessToken ?? ""
    }

    // MARK: Helpers

    private static func save(_ obj: [String: Any]) {
        accessToken = obj["access_token"] as? String
        let expiresIn = (obj["expires_in"] as? Double) ?? Double(obj["expires_in"] as? Int ?? 3600)
        accessExpiry = Date().addingTimeInterval(expiresIn)
        if let r = obj["refresh_token"] as? String { NativeKeychain.save(refreshKey, r) }
    }

    private static func call(action: String, body: [String: Any], bearer: String) async throws -> [String: Any] {
        guard let url = URL(string: deviceServiceURL) else { throw NativeAuthError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(bearer)", forHTTPHeaderField: "Authorization")
        var b = body
        b["action"] = action
        req.httpBody = try JSONSerialization.data(withJSONObject: b)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func verify(tokenHash: String, type: String) async throws -> [String: Any] {
        guard let url = URL(string: supabaseURL + "/auth/v1/verify") else { throw NativeAuthError.badURL }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(anonKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["type": type, "token_hash": tokenHash])
        let (data, resp) = try await URLSession.shared.data(for: req)
        guard (resp as? HTTPURLResponse)?.statusCode == 200,
              let obj = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              obj["access_token"] is String else { throw NativeAuthError.verifyFailed }
        return obj
    }
}

enum NativeAuthError: Error { case signedOut, badURL, verifyFailed }

/// Tiny Keychain wrapper (this app only).
enum NativeKeychain {
    private static let service = "com.croohq.native"

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
