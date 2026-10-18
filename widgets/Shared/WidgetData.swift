import Foundation
import SwiftUI
import WidgetKit

// Shared by the iPhone widget extension (CrooWidgets) and the watch complication
// extension (CrooWatchWidgets). READ-ONLY: widgets only call the same
// watch-device-service `snapshot` action the watch app uses. They never write business data.

// MARK: - Shared storage (App Group)

enum CrooShared {
    static let groupId = "group.com.croohq.kitchenmate"
    static let pairingKey = "croo.shared.pairing"
    static let locationsKey = "croo.shared.locations"
    static let defaultApiUrl = "https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/watch-device-service"

    static var defaults: UserDefaults { UserDefaults(suiteName: groupId) ?? UserDefaults.standard }
    static func snapshotKey(_ locationId: String) -> String { "croo.shared.snapshot." + locationId }
}

struct SharedLocation: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct SharedPairing {
    let token: String
    let locationId: String
    let locationName: String
    let apiUrl: String
}

// MARK: - Snapshot models (lenient: every field optional, only what widgets need)

struct WPeriod: Codable, Hashable {
    var salesValue: Double?
    var goalValue: Double?
    var paceValue: Double?
    var laborPercentValue: Double?
    var laborGoalPct: Double?
    var laborPercent: String?
}

struct WSalesSummary: Codable, Hashable {
    var today: WPeriod?
}

struct WSchedSummary: Codable, Hashable {
    var onNow: Int?
    var later: Int?
    var nowMin: Double?
}

struct WShift: Codable, Hashable {
    var name: String?
    var role: String?
    var time: String?
    var status: String?
    var startMin: Double?
    var endMin: Double?
    var color: String?
}

/// One event from today's schedule (meetings, deliveries, anything on the schedule page).
struct WEvent: Codable, Hashable {
    var id: String?
    var title: String?
    var timeLabel: String?
    var startMin: Double?
    var endMin: Double?
    var category: String?
    var color: String?
}

struct WSnapshot: Codable {
    var updatedAt: String?
    var locationId: String?
    var locationName: String?
    var salesSummary: WSalesSummary?
    var scheduleSummary: WSchedSummary?
    var schedule: [WShift]?
    var locations: [SharedLocation]?
    var scheduleEvents: [WEvent]?
}

private struct WEnvelope: Codable {
    var snapshot: WSnapshot?
    var error: String?
}

// MARK: - Derived values

enum LaborState { case under, over, unknown }

extension WSnapshot {
    var today: WPeriod? { salesSummary?.today }
    var shifts: [WShift] { schedule ?? [] }
    var name: String { (locationName ?? "").isEmpty ? "CrooHQ" : (locationName ?? "CrooHQ") }
    var shortName: String {
        // "Blaze Pizza - Hemet" -> "Hemet"; otherwise the full name.
        let n = name
        for sep in [" - ", " – ", " | "] {
            if let r = n.range(of: sep, options: .backwards) { return String(n[r.upperBound...]) }
        }
        return n
    }

    /// Short label for small spots: "Palm Springs" -> "P. Springs"; names up to 10 characters stay as they are.
    var compactName: String {
        let s = shortName
        let custom = ["georgetown": "G.Town", "tuscaloosa": "Tusc."]
        if let c = custom[s.lowercased()] { return c }
        if s.count <= 10 { return s }
        let words = s.split(separator: " ").map(String.init)
        if words.count >= 2, (words.last?.count ?? 0) > 3, let first = words.first?.first {
            return "\(first). " + words.dropFirst().joined(separator: " ")
        }
        return s
    }

    var sales: Double? { today?.salesValue }
    var goal: Double? { today?.goalValue }
    var salesProgress: Double {
        guard let s = sales, let g = goal, g > 0 else { return 0 }
        return min(max(s / g, 0), 1)
    }
    var salesPercentText: String {
        guard let s = sales, let g = goal, g > 0 else { return "—" }
        return "\(Int((s / g * 100).rounded()))%"
    }
    var paceProgress: Double {
        guard let p = today?.paceValue, let g = goal, g > 0 else { return 0 }
        return min(max(p / g, 0), 1)
    }
    var labor: Double? { today?.laborPercentValue }
    var laborText: String {
        guard let l = labor else { return "—" }
        return String(format: "%.1f%%", l)
    }
    /// "goal 25" when the store has a labor goal; nil otherwise (never guessed).
    var laborGoalText: String? {
        guard let g = today?.laborGoalPct, g > 0 else { return nil }
        let t = g.rounded() == g ? String(Int(g)) : String(format: "%.1f", g)
        return "goal \(t)"
    }
    var laborState: LaborState {
        guard let l = labor, let g = today?.laborGoalPct, g > 0 else { return .unknown }
        return l <= g ? .under : .over
    }
    /// Green under goal, red over goal. No goal set for the store = neutral teal (never guessed).
    var laborColor: Color {
        switch laborState {
        case .under: return WColor.green
        case .over: return WColor.red
        case .unknown: return WColor.tealBright
        }
    }
    var onNowCount: Int {
        if let n = scheduleSummary?.onNow { return n }
        return shifts.filter { $0.status == "active" || $0.status == "break" }.count
    }
    var activeShifts: [WShift] { shifts.filter { $0.status == "active" || $0.status == "break" } }
    var nextShift: WShift? {
        let later = shifts.filter { ($0.status ?? "later") == "later" }
        let now = scheduleSummary?.nowMin ?? -1
        let upcoming = later.filter { ($0.startMin ?? 0) >= now }.sorted { ($0.startMin ?? 0) < ($1.startMin ?? 0) }
        return upcoming.first ?? later.first
    }
    var updatedLabel: String {
        guard let iso = updatedAt, !iso.isEmpty else { return "" }
        let f1 = ISO8601DateFormatter()
        f1.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let f2 = ISO8601DateFormatter()
        guard let d = f1.date(from: iso) ?? f2.date(from: iso) else { return "" }
        let out = DateFormatter()
        out.dateFormat = "h:mma"
        out.amSymbol = "a"
        out.pmSymbol = "p"
        return out.string(from: d)
    }
}

