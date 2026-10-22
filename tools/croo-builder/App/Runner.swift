import Foundation
import AppKit
import UserNotifications

enum BuilderAction: Equatable {
    case getLatest, saveChanges, ship
    case runOnDevice(scheme: String, udid: String, platform: String, name: String)

    var title: String {
        switch self {
        case .getLatest: return "Get latest"
        case .saveChanges: return "Save my changes"
        case .ship: return "Ship to TestFlight"
        case .runOnDevice(_, _, _, let name): return "Run on \(name)"
        }
    }

    var script: String {
        switch self {
        case .getLatest: return "get-latest.sh"
        case .saveChanges: return "save-changes.sh"
        case .ship: return "ship.sh"
        case .runOnDevice: return "run-device.sh"
        }
    }

    var arguments: [String] {
        if case .runOnDevice(let scheme, let udid, let platform, _) = self { return [scheme, udid, platform] }
        return []
    }
}

struct LogLine: Identifiable {
    enum Kind { case step, ok, error, plain }
    let id = UUID()
    let text: String
    var kind: Kind {
        if text.hasPrefix("▶") { return .step }
        if text.hasPrefix("✔") { return .ok }
        if text.hasPrefix("✖") || text.contains("error:") { return .error }
        return .plain
    }
}

/// A real iPhone or Vision Pro this Mac has paired with (Croo Builder never lists simulators).
struct Device: Identifiable, Hashable {
    let id: String       // UDID
    let name: String     // the name you gave it, e.g. "Jordan's iPhone"
    let model: String    // e.g. "iPhone 18 Pro"
    let platform: String // "iOS" or "visionOS"
    let reachable: Bool  // connected right now (Wi-Fi or cable)
    let via: String      // "Wi-Fi" / "Cable" / ""
    var scheme: String { platform == "visionOS" ? "CrooVision" : "App" }
    var symbol: String { platform == "visionOS" ? "visionpro" : "iphone" }
    /// What the picker shows: "Jordan's iPhone · iPhone 18 Pro · Ready (Wi-Fi)"
    var label: String {
        let modelPart = (model.isEmpty || model == name) ? "" : " · \(model)"
        let status = reachable ? "Ready\(via.isEmpty ? "" : " (\(via))")" : "Not connected"
        return "\(name)\(modelPart) · \(status)"
    }
}

@MainActor
final class Runner: ObservableObject {
    @Published var lines: [LogLine] = []
    @Published private(set) var isRunning = false
    @Published private(set) var currentTitle = ""
    @Published private(set) var lastResult: (title: String, ok: Bool)?
    @Published var devices: [Device] = []
    @Published var loadingDevices = false
    @Published var repoPath: String {
        didSet { UserDefaults.standard.set(repoPath, forKey: "repoPath") }
    }

    private var process: Process?
    private var partial = ""

    init() {
        let saved = UserDefaults.standard.string(forKey: "repoPath")
        let fromInstall = Bundle.main.object(forInfoDictionaryKey: "CrooRepoPath") as? String
        repoPath = saved ?? fromInstall ?? (NSHomeDirectory() + "/Developer/Croo-App")
    }

    var scriptsDir: String { repoPath + "/tools/croo-builder/scripts" }
    var repoLooksRight: Bool { FileManager.default.fileExists(atPath: scriptsDir + "/get-latest.sh") }

    // MARK: Running scripts

