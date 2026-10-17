import WidgetKit
import SwiftUI
import AppIntents

// iPhone widgets: home screen (small, medium, large) and lock screen.
// Every widget has a Location option (long-press > Edit Widget).

private func homeConfig<Content: View>(
    kind: String, name: String, summary: String, family: WidgetFamily,
    @ViewBuilder content: @escaping (WSnapshot) -> Content
) -> some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: SelectLocationIntent.self, provider: CrooProvider()) { entry in
        WidgetBody(entry: entry, content: content)
            .containerBackground(for: .widget) { WHomeBackground() }
    }
    .configurationDisplayName(name)
    .description(summary)
    .supportedFamilies([family])
}

struct SalesSmallWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooSalesSmall", name: "Sales", summary: "Today's sales, goal and percent.",
                   family: .systemSmall) { SalesSmallView(snap: $0) }
    }
}

struct OnNowSmallWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooOnNowSmall", name: "Who's on", summary: "Who is clocked in, with start times.",
                   family: .systemSmall) { OnNowSmallView(snap: $0) }
    }
}

struct SalesRingSmallWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooSalesRingSmall", name: "Sales ring",
                   summary: "Store name in the ring, sales to goal, labor %.",
                   family: .systemSmall) { SalesRingSmallView(snap: $0) }
    }
}

struct ScoreboardMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooScoreboardMedium", name: "Scoreboard",
                   summary: "Sales and pace rings with labor and headcount.",
                   family: .systemMedium) { ScoreboardMediumView(snap: $0) }
    }
}

struct TimelineMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooTimelineMedium", name: "Schedule",
                   summary: "Today's shifts on a timeline with a live now line.",
                   family: .systemMedium) { TimelineMediumView(snap: $0) }
    }
}

struct StoreLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooStoreLarge", name: "Store overview",
                   summary: "Rings, numbers, timeline and next shift.",
                   family: .systemLarge) { StoreLargeView(snap: $0) }
    }
}

// MARK: - Lock screen

private func lockConfig<Content: View>(
    kind: String, name: String, summary: String, families: [WidgetFamily],
    @ViewBuilder content: @escaping (WSnapshot) -> Content
) -> some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: SelectLocationIntent.self, provider: CrooProvider()) { entry in
        WidgetBody(entry: entry, content: content)
            .containerBackground(for: .widget) { Color.clear }
    }
    .configurationDisplayName(name)
    .description(summary)
    .supportedFamilies(families)
}

struct LockSalesWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockSales", name: "Sales ring", summary: "Sales vs goal.",
                   families: [.accessoryCircular]) { AccSalesCircular(snap: $0) }
    }
}

struct LockStoreRingWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockStoreRing", name: "Sales + labor + store ring",
                   summary: "Store name on top, sales to goal around it, sales and labor % inside.",
                   families: [.accessoryCircular]) { AccStoreRing(snap: $0) }
    }
}

struct LockLaborWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockLabor", name: "Labor %", summary: "Labor %, green under goal and red over.",
                   families: [.accessoryCircular]) { AccLaborCircular(snap: $0) }
    }
}

struct LockOnNowWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockOnNow", name: "On now", summary: "People on the clock.",
                   families: [.accessoryCircular]) { AccOnNowCircular(snap: $0) }
    }
}

private struct LockSummaryContent: View {
    let snap: WSnapshot
    @Environment(\.widgetFamily) private var family

    var body: some View {
        if family == .accessoryInline {
            AccInline(snap: snap)
        } else {
            AccStoreRect(snap: snap)
        }
    }
}

struct LockSummaryWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockSummary", name: "Sales and labor",
                   summary: "Store, sales vs goal and labor %.",
                   families: [.accessoryRectangular, .accessoryInline]) { LockSummaryContent(snap: $0) }
    }
}

@main
struct CrooWidgetBundle: WidgetBundle {
    var body: some Widget {
        SalesSmallWidget()
        OnNowSmallWidget()
        SalesRingSmallWidget()
        ScoreboardMediumWidget()
        TimelineMediumWidget()
        StoreLargeWidget()
        LockSalesWidget()
        LockStoreRingWidget()
        LockLaborWidget()
        LockOnNowWidget()
        LockSummaryWidget()
    }
}
