import AppIntents
import Foundation
import UIKit

// Siri and Shortcuts for CrooHQ. Always spelled CrooHQ; only Info.plist's spoken name (CFBundleSpokenName) is written phonetically so Siri says it right.
//  • Sales / Labor / Who's on / Next event: read straight from the same read-only feed as the widgets
//    (watch-device-service snapshot, device token in the App Group). No AI, no Grok.
//  • Ask Theo: one question to ai-assistant (Theo's brain) as the signed-in person; Siri reads the answer.
//  • Talk to Theo: a background Theo call in the Dynamic Island (Action Button / Siri / Control Center).
// Answers only: Theo actions stay on the in-app wizard.

// MARK: - Store picker ("…at Hemet")

@available(iOS 18.0, *)
struct StoreEntity: AppEntity {
    static var typeDisplayRepresentation: TypeDisplayRepresentation = "Store"
    static var defaultQuery = StoreQuery()
    var id: String
    var name: String
    var displayRepresentation: DisplayRepresentation { DisplayRepresentation(title: "\(name)") }
}

@available(iOS 18.0, *)
struct StoreQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [StoreEntity] {
        CrooSharedGroup.locations().filter { identifiers.contains($0.id) }.map { StoreEntity(id: $0.id, name: $0.name) }
    }
    func suggestedEntities() async throws -> [StoreEntity] {
        CrooSharedGroup.locations().map { StoreEntity(id: $0.id, name: $0.name) }
    }
}

// MARK: - Store numbers (no AI)

enum SiriData {
    struct Period: Decodable {
        var salesValue: Double?
        var goalValue: Double?
        var paceValue: Double?
        var laborPercentValue: Double?
        var laborGoalPct: Double?
    }
    struct Summary: Decodable { var today: Period? }
    struct Sched: Decodable { var onNow: Int?; var later: Int?; var nowMin: Double? }
    struct Shift: Decodable { var name: String?; var status: String?; var startMin: Double? }
    struct Event: Decodable { var title: String?; var startMin: Double? }
    struct Snap: Decodable {
        var locationName: String?
        var salesSummary: Summary?
        var scheduleSummary: Sched?
        var schedule: [Shift]?
        var scheduleEvents: [Event]?
    }
    private struct Envelope: Decodable { var snapshot: Snap?; var error: String? }

    enum Failure: Error { case notConnected, unreachable }

    static func snapshot(storeId: String?) async throws -> Snap {
        guard let p = CrooSharedGroup.pairing(), let token = p["token"], !token.isEmpty else { throw Failure.notConnected }
        let api = (p["apiUrl"] ?? "").isEmpty ? NativeAuth.deviceServiceURL : (p["apiUrl"] ?? NativeAuth.deviceServiceURL)
        guard let url = URL(string: api) else { throw Failure.unreachable }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 12
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(token, forHTTPHeaderField: "x-watch-token")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["action": "snapshot", "locationId": storeId ?? p["locationId"] ?? ""])
        let (data, _) = try await URLSession.shared.data(for: req)
        guard let snap = try JSONDecoder().decode(Envelope.self, from: data).snapshot else { throw Failure.unreachable }
        return snap
    }

    static func money(_ v: Double) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.currencyCode = "USD"
        f.maximumFractionDigits = 0
        return f.string(from: NSNumber(value: v)) ?? "$\(Int(v))"
    }

    static func pct(_ v: Double) -> String {
        v.rounded() == v ? "\(Int(v)) percent" : String(format: "%.1f percent", v)
    }

    /// Minutes since midnight -> "2 PM" / "2:30 PM" (reads naturally out loud).
    static func clock(_ m: Double) -> String {
        let t = Int(m.rounded())
        var h = (t / 60) % 24
        let min = t % 60
        let ap = h < 12 ? "AM" : "PM"
        h = h % 12 == 0 ? 12 : h % 12
        return min == 0 ? "\(h) \(ap)" : String(format: "%d:%02d %@", h, min, ap)
    }

    static func firstName(_ n: String?) -> String {
        String((n ?? "").split(separator: " ").first ?? "Someone")
    }

    static let notConnectedLine = "Open CrooHQ once and sign in, then ask me again."
    static let unreachableLine = "I couldn't reach CrooHQ just now. Try again in a minute."
}

@available(iOS 18.0, *)
private func storeAnswer(_ store: StoreEntity?, _ build: (SiriData.Snap, String) -> String) async -> String {
    do {
        let snap = try await SiriData.snapshot(storeId: store?.id)
        let name = snap.locationName ?? store?.name ?? "your store"
        return build(snap, name)
    } catch SiriData.Failure.notConnected {
        return SiriData.notConnectedLine
    } catch {
        return SiriData.unreachableLine
    }
}

