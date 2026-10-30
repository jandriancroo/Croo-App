import AppIntents
import WidgetKit
import SwiftUI

// Lets every widget / complication choose which location it shows
// (long-press the widget > Edit Widget > Location; on the watch face: edit complication).

struct LocationEntity: AppEntity {
    var id: String
    var name: String

    static var typeDisplayRepresentation: TypeDisplayRepresentation { TypeDisplayRepresentation(name: "Location") }
    static var defaultQuery: LocationQuery { LocationQuery() }

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(title: LocalizedStringResource(stringLiteral: name))
    }
}

struct LocationQuery: EntityQuery {
    func entities(for identifiers: [String]) async throws -> [LocationEntity] {
        CrooStore.locations()
            .filter { identifiers.contains($0.id) }
            .map { LocationEntity(id: $0.id, name: $0.name) }
    }

    func suggestedEntities() async throws -> [LocationEntity] {
        CrooStore.locations().map { LocationEntity(id: $0.id, name: $0.name) }
    }
}

struct SelectLocationIntent: WidgetConfigurationIntent {
    static var title: LocalizedStringResource { "Location" }
    static var description: IntentDescription { IntentDescription("Choose which store this widget shows.") }

    @Parameter(title: "Location")
    var location: LocationEntity?

    init() {}
}

// MARK: - One provider for every widget

struct CrooProvider: AppIntentTimelineProvider {
    typealias Entry = CrooEntry
    typealias Intent = SelectLocationIntent

    func placeholder(in context: Context) -> CrooEntry { CrooEntry.sample }

    func snapshot(for configuration: SelectLocationIntent, in context: Context) async -> CrooEntry {
        if context.isPreview { return CrooEntry.sample }
        return await makeEntry(configuration)
    }

    func timeline(for configuration: SelectLocationIntent, in context: Context) async -> Timeline<CrooEntry> {
        let entry = await makeEntry(configuration)
        return Timeline(entries: [entry], policy: .after(Self.nextRefresh(for: entry.snapshot)))
    }

    /// Store-hours refresh: every 10 minutes while the store is working (today's first shift minus an hour to the
    /// last shift plus an hour), one wake-up at the start of that window, and nothing overnight except a single
    /// early-morning check to pick up the new day's schedule. iOS treats this as a request, not a promise.
    static func nextRefresh(for snap: WSnapshot?, now: Date = Date()) -> Date {
        let cal = Calendar.current
        let nowMin = Double(cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now))
        func atMinute(_ m: Double, dayOffset: Int = 0) -> Date {
            let start = cal.startOfDay(for: now)
            let day = cal.date(byAdding: .day, value: dayOffset, to: start) ?? start
            return day.addingTimeInterval(m * 60)
        }
        let shifts = snap?.shifts ?? []
        let starts = shifts.compactMap { $0.startMin }
        let ends = shifts.compactMap { $0.endMin }
        var open = 6.0 * 60
        var close = 22.0 * 60
        var every = 30.0   // no schedule to read: slower, daytime only
        if let s = starts.min(), let e = ends.max() {
            open = max(0, s - 60)
            close = e + 60
            every = 10.0
        }
        if nowMin < open { return atMinute(open) }
        if nowMin < close { return now.addingTimeInterval(every * 60) }
        return atMinute(5 * 60, dayOffset: 1)
    }

    #if os(watchOS)
    // watchOS requires this: one ready-made choice per location in the complication gallery.
    func recommendations() -> [AppIntentRecommendation<SelectLocationIntent>] {
        let locs = CrooStore.locations()
        if locs.isEmpty {
            return [AppIntentRecommendation(intent: SelectLocationIntent(),
                                            description: LocalizedStringResource(stringLiteral: "CrooHQ"))]
        }
        return locs.map { loc in
            var intent = SelectLocationIntent()
            intent.location = LocationEntity(id: loc.id, name: loc.name)
            return AppIntentRecommendation(intent: intent,
                                           description: LocalizedStringResource(stringLiteral: loc.name))
        }
    }
    #endif

    private func makeEntry(_ configuration: SelectLocationIntent) async -> CrooEntry {
        let snap = await CrooStore.load(locationId: configuration.location?.id)
        return CrooEntry(date: Date(), snapshot: snap, paired: CrooStore.pairing() != nil)
    }
}
