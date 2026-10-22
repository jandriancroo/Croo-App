import Foundation
import CryptoKit

/// "What to Test" notes for TestFlight.
///  - draft(): the "## Next build" section of ios/TESTFLIGHT_NOTES.md (written in plain English as
///    features ship); if it's empty, a list of the app changes since the last shipped build.
///  - post(): with an App Store Connect API key (~/.croo-builder/asc.env), waits for Apple to finish
///    processing the build, then fills in "What to Test". Without a key, Ship copies the notes instead.
enum TestFlightNotes {
    static let bundleId = "com.croohq.kitchenmate"
    static let notesPath = "ios/TESTFLIGHT_NOTES.md"

    // MARK: Draft

    static func draft(repo: String) -> String {
        let fromFile = nextBuildSection(repo: repo)
        if !fromFile.isEmpty { return fromFile }
        let changes = changesSinceLastBuild(repo: repo)
        if changes.isEmpty { return "Bug fixes and improvements." }
        return "What's new:\n" + changes.map { "- \($0)" }.joined(separator: "\n")
    }

    /// Text between "## Next build" and the next "## " heading.
    static func nextBuildSection(repo: String) -> String {
        guard let text = try? String(contentsOfFile: repo + "/" + notesPath, encoding: .utf8) else { return "" }
        var out: [String] = []
        var inside = false
        for line in text.components(separatedBy: "\n") {
            if line.hasPrefix("## ") {
                if inside { break }
                inside = line.lowercased().hasPrefix("## next build")
                continue
            }
            if inside { out.append(line) }
        }
        return out.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Commit titles that touched the Apple apps since the last "Build N" commit (the fallback).
    static func changesSinceLastBuild(repo: String) -> [String] {
        let last = git(repo, ["log", "-1", "--format=%H", "--extended-regexp", "--grep=^Build [0-9]+$"])
            .trimmingCharacters(in: .whitespacesAndNewlines)
        var args = ["log", "--format=%s", "--no-merges"]
        args.append(last.isEmpty ? "-20" : "\(last)..HEAD")
        args += ["--", "ios", "widgets", "watch"]
        return git(repo, args)
            .components(separatedBy: "\n")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty && $0.range(of: #"^Build \d+$"#, options: .regularExpression) == nil }
    }

    private static func git(_ repo: String, _ args: [String]) -> String {
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/git")
        p.arguments = ["-C", repo] + args
        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = FileHandle.nullDevice
        do { try p.run() } catch { return "" }
        let data = pipe.fileHandleForReading.readDataToEndOfFile()
        p.waitUntilExit()
        return String(data: data, encoding: .utf8) ?? ""
    }

    // MARK: App Store Connect

    struct Key { let path: String; let id: String; let issuer: String }

    /// ~/.croo-builder/asc.env with ASC_KEY_PATH, ASC_KEY_ID, ASC_ISSUER_ID (same file Ship uses).
    static func apiKey() -> Key? {
        let file = NSHomeDirectory() + "/.croo-builder/asc.env"
        guard let text = try? String(contentsOfFile: file, encoding: .utf8) else { return nil }
        var v: [String: String] = [:]
        for raw in text.components(separatedBy: "\n") {
            var line = raw.trimmingCharacters(in: .whitespaces)
            if line.hasPrefix("export ") { line.removeFirst(7) }
            guard !line.hasPrefix("#"), let eq = line.firstIndex(of: "=") else { continue }
            let k = String(line[..<eq]).trimmingCharacters(in: .whitespaces)
            var val = String(line[line.index(after: eq)...]).trimmingCharacters(in: .whitespaces)
            val = val.trimmingCharacters(in: CharacterSet(charactersIn: "\"'"))
            if val.hasPrefix("~") { val = NSHomeDirectory() + val.dropFirst() }
            v[k] = val
        }
        guard let p = v["ASC_KEY_PATH"], let i = v["ASC_KEY_ID"], let s = v["ASC_ISSUER_ID"], !p.isEmpty, !i.isEmpty, !s.isEmpty else { return nil }
        return Key(path: p, id: i, issuer: s)
    }

    enum PostError: LocalizedError {
        case key(String), api(String), timeout
        var errorDescription: String? {
            switch self {
            case .key(let m): return "API key problem: \(m)"
            case .api(let m): return "App Store Connect said: \(m)"
            case .timeout: return "Apple was still processing the build after 60 minutes."
            }
        }
    }

    /// Waits (up to 60 min) for build `build` to show up in App Store Connect, then sets "What to Test".
    static func post(build: String, notes: String, key: Key, progress: @escaping @Sendable (String) -> Void) async throws {
        let api = ASC(key: key)
        let apps = try await api.get("/v1/apps?filter[bundleId]=\(bundleId)&limit=1")
        guard let appId = (apps["data"] as? [[String: Any]])?.first?["id"] as? String else {
            throw PostError.api("couldn't find the app \(bundleId)")
        }
        var buildId: String?
        for minute in 0..<60 {
            let builds = try await api.get("/v1/builds?filter[app]=\(appId)&filter[version]=\(build)&limit=1")
            if let b = (builds["data"] as? [[String: Any]])?.first, let id = b["id"] as? String {
                buildId = id
                break
            }
            if minute == 0 { progress("Waiting for Apple to process build \(build) before adding the notes…") }
            try await Task.sleep(nanoseconds: 60_000_000_000)
        }
        guard let buildId else { throw PostError.timeout }

        let existing = try await api.get("/v1/builds/\(buildId)/betaBuildLocalizations")
        let text = String(notes.prefix(4000))
        if let loc = (existing["data"] as? [[String: Any]])?.first, let locId = loc["id"] as? String {
            _ = try await api.send("PATCH", "/v1/betaBuildLocalizations/\(locId)", [
                "data": ["type": "betaBuildLocalizations", "id": locId, "attributes": ["whatsNew": text]],
            ])
        } else {
            _ = try await api.send("POST", "/v1/betaBuildLocalizations", [
                "data": [
                    "type": "betaBuildLocalizations",
                    "attributes": ["locale": "en-US", "whatsNew": text],
                    "relationships": ["build": ["data": ["type": "builds", "id": buildId]]],
                ],
            ])
        }
    }

    /// Tiny App Store Connect client (ES256 token signed with the .p8 key).
    struct ASC {
        let key: Key

        func token() throws -> String {
            guard let pem = try? String(contentsOfFile: key.path, encoding: .utf8) else { throw PostError.key("can't read \(key.path)") }
            let pk: P256.Signing.PrivateKey
            do { pk = try P256.Signing.PrivateKey(pemRepresentation: pem) } catch { throw PostError.key("the .p8 file isn't a valid key") }
            let now = Int(Date().timeIntervalSince1970)
            let header = ["alg": "ES256", "kid": key.id, "typ": "JWT"]
            let payload: [String: Any] = ["iss": key.issuer, "iat": now, "exp": now + 1100, "aud": "appstoreconnect-v1"]
            let h = try b64(JSONSerialization.data(withJSONObject: header))
            let p = try b64(JSONSerialization.data(withJSONObject: payload))
            let sig = try pk.signature(for: Data("\(h).\(p)".utf8))
            return "\(h).\(p).\(b64(sig.rawRepresentation))"
        }

        private func b64(_ d: Data) -> String {
            d.base64EncodedString().replacingOccurrences(of: "+", with: "-")
                .replacingOccurrences(of: "/", with: "_").replacingOccurrences(of: "=", with: "")
        }

        func get(_ path: String) async throws -> [String: Any] { try await send("GET", path, nil) }

        func send(_ method: String, _ path: String, _ body: [String: Any]?) async throws -> [String: Any] {
            let encoded = path.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? path
            guard let url = URL(string: "https://api.appstoreconnect.apple.com" + encoded) else { throw PostError.api("bad URL") }
            var req = URLRequest(url: url)
            req.httpMethod = method
            let jwt = try token()
            req.setValue("Bearer \(jwt)", forHTTPHeaderField: "Authorization")
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, resp) = try await URLSession.shared.data(for: req)
            let obj = (try? JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            guard (200..<300).contains(code) else {
                let detail = ((obj["errors"] as? [[String: Any]])?.first?["detail"] as? String) ?? "HTTP \(code)"
                throw PostError.api(detail)
            }
            return obj
        }
    }
}