@available(iOS 18.0, *)
struct SalesTodayIntent: AppIntent {
    static var title: LocalizedStringResource = "Sales today"
    static var description = IntentDescription("Today's sales, goal and pace for a store.")
    @Parameter(title: "Store") var store: StoreEntity?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = await storeAnswer(store) { snap, name in
            guard let t = snap.salesSummary?.today, let s = t.salesValue else { return "No sales yet today at \(name)." }
            var out = "\(name) is at \(SiriData.money(s))"
            if let g = t.goalValue, g > 0 {
                out += ", \(Int((s / g * 100).rounded())) percent of the \(SiriData.money(g)) goal"
            }
            out += "."
            if let p = t.paceValue, p > 0 { out += " Pace is \(SiriData.money(p))." }
            return out
        }
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

@available(iOS 18.0, *)
struct LaborIntent: AppIntent {
    static var title: LocalizedStringResource = "Labor"
    static var description = IntentDescription("Today's labor percent against the store's goal.")
    @Parameter(title: "Store") var store: StoreEntity?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = await storeAnswer(store) { snap, name in
            guard let l = snap.salesSummary?.today?.laborPercentValue else { return "No labor number yet today at \(name)." }
            var out = "Labor at \(name) is \(SiriData.pct(l))"
            if let g = snap.salesSummary?.today?.laborGoalPct, g > 0 {
                out += l <= g ? ", under the \(SiriData.pct(g)) goal." : ", over the \(SiriData.pct(g)) goal."
            } else {
                out += "."
            }
            return out
        }
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

@available(iOS 18.0, *)
struct WhosOnIntent: AppIntent {
    static var title: LocalizedStringResource = "Who's on"
    static var description = IntentDescription("Who is clocked in right now, and who starts next.")
    @Parameter(title: "Store") var store: StoreEntity?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = await storeAnswer(store) { snap, name in
            let shifts = snap.schedule ?? []
            let on = shifts.filter { $0.status == "active" || $0.status == "break" }
            var out: String
            if on.isEmpty {
                out = "Nobody is clocked in at \(name) right now."
            } else {
                let names = on.prefix(5).map { SiriData.firstName($0.name) }
                let extra = on.count > 5 ? " and \(on.count - 5) more" : ""
                out = "\(on.count) on the clock at \(name): " + ListFormatter.localizedString(byJoining: names) + extra + "."
            }
            let now = snap.scheduleSummary?.nowMin ?? 0
            if let next = shifts.filter({ ($0.startMin ?? -1) > now && $0.status != "active" && $0.status != "break" })
                .min(by: { ($0.startMin ?? 0) < ($1.startMin ?? 0) }), let start = next.startMin {
                out += " Next in: \(SiriData.firstName(next.name)) at \(SiriData.clock(start))."
            }
            return out
        }
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

@available(iOS 18.0, *)
struct NextEventIntent: AppIntent {
    static var title: LocalizedStringResource = "Next event"
    static var description = IntentDescription("The next event on today's schedule.")
    @Parameter(title: "Store") var store: StoreEntity?

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let line = await storeAnswer(store) { snap, name in
            let now = snap.scheduleSummary?.nowMin ?? 0
            let upcoming = (snap.scheduleEvents ?? []).filter { ($0.startMin ?? 0) >= now }
            guard let e = upcoming.first else { return "No more events today at \(name)." }
            var out = "Next at \(name): \(e.title ?? "an event")"
            if let s = e.startMin { out += " at \(SiriData.clock(s))" }
            out += "."
            if upcoming.count > 1, let after = upcoming.dropFirst().first {
                out += " Then \(after.title ?? "another event")" + (after.startMin.map { " at \(SiriData.clock($0))" } ?? "") + "."
            }
            return out
        }
        return .result(dialog: IntentDialog(stringLiteral: line))
    }
}

// MARK: - Ask Theo (Luna brain, no Grok)

@available(iOS 18.0, *)
struct AskTheoIntent: AppIntent {
    static var title: LocalizedStringResource = "Ask Theo"
    static var description = IntentDescription("Ask Theo anything about your store.")

    // Optional on purpose: when it's empty (Action Button, Shortcuts, "ask CrooHQ"), we ask for it
    // explicitly below, which works everywhere, including from the Action Button.
    @Parameter(title: "Question", requestValueDialog: IntentDialog("What do you want to know?"))
    var question: String?

    @Parameter(title: "Store") var store: StoreEntity?

