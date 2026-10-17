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
        let next = Date().addingTimeInterval(15 * 60)
        return Timeline(entries: [entry], policy: .after(next))
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