extension WEvent {
    var displayTitle: String { (title ?? "").isEmpty ? "Event" : (title ?? "") }
    var tint: Color { WColor.from(hex: color, fallback: WColor.tealBright) }
}

extension WSnapshot {
    var events: [WEvent] { scheduleEvents ?? [] }
    /// Events that haven't started yet (or have no time), in order; the first is "next up".
    var upcomingEvents: [WEvent] {
        let now = scheduleSummary?.nowMin ?? 0
        return events.filter { ($0.startMin ?? 0) >= now }
    }
    var nextEvent: WEvent? { upcomingEvents.first }
}

extension WShift {
    var displayName: String { (name ?? "").isEmpty ? "Open shift" : (name ?? "") }
    var firstName: String { displayName.split(separator: " ").first.map(String.init) ?? displayName }
    var startLabel: String {
        let parts = (time ?? "").components(separatedBy: CharacterSet(charactersIn: "-–"))
        return (parts.first ?? "").trimmingCharacters(in: .whitespaces)
    }
    var rangeLabel: String { (time ?? "").replacingOccurrences(of: "-", with: "–") }
    var tint: Color { WColor.from(hex: color, fallback: WColor.slate) }
}

// MARK: - Formatting

enum WFormat {
    /// $4.8K style for tight spaces.
    static func short(_ v: Double?) -> String {
        guard let v else { return "—" }
        let a = abs(v)
        if a >= 1_000_000 { return String(format: "$%.1fM", v / 1_000_000) }
        if a >= 10_000 { return String(format: "$%.0fK", v / 1000) }
        if a >= 1000 { return String(format: "$%.1fK", v / 1000) }
        return String(format: "$%.0f", v)
    }

    /// $4,820
    static func full(_ v: Double?) -> String {
        guard let v else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .decimal
        f.maximumFractionDigits = 0
        f.locale = Locale(identifier: "en_US")
        return "$" + (f.string(from: NSNumber(value: v.rounded())) ?? "0")
    }
}

// MARK: - Brand colors (same tokens as the watch app)

enum WColor {
    static let orange = Color(red: 0.922, green: 0.490, blue: 0.235)       // #EB7D3C
    static let tealBright = Color(red: 0.310, green: 0.702, blue: 0.784)   // #4FB3C8
    static let tealDeep = Color(red: 0.086, green: 0.204, blue: 0.231)     // #16343B
    static let green = Color(red: 0.204, green: 0.780, blue: 0.349)        // #34C759
    static let red = Color(red: 1.0, green: 0.271, blue: 0.227)            // #FF453A
    static let slate = Color(red: 0.490, green: 0.561, blue: 0.639)        // #7D8FA3
    static let muted = Color(white: 0.62)
    static let trackOrange = Color(red: 0.23, green: 0.16, blue: 0.11)

    static func from(hex: String?, fallback: Color) -> Color {
        guard var h = hex?.trimmingCharacters(in: .whitespaces), !h.isEmpty else { return fallback }
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let n = UInt32(h, radix: 16) else { return fallback }
        return Color(
            red: Double((n >> 16) & 0xFF) / 255,
            green: Double((n >> 8) & 0xFF) / 255,
            blue: Double(n & 0xFF) / 255
        )
    }
}

// MARK: - Store: pairing, locations, cache, fetch

enum CrooStore {
    static func pairing() -> SharedPairing? {
        guard let d = CrooShared.defaults.dictionary(forKey: CrooShared.pairingKey) as? [String: String],
              let token = d["token"], !token.isEmpty,
              let locationId = d["locationId"], !locationId.isEmpty else { return nil }
        let api = (d["apiUrl"] ?? "").isEmpty ? CrooShared.defaultApiUrl : (d["apiUrl"] ?? CrooShared.defaultApiUrl)
        return SharedPairing(token: token, locationId: locationId, locationName: d["locationName"] ?? "", apiUrl: api)
    }

