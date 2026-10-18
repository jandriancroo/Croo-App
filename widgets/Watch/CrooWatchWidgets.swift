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
                    Text("\(snap.compactName.uppercased()) \(snap.laborText)")
                }
                .tint(WColor.orange)
            }
    }
}

private struct CornerLaborView: View {
    let snap: WSnapshot
    private var fill: Double {
        guard let l = snap.labor else { return 0 }
        if let g = snap.today?.laborGoalPct, g > 0 { return min(max(l / g, 0), 1) }
        return min(max(l / 50, 0), 1)
    }
    var body: some View {
        Text(snap.laborText)
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .foregroundStyle(snap.laborColor)
            .widgetCurvesContent()
            .widgetLabel {
                // Curved labor gauge follows the corner's edge, outside the label text.
                Gauge(value: fill) {
                    Text("\(snap.compactName.uppercased()) LABOR\(snap.laborGoalText.map { " · " + $0 } ?? "")")
                }
                .tint(snap.laborColor)
            }
    }
}

private struct CornerEventView: View {
    let snap: WSnapshot
    var body: some View {
        Text(snap.nextEvent?.timeLabel ?? "—")
            .font(.system(size: 14, weight: .bold, design: .rounded))
            .foregroundStyle(WColor.orange)
            .widgetCurvesContent()
            .widgetLabel {
                Text(snap.nextEvent?.displayTitle ?? "No events")
            }
    }
}

private struct CircularEventView: View {
    let snap: WSnapshot
    var body: some View {
        WCircular { k in
            VStack(spacing: 1 * k) {
                Image(systemName: "calendar").font(.system(size: 11 * k, weight: .bold))
                    .foregroundStyle(snap.nextEvent?.tint ?? WColor.muted)
                Text(snap.nextEvent?.timeLabel ?? "—")
                    .font(.system(size: 15 * k, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6).lineLimit(1)
                Text(snap.compactName.uppercased())
                    .font(.system(size: 7 * k, weight: .bold, design: .rounded))
                    .foregroundStyle(.secondary).minimumScaleFactor(0.6).lineLimit(1)
            }
        }
    }
}

private struct InlineEventView: View {
    let snap: WSnapshot
    var body: some View {
        if let e = snap.nextEvent {
            Text("\(snap.compactName) \(e.timeLabel ?? "") \(e.displayTitle)")
        } else {
            Text("\(snap.compactName) · no events")
        }
    }
}

private struct InlineShiftView: View {
    let snap: WSnapshot
    var body: some View {
        if let n = snap.nextShift {
            Text("\(snap.compactName) next: \(n.firstName) \(n.startLabel)")
        } else {
            Text("\(snap.compactName) · \(snap.onNowCount) on")
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

struct NextEventComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWNextEvent", name: "Next event",
                        summary: "The next event on today's schedule.",
                        families: [.accessoryRectangular]) { AccNextEventRect(snap: $0) }
    }
}

struct InlineComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWInline", name: "Sales + labor line",
                        summary: "Store, sales and labor % in one line.",
                        families: [.accessoryInline]) { AccInline(snap: $0) }
    }
}

struct CornerLaborComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWCornerLabor", name: "Labor corner",
                        summary: "Labor % in the corner, green or red against goal, store on the edge.",
                        families: [.accessoryCorner]) { CornerLaborView(snap: $0) }
    }
}

struct CornerEventComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWCornerEvent", name: "Next event corner",
                        summary: "Time of the next schedule event, title on the edge.",
                        families: [.accessoryCorner]) { CornerEventView(snap: $0) }
    }
}

struct CircularEventComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWCircularEvent", name: "Next event circle",
                        summary: "Time of the next event with the store name.",
                        families: [.accessoryCircular]) { CircularEventView(snap: $0) }
    }
}

struct InlineEventComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWInlineEvent", name: "Next event line",
                        summary: "Store, time and title of the next event in one line.",
                        families: [.accessoryInline]) { InlineEventView(snap: $0) }
    }
}

struct InlineShiftComplication: Widget {
    var body: some WidgetConfiguration {
        accessoryConfig(kind: "CrooWInlineShift", name: "Next shift line",
                        summary: "Store and who starts next, in one line.",
                        families: [.accessoryInline]) { InlineShiftView(snap: $0) }
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
        NextEventComplication()
        InlineComplication()
        CornerLaborComplication()
        CornerEventComplication()
        CircularEventComplication()
        InlineEventComplication()
        InlineShiftComplication()
    }
}