    static var parameterSummary: some ParameterSummary {
        Summary("Ask Theo \(\.$question)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        guard let q = question?.trimmingCharacters(in: .whitespacesAndNewlines), !q.isEmpty else {
            throw $question.needsValueError(IntentDialog("What do you want to know?"))
        }
        let answer = await Self.ask(q, store: store)
        return .result(dialog: IntentDialog(stringLiteral: answer))
    }

    static func ask(_ question: String, store: StoreEntity?) async -> String {
        let token: String
        do { token = try await NativeAuth.validAccessToken() } catch { return SiriData.notConnectedLine }
        let stores = CrooSharedGroup.locations()
        let storeId = store?.id ?? CrooSharedGroup.pairing()?["locationId"] ?? stores.first?.id
        let storeName = store?.name ?? stores.first(where: { $0.id == storeId })?.name ?? ""
        guard let sid = storeId, let url = URL(string: NativeAuth.supabaseURL + "/functions/v1/ai-assistant") else {
            return SiriData.notConnectedLine
        }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 25
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(NativeAuth.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("eu-west-2", forHTTPHeaderField: "x-region") // same region the web app uses
        let suffix = "\n\n(Siri: answer in one to three short spoken sentences. Round numbers, no lists, no tables, no markdown.)"
        let body: [String: Any] = [
            "messages": [["role": "user", "content": question + suffix]],
            "location_id": sid,
            "location_name": storeName,
            "source": "voice",
        ]
        req.httpBody = try? JSONSerialization.data(withJSONObject: body)
        guard let (data, _) = try? await URLSession.shared.data(for: req),
              let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let content = obj["content"] as? String, !content.isEmpty else {
            return "Theo couldn't reach the store data right now."
        }
        return speakable(content)
    }

    /// Strips markdown and trims to what Siri can comfortably read.
    static func speakable(_ s: String) -> String {
        var t = s.replacingOccurrences(of: "**", with: "")
            .replacingOccurrences(of: "#", with: "")
            .replacingOccurrences(of: "\n- ", with: "\n")
            .replacingOccurrences(of: "\n* ", with: "\n")
        t = t.split(separator: "\n").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }.joined(separator: " ")
        if t.count > 600 {
            let cut = t.prefix(600)
            if let end = cut.lastIndex(of: ".") { t = String(cut[...end]) } else { t = String(cut) + "…" }
            t += " There's more in the app."
        }
        return t
    }
}

// MARK: - Talk to Theo
// TalkToTheoIntent lives in widgets/iOS/TheoCallShared.swift (shared with the Control Center button):
// it starts a background Theo call shown in the Dynamic Island, without opening the app.

// MARK: - Phrases (Siri pronounces the app via Info.plist CFBundleSpokenName; on screen it is always CrooHQ. "Theo" is another name for the app)

@available(iOS 18.0, *)
struct CrooShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: SalesTodayIntent(), phrases: [
            "Ask \(.applicationName) how sales are",
            "Ask \(.applicationName) how our sales are today",
            "Ask \(.applicationName) how sales are at \(\.$store)",
            "Ask \(.applicationName) how our sales are today at \(\.$store)",
            "\(.applicationName) sales",
            "\(.applicationName) sales at \(\.$store)",
        ], shortTitle: "Sales today", systemImageName: "dollarsign.circle")

        AppShortcut(intent: LaborIntent(), phrases: [
            "Ask \(.applicationName) how labor is",
            "Ask \(.applicationName) how labor is at \(\.$store)",
            "\(.applicationName) labor",
            "\(.applicationName) labor at \(\.$store)",
        ], shortTitle: "Labor", systemImageName: "person.2.badge.gearshape")

        AppShortcut(intent: WhosOnIntent(), phrases: [
            "Ask \(.applicationName) who's on",
            "Ask \(.applicationName) who's working",
            "Ask \(.applicationName) who's on at \(\.$store)",
            "\(.applicationName) who's on",
        ], shortTitle: "Who's on", systemImageName: "person.3")

        AppShortcut(intent: NextEventIntent(), phrases: [
            "Ask \(.applicationName) what's next",
            "Ask \(.applicationName) what's the next event",
            "Ask \(.applicationName) what's next at \(\.$store)",
        ], shortTitle: "Next event", systemImageName: "calendar")

        AppShortcut(intent: AskTheoIntent(), phrases: [
            "Ask \(.applicationName)",
            "Ask \(.applicationName) a question",
            "I have a question for \(.applicationName)",
        ], shortTitle: "Ask Theo", systemImageName: "bubble.left.and.text.bubble.right")

        AppShortcut(intent: TalkToTheoIntent(), phrases: [
            "Talk to \(.applicationName)",
            "Open \(.applicationName) voice",
            "Start \(.applicationName) voice",
        ], shortTitle: "Talk to Theo", systemImageName: "waveform")
    }
}
