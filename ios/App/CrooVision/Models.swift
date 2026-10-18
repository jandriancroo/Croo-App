import SwiftUI

// Lenient mirrors of the watch-device-service snapshot. Every field is optional.

struct VLocation: Codable, Hashable, Identifiable {
    let id: String
    let name: String
}

struct VPeriod: Codable, Hashable {
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

struct VSalesSummary: Codable, Hashable {
    var today: VPeriod?
    var week: VPeriod?
    var month: VPeriod?
}

struct VSchedSummary: Codable, Hashable {
    var onNow: Int?
    var later: Int?
    var nowMin: Double?
}

struct VShift: Codable, Hashable {
    var name: String?
    var role: String?
    var time: String?
    var status: String?
    var startMin: Double?
    var endMin: Double?
    var color: String?
}

struct VEvent: Codable, Hashable {
    var id: String?
    var title: String?
    var timeLabel: String?
    var startMin: Double?
    var endMin: Double?
    var category: String?
    var color: String?
}

struct VSnapshot: Codable {
    var updatedAt: String?
    var locationId: String?
    var locationName: String?
    var salesSummary: VSalesSummary?
    var scheduleSummary: VSchedSummary?
    var schedule: [VShift]?
    var scheduleEvents: [VEvent]?
    var locations: [VLocation]?
}

struct VEnvelope: Codable {
    var snapshot: VSnapshot?
    var error: String?
}

// MARK: - Brand

enum VColor {
    static let orange = Color(red: 0.922, green: 0.490, blue: 0.235)   // #EB7D3C
    static let teal = Color(red: 0.310, green: 0.702, blue: 0.784)     // #4FB3C8
    static let green = Color(red: 0.204, green: 0.780, blue: 0.349)    // #34C759
    static let red = Color(red: 1.0, green: 0.271, blue: 0.227)        // #FF453A
    static let slate = Color(red: 0.490, green: 0.561, blue: 0.639)    // #7D8FA3

    static func from(hex: String?, fallback: Color) -> Color {
        guard var h = hex?.trimmingCharacters(in: .whitespaces), !h.isEmpty else { return fallback }
        if h.hasPrefix("#") { h.removeFirst() }
        guard h.count == 6, let v = UInt64(h, radix: 16) else { return fallback }
        return Color(red: Double((v >> 16) & 0xFF) / 255, green: Double((v >> 8) & 0xFF) / 255, blue: Double(v & 0xFF) / 255)
    }
}

// MARK: - Formatting + derived values

enum VFormat {
    static func money(_ v: Double?) -> String {
        guard let v else { return "—" }
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.maximumFractionDigits = 0
        f.currencyCode = "USD"
        return f.string(from: NSNumber(value: v)) ?? "—"
    }

    static func short(_ v: Double?) -> String {
        guard let v else { return "—" }
        if v >= 1000 { return String(format: "$%.1fK", v / 1000) }
        return String(format: "$%.0f", v)
    }

    static func percent(_ v: Double?) -> String {
        guard let v else { return "—" }
        return String(format: "%.1f%%", v)
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
}

extension VPeriod {
    var progress: Double {
        guard let s = salesValue, let g = goalValue, g > 0 else { return 0 }
        return min(max(s / g, 0), 1)
    }
    var percentOfGoal: String {
        guard let s = salesValue, let g = goalValue, g > 0 else { return "—" }
        return "\(Int((s / g * 100).rounded()))%"
    }
    /// Green under goal, red over, teal when the store has no labor goal.
    var laborColor: Color {
        guard let l = laborPercentValue, let g = laborGoalPct, g > 0 else { return VColor.teal }
        return l <= g ? VColor.green : VColor.red
    }
    var laborGoalText: String? {
        guard let g = laborGoalPct, g > 0 else { return nil }
        return g.rounded() == g ? "goal \(Int(g))%" : String(format: "goal %.1f%%", g)
    }
}

extension VShift {
    var displayName: String { (name ?? "").isEmpty ? "Team member" : (name ?? "") }
    var tint: Color { VColor.from(hex: color, fallback: VColor.teal) }
    var isOn: Bool { status == "active" || status == "break" }
}

extension VEvent {
    var displayTitle: String { (title ?? "").isEmpty ? "Event" : (title ?? "") }
    var tint: Color { VColor.from(hex: color, fallback: VColor.teal) }
}

extension VSnapshot {
    var shifts: [VShift] { schedule ?? [] }
    var events: [VEvent] { scheduleEvents ?? [] }
    var nowMin: Double {
        if let n = scheduleSummary?.nowMin { return n }
        let c = Calendar.current.dateComponents([.hour, .minute], from: Date())
        return Double((c.hour ?? 0) * 60 + (c.minute ?? 0))
    }
    var onNow: [VShift] { shifts.filter { $0.isOn } }
    var nextEventId: String? { events.first { ($0.startMin ?? 0) >= nowMin }?.id }
    var updatedLabel: String {
        guard let s = updatedAt else { return "" }
        let iso = ISO8601DateFormatter()
        iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = iso.date(from: s) ?? ISO8601DateFormatter().date(from: s) else { return "" }
        let f = DateFormatter()
        f.dateFormat = "h:mma"
        return f.string(from: d).lowercased().replacingOccurrences(of: "m", with: "")
    }
}
