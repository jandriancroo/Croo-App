import SwiftUI

// Lenient mirrors of the watch-device-service snapshot (same shapes the Vision Pro app reads).
// Every field is optional so a missing value never breaks the screen.

struct TVLocation: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct TVPeriod: Codable, Hashable {
    var label: String?
    var salesValue: Double?
    var goalValue: Double?
    var paceValue: Double?
    var laborPercentValue: Double?
    var laborGoalPct: Double?
    var lastYear: String?
    var guests: String?
    var ticket: String?
}

struct TVSalesSummary: Codable, Hashable {
    var today: TVPeriod?
    var week: TVPeriod?
    var month: TVPeriod?
}

struct TVSchedSummary: Codable, Hashable {
    var onNow: Int?
    var later: Int?
    var nowMin: Double?
}

struct TVShift: Codable, Hashable {
    var name: String?
    var role: String?
    var time: String?
    var status: String?
    var startMin: Double?
    var endMin: Double?
    var color: String?
}

struct TVHourly: Codable, Hashable {
    var hour: Int?
    var sales: Double?
    var projected: Double?
    var laborPercent: Double?
}

struct TVPace: Codable {
    var salesPace: Double?
    var paceLaborPct: Double?
    var targetLaborPct: Double?
    var status: String?   // "ahead" / "on_track" / "behind"
}

struct TVSnapshot: Codable {
    var updatedAt: String?
    var locationId: String?
    var locationName: String?
    var salesSummary: TVSalesSummary?
    var scheduleSummary: TVSchedSummary?
    var schedule: [TVShift]?
    var hourlyToday: [TVHourly]?
    var locations: [TVLocation]?
    var laborPace: TVPace?
}

struct TVEnvelope: Codable {
    var snapshot: TVSnapshot?
    var error: String?
}

// MARK: - Look (matches the approved mock-up)

enum TVColor {
    static let bg = Color(red: 0.043, green: 0.051, blue: 0.063)          // #0B0D10
    static let card = Color(red: 0.078, green: 0.094, blue: 0.114)        // #14181D
    static let border = Color(red: 0.122, green: 0.145, blue: 0.173)      // #1F252C
    static let grid = Color(red: 0.141, green: 0.169, blue: 0.200)        // #242B33
    static let bar = Color(red: 0.227, green: 0.267, blue: 0.306)         // #3A444E
    static let text = Color(red: 0.953, green: 0.945, blue: 0.925)        // #F3F1EC
    static let muted = Color(red: 0.545, green: 0.584, blue: 0.631)       // #8B95A1
    static let soft = Color(red: 0.788, green: 0.816, blue: 0.847)        // #C9D0D8
    static let teal = Color(red: 0.184, green: 0.702, blue: 0.769)        // #2FB3C4
    static let tealDeep = Color(red: 0.039, green: 0.478, blue: 0.541)    // #0A7A8A
    static let orange = Color(red: 0.961, green: 0.510, blue: 0.125)      // #F58220
    static let cream = Color(red: 0.965, green: 0.906, blue: 0.824)       // #F6E7D2
    static let creamSoft = Color(red: 0.886, green: 0.804, blue: 0.690)   // #E2CDB0
}

// MARK: - Formatting

enum TVFormat {
    static func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.maximumFractionDigits = 0
        f.currencyCode = "USD"
        return f.string(from: NSNumber(value: v)) ?? "—"
    }

    static func percent(_ v: Double?) -> String {
        guard let v else { return "—" }
        return String(format: "%.1f%%", v)
    }

    /// Axis label: $800, $1.2K
    static func axisMoney(_ v: Double) -> String {
        if v >= 1000 { return String(format: "$%.1fK", v / 1000) }
        return String(format: "$%.0f", v)
    }

    /// Minutes since midnight -> "2:30p".
    static func clock(_ m: Double) -> String {
        let total = Int(m.rounded())
        var h = (total / 60) % 24
        let min = total % 60
        let suffix = h < 12 ? "a" : "p"
        h = h % 12 == 0 ? 12 : h % 12
        return min == 0 ? "\(h)\(suffix)" : String(format: "%d:%02d%@", h, min, suffix)
    }

    /// Hour number -> "3p"
    static func hourLabel(_ h: Int) -> String {
        let suffix = (h % 24) < 12 ? "a" : "p"
        let n = h % 12 == 0 ? 12 : h % 12
        return "\(n)\(suffix)"
    }
}

extension TVShift {
    var displayName: String { (name ?? "").isEmpty ? "Team member" : (name ?? "") }
    var isOn: Bool { status == "active" || status == "break" }
}

extension TVPeriod {
    var progress: Double {
        guard let s = salesValue, let g = goalValue, g > 0 else { return 0 }
        return min(max(s / g, 0), 1)
    }
    var laborGoalText: String? {
        guard let g = laborGoalPct, g > 0 else { return nil }
        return g.rounded() == g ? "Goal \(Int(g))%" : String(format: "Goal %.1f%%", g)
    }
    /// "1.4 pts under" / "0.8 pts over"
    var laborGapText: String? {
        guard let l = laborPercentValue, let g = laborGoalPct, g > 0 else { return nil }
        let d = abs(l - g)
        return String(format: "%.1f pts %@", d, l <= g ? "under" : "over")
    }
}

extension TVSnapshot {
    var shifts: [TVShift] { schedule ?? [] }
    var onNow: [TVShift] { shifts.filter { $0.isOn } }
    var nowMin: Double {
        if let n = scheduleSummary?.nowMin { return n }
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }
    /// Hours that have a projection or sales, in order.
    var hourly: [TVHourly] {
        (hourlyToday ?? [])
            .filter { ($0.hour ?? -1) >= 0 && (($0.projected ?? 0) > 0 || ($0.sales ?? 0) > 0) }
            .sorted { ($0.hour ?? 0) < ($1.hour ?? 0) }
    }
    /// The next person starting after now.
    var nextIn: TVShift? {
        shifts.filter { !$0.isOn && ($0.startMin ?? 0) > nowMin }
            .sorted { ($0.startMin ?? 0) < ($1.startMin ?? 0) }.first
    }
    var updatedLabel: String {
        guard let s = updatedAt else { return "" }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return "" }
        let f = DateFormatter()
        f.dateFormat = "h:mm a"
        return f.string(from: d)
    }
    var paceChip: (text: String, good: Bool)? {
        switch laborPace?.status {
        case "ahead": return ("Ahead of pace", true)
        case "on_track": return ("On pace", true)
        case "behind": return ("Behind pace", false)
        default: return nil
        }
    }
}