    func run(_ action: BuilderAction) {
        guard !isRunning else { return }
        guard repoLooksRight else {
            lines = [LogLine(text: "✖ Can't find the CrooHQ project at \(repoPath). Use “Change…” to pick the Croo-App folder.")]
            return
        }
        lines = [LogLine(text: "▶ \(action.title) · \(Self.timeString())")]
        isRunning = true
        currentTitle = action.title
        lastResult = nil
        partial = ""

        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/bin/bash")
        p.arguments = [scriptsDir + "/" + action.script] + action.arguments
        p.currentDirectoryURL = URL(fileURLWithPath: repoPath)
        var env = ProcessInfo.processInfo.environment
        env["CROO_BUILDER"] = "1"
        p.environment = env

        let pipe = Pipe()
        p.standardOutput = pipe
        p.standardError = pipe
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let data = handle.availableData
            guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8) else { return }
            Task { @MainActor in self?.append(chunk) }
        }
        p.terminationHandler = { [weak self] proc in
            let status = proc.terminationStatus
            Task { @MainActor in self?.finish(action, status: status) }
        }
        do {
            try p.run()
            process = p
        } catch {
            append("✖ Couldn't start: \(error.localizedDescription)\n")
            finish(action, status: 1)
        }
    }

    func stop() {
        process?.terminate()
    }

    private func append(_ chunk: String) {
        let text = partial + chunk
        var parts = text.components(separatedBy: "\n")
        partial = parts.removeLast()
        for part in parts where !part.trimmingCharacters(in: .whitespaces).isEmpty {
            lines.append(LogLine(text: part))
        }
        if lines.count > 4000 { lines.removeFirst(lines.count - 4000) }
    }

    private func finish(_ action: BuilderAction, status: Int32) {
        if !partial.isEmpty { lines.append(LogLine(text: partial)); partial = "" }
        (process?.standardOutput as? Pipe)?.fileHandleForReading.readabilityHandler = nil
        process = nil
        isRunning = false
        let ok = status == 0
        lastResult = (action.title, ok)
        if !ok && !lines.contains(where: { $0.kind == .error }) {
            lines.append(LogLine(text: "✖ \(action.title) stopped (code \(status))."))
        }
        notify(title: ok ? "\(action.title) ✓" : "\(action.title) failed",
               body: lines.last(where: { $0.kind == .ok || $0.kind == .error })?.text ?? "")
    }

    /// The useful part of the log for pasting to Claude: every error line plus the last 40 lines.
    func copyErrorReport() {
        let errors = lines.filter { $0.kind == .error }.map(\.text)
        let tail = lines.suffix(40).map(\.text)
        var report = "Croo Builder · \(currentTitle.isEmpty ? (lastResult?.title ?? "") : currentTitle) · \(Self.timeString())\n"
        if !errors.isEmpty { report += "Errors:\n" + errors.joined(separator: "\n") + "\n\n" }
        report += "Last lines:\n" + tail.joined(separator: "\n")
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
    }

    // MARK: Devices (iPhone / Vision Pro)

    func loadDevices() {
        loadingDevices = true
        let out = NSTemporaryDirectory() + "croo-devices.json"
        let p = Process()
        p.executableURL = URL(fileURLWithPath: "/usr/bin/xcrun")
        p.arguments = ["devicectl", "list", "devices", "--json-output", out]
        p.standardOutput = FileHandle.nullDevice
        p.standardError = FileHandle.nullDevice
        p.terminationHandler = { [weak self] _ in
            let found = Self.parseDevices(path: out)
            Task { @MainActor in
                self?.devices = found
                self?.loadingDevices = false
            }
        }
        do { try p.run() } catch { loadingDevices = false }
    }

    nonisolated private static func parseDevices(path: String) -> [Device] {
        guard let data = FileManager.default.contents(atPath: path),
              let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let result = root["result"] as? [String: Any],
              let list = result["devices"] as? [[String: Any]] else { return [] }
        return list.compactMap { d in
            let hw = d["hardwareProperties"] as? [String: Any] ?? [:]
            let props = d["deviceProperties"] as? [String: Any] ?? [:]
            let conn = d["connectionProperties"] as? [String: Any] ?? [:]
            guard let udid = hw["udid"] as? String, let raw = hw["platform"] as? String else { return nil }
            // Real devices only: skip anything that reports itself as a simulator.
            if (hw["reality"] as? String)?.lowercased() == "virtual" { return nil }
            let platform: String
            switch raw.lowercased() {
            case "ios": platform = "iOS"
            case "visionos", "xros": platform = "visionOS"
            default: return nil // watch, Mac, TV: not runnable from here
            }
            let model = hw["marketingName"] as? String ?? (hw["productType"] as? String ?? "")
            let name = props["name"] as? String ?? (model.isEmpty ? platform : model)
            let tunnel = (conn["tunnelState"] as? String ?? "").lowercased()
            let transport = (conn["transportType"] as? String ?? "").lowercased()
            let reachable = tunnel == "connected" || transport == "wired" || transport == "localnetwork"
            let via = transport == "wired" ? "Cable" : (transport == "localnetwork" || transport == "network" ? "Wi-Fi" : "")
            return Device(id: udid, name: name, model: model, platform: platform, reachable: reachable, via: via)
        }
        .sorted { ($0.reachable ? 0 : 1, $0.name) < ($1.reachable ? 0 : 1, $1.name) }
    }

    // MARK: Helpers

    func openXcode() {
        let ws = URL(fileURLWithPath: repoPath + "/ios/App/App.xcworkspace")
        NSWorkspace.shared.open(ws)
    }

    func openInTerminal() {
        let url = URL(fileURLWithPath: repoPath)
        NSWorkspace.shared.open([url], withApplicationAt: URL(fileURLWithPath: "/System/Applications/Utilities/Terminal.app"),
                                configuration: NSWorkspace.OpenConfiguration())
    }

    func requestNotifications() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound]) { _, _ in }
    }

    private func notify(title: String, body: String) {
        let c = UNMutableNotificationContent()
        c.title = title
        c.body = body
        c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: UUID().uuidString, content: c, trigger: nil))
    }

    static func timeString() -> String {
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: Date())
    }
}