    static func locations() -> [SharedLocation] {
        if let json = CrooShared.defaults.string(forKey: CrooShared.locationsKey),
           let data = json.data(using: .utf8),
           let list = try? JSONDecoder().decode([SharedLocation].self, from: data), !list.isEmpty {
            return list
        }
        if let p = pairing() {
            return [SharedLocation(id: p.locationId, name: p.locationName.isEmpty ? "My store" : p.locationName)]
        }
        return []
    }

    static func saveLocations(_ list: [SharedLocation]) {
        guard !list.isEmpty,
              let data = try? JSONEncoder().encode(list),
              let json = String(data: data, encoding: .utf8) else { return }
        CrooShared.defaults.set(json, forKey: CrooShared.locationsKey)
    }

    static func cached(locationId: String) -> WSnapshot? {
        guard let json = CrooShared.defaults.string(forKey: CrooShared.snapshotKey(locationId)),
              let data = json.data(using: .utf8) else { return nil }
        return try? JSONDecoder().decode(WSnapshot.self, from: data)
    }

    /// Fresh snapshot for a location (nil = the paired default). Falls back to the last cached copy.
    static func load(locationId: String?) async -> WSnapshot? {
        guard let pairing = pairing() else { return nil }
        let target = (locationId ?? "").isEmpty ? pairing.locationId : (locationId ?? pairing.locationId)
        if let fresh = await fetch(pairing: pairing, locationId: target) {
            return fresh
        }
        return cached(locationId: target)
    }

    private static func fetch(pairing: SharedPairing, locationId: String) async -> WSnapshot? {
        guard let url = URL(string: pairing.apiUrl) else { return nil }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.timeoutInterval = 15
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue(pairing.token, forHTTPHeaderField: "x-watch-token")
        let body: [String: Any] = ["action": "snapshot", "locationId": locationId]
        guard let payload = try? JSONSerialization.data(withJSONObject: body) else { return nil }
        request.httpBody = payload
        do {
            let (data, response) = try await URLSession.shared.data(for: request)
            if let http = response as? HTTPURLResponse, http.statusCode != 200 { return nil }
            let envelope = try JSONDecoder().decode(WEnvelope.self, from: data)
            guard let snap = envelope.snapshot else { return nil }
            if let list = snap.locations, !list.isEmpty { saveLocations(list) }
            if let out = try? JSONEncoder().encode(snap), let json = String(data: out, encoding: .utf8) {
                CrooShared.defaults.set(json, forKey: CrooShared.snapshotKey(locationId))
            }
            return snap
        } catch {
            return nil
        }
    }
}

// MARK: - Timeline entry + sample data

struct CrooEntry: TimelineEntry {
    let date: Date
    let snapshot: WSnapshot?
    let paired: Bool
}

extension CrooEntry {
    static var sample: CrooEntry {
        let shifts: [WShift] = [
            WShift(name: "Alex R", role: "Shift Lead", time: "6:00a - 2:00p", status: "active", startMin: 360, endMin: 840, color: "#EB7D3C"),
            WShift(name: "Dani K", role: "Cook", time: "8:00a - 4:00p", status: "active", startMin: 480, endMin: 960, color: "#4FB3C8"),
            WShift(name: "Sam T", role: "Cashier", time: "9:00a - 3:00p", status: "active", startMin: 540, endMin: 900, color: "#7D8FA3"),
            WShift(name: "Maria L", role: "Cashier", time: "2:00p - 8:00p", status: "later", startMin: 840, endMin: 1200, color: "#7D8FA3")
        ]
        let period = WPeriod(salesValue: 4820, goalValue: 6500, paceValue: 5100,
                             laborPercentValue: 22.4, laborGoalPct: 25, laborPercent: "22.4%")
        let snap = WSnapshot(updatedAt: nil, locationId: "sample", locationName: "Blaze Pizza - Hemet",
                             salesSummary: WSalesSummary(today: period),
                             scheduleSummary: WSchedSummary(onNow: 6, later: 2, nowMin: 640),
                             schedule: shifts, locations: nil,
                             scheduleEvents: [
                                WEvent(id: "e1", title: "Food delivery", timeLabel: "9a", startMin: 540, endMin: nil, category: "Delivery", color: "#4FB3C8"),
                                WEvent(id: "e2", title: "Team huddle", timeLabel: "11a", startMin: 660, endMin: nil, category: "Meeting", color: "#EB7D3C"),
                                WEvent(id: "e3", title: "Health inspection", timeLabel: "2p", startMin: 840, endMin: nil, category: "Visit", color: "#FF453A"),
                                WEvent(id: "e4", title: "Truck count", timeLabel: "4:30p", startMin: 990, endMin: nil, category: "Inventory", color: "#34C759")
                             ])
        return CrooEntry(date: Date(), snapshot: snap, paired: true)
    }
}
