import WidgetKit
import SwiftUI
import AppIntents

// Apple Watch complications. Every one has a Location option (edit the complication on the watch face).

private func accessoryConfig<Content: View>(
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

/// Corner: sales amount in the corner, with a curved sales-to-goal gauge and "STORE labor%" along the edge.
private struct CornerSalesView: View {
    let snap: WSnapshot
    var body: some View {
        Text(WFormat.short(snap.sales))
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .foregroundStyle(WColor.orange)
            .widgetCurvesContent()
            .widgetLabel {
                Gauge(value: snap.salesProgress) {
                    Text("\(snap.shortName.uppercased()) \(snap.laborText)")
                }
                .tint(WColor.orange)
            }
    }
}

struct SalesRingComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWSalesRing", name: "Sales ring", summary: "Sales vs goal.",
                        families: [.accessoryCircular]) { AccSalesCircular(snap: $0) }
    }
}

struct StoreRingComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWStoreRing", name: "Sales + labor + store ring",
                        summary: "One ring: store name on top, sales to goal around it, sales and labor % inside.",
                        families: [.accessoryCircular]) { AccStoreRing(snap: $0) }
    }
}

struct LaborRingComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWLaborRing", name: "Labor %", summary: "Labor %, green under goal and red over.",
                        families: [.accessoryCircular]) { AccLaborCircular(snap: $0) }
    }
}

struct OnNowComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWOnNow", name: "On the clock", summary: "People punched in right now.",
                        families: [.accessoryCircular]) { AccOnNowCircular(snap: $0) }
    }
}

struct CornerSalesComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWCorner", name: "Sales + store",
                        summary: "Sales in the corner with the store name and labor % on the edge.",
                        families: [.accessoryCorner]) { CornerSalesView(snap: $0) }
    }
}

struct SalesGoalComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWSalesGoal", name: "Sales vs goal",
                        summary: "Sales so far, the goal, and a bar between them.",
                        families: [.accessoryRectangular]) { AccSalesGoalRect(snap: $0) }
    }
}

struct StoreComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWStore", name: "Sales + labor + store",
                        summary: "Store name, sales to goal, labor % with a green or red line.",
                        families: [.accessoryRectangular]) { AccStoreRect(snap: $0) }
    }
}

struct NextShiftComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWNextShift", name: "Next shift",
                        summary: "Who starts next, in their shift color.",
                        families: [.accessoryRectangular]) { AccNextShiftRect(snap: $0) }
    }
}

struct InlineComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWInline", name: "Sales + labor line",
                        summary: "Store, sales and labor % in one line.",
                        families: [.accessoryInline]) { AccInline(snap: $0) }
    }
}

@main
struct CrooWatchWidgetBundle: WidgetBundle {
    var body: some Widget {
        SalesRingComplication()
        StoreRingComplication()
        LaborRingComplication()
        OnNowComplication()
        CornerSalesComplication()
        SalesGoalComplication()
        StoreComplication()
        NextShiftComplication()
        InlineComplication()
    }
}
