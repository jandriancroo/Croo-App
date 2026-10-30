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

struct EventsMediumWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooEventsMedium", name: "Events",
                   summary: "Today's schedule events in order, with the next one highlighted.",
                   family: .systemMedium) { EventsMediumView(snap: $0) }
    }
}

struct StoreLargeWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooStoreLarge", name: "Store overview",
                   summary: "Rings, numbers, timeline and next shift.",
                   family: .systemLarge) { StoreLargeView(snap: $0) }
    }
}

struct StoreTallWidget: Widget {
    var body: some WidgetConfiguration {
        homeConfig(kind: "CrooStoreTall", name: "Store overview (tall)",
                   summary: "Sales on top, sales by hour in the middle, today's schedule with a time ruler.",
                   family: .systemExtraLarge) { TallStoreView(snap: $0) }
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

struct LockNextEventWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockNextEvent", name: "Next event",
                   summary: "The next event on today's schedule.",
                   families: [.accessoryRectangular]) { AccNextEventRect(snap: $0) }
    }
}

struct LockSummaryWidget: Widget {
    var body: some WidgetConfiguration {
        lockConfig(kind: "CrooLockSummary", name: "Sales and labor",
                   summary: "Store, sales vs goal and labor %.",
                   families: [.accessoryRectangular, .accessoryInline]) { LockSummaryContent(snap: $0) }
    }
}

// MARK: - Ask Theo (tap = Theo opens in voice mode)

private struct TheoEntry: TimelineEntry { let date: Date }

private struct TheoProvider: TimelineProvider {
    func placeholder(in context: Context) -> TheoEntry { TheoEntry(date: Date()) }
    func getSnapshot(in context: Context, completion: @escaping (TheoEntry) -> Void) { completion(TheoEntry(date: Date())) }
    func getTimeline(in context: Context, completion: @escaping (Timeline<TheoEntry>) -> Void) {
        completion(Timeline(entries: [TheoEntry(date: Date())], policy: .never))
    }
}

/// Still frame of Theo's dot-sphere orb.
struct TheoOrbView: View {
    var body: some View {
        Canvas { ctx, size in
            let n = 260
            let golden = Double.pi * (3 - 5.0.squareRoot())
            let c = CGPoint(x: size.width / 2, y: size.height / 2)
            let R = min(size.width, size.height) * 0.46
            let rot = 0.6, tilt = 0.38
            var pts: [(x: Double, y: Double, z: Double)] = []
            for i in 0..<n {
                let y = 1 - (Double(i) / Double(n - 1)) * 2
                let r = (1 - y * y).squareRoot()
                let th = golden * Double(i)
                let x0 = cos(th) * r, z0 = sin(th) * r
                let x1 = x0 * cos(rot) + z0 * sin(rot), z1 = -x0 * sin(rot) + z0 * cos(rot)
                pts.append((x1, y * cos(tilt) - z1 * sin(tilt), y * sin(tilt) + z1 * cos(tilt)))
            }
            for pt in pts.sorted(by: { $0.z < $1.z }) {
                let depth = (pt.z + 1) / 2
                let d = R * (0.022 + 0.03 * depth)
                let rect = CGRect(x: c.x + pt.x * R - d, y: c.y + pt.y * R - d, width: d * 2, height: d * 2)
                let warm = pt.y < -0.55 && pt.x > 0
                ctx.fill(Path(ellipseIn: rect),
                         with: .color((warm ? WColor.orange : WColor.tealBright).opacity(0.35 + 0.65 * depth)))
            }
        }
    }
}

private let theoURL = URL(string: "croohq://theo")!

private struct AskTheoSmallView: View {
    var body: some View {
        VStack(spacing: 6) {
            TheoOrbView().frame(width: 84, height: 84)
            Text("Ask Theo").font(.system(size: 15, weight: .bold, design: .rounded)).foregroundStyle(.white)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

private struct AskTheoMediumView: View {
    private let hints = ["How are sales?", "Who's on now?", "What's my labor?"]
    var body: some View {
        HStack(spacing: 16) {
            TheoOrbView().frame(width: 104, height: 104)
            VStack(alignment: .leading, spacing: 7) {
                Text("Ask Theo").font(.system(size: 20, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text("Tap and just talk").font(.system(size: 12, weight: .semibold, design: .rounded)).foregroundStyle(WColor.tealBright)
                ForEach(hints, id: \.self) { h in
                    Text("\u{201C}\(h)\u{201D}")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(WColor.muted)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.trailing, 24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    }
}

struct AskTheoSmallWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CrooAskTheoSmall", provider: TheoProvider()) { _ in
            AskTheoSmallView()
                .widgetURL(theoURL)
                .containerBackground(for: .widget) { WHomeBackground() }
        }
        .configurationDisplayName("Ask Theo")
        .description("Tap to talk to Theo right away.")
        .supportedFamilies([.systemSmall])
    }
}

struct AskTheoMediumWidget: Widget {
    var body: some WidgetConfiguration {
        StaticConfiguration(kind: "CrooAskTheoMedium", provider: TheoProvider()) { _ in
            AskTheoMediumView()
                .widgetURL(theoURL)
                .containerBackground(for: .widget) { WHomeBackground() }
        }
        .configurationDisplayName("Ask Theo")
        .description("Tap to talk to Theo right away, with a few things to ask.")
        .supportedFamilies([.systemMedium])
    }
}

// MARK: - Control Center / Lock Screen button: Theo

/// One tap starts a Theo call in the Dynamic Island, without opening the app.
@available(iOS 18.0, *)
struct TheoControl: ControlWidget {
    var body: some ControlWidgetConfiguration {
        StaticControlConfiguration(kind: "CrooTheoControl") {
            ControlWidgetButton(action: TalkToTheoIntent()) {
                Label("Talk to Theo", systemImage: "waveform")
            }
        }
        .displayName("Talk to Theo")
        .description("Talk to Theo from anywhere. He shows up in the Dynamic Island.")
    }
}

@main
struct CrooWidgetBundle: WidgetBundle {
    var body: some Widget {
        AskTheoSmallWidget()
        if #available(iOS 18.0, *) { TheoControl() }
        TheoCallLiveActivity()
        AskTheoMediumWidget()
        SalesSmallWidget()
        OnNowSmallWidget()
        SalesRingSmallWidget()
        ScoreboardMediumWidget()
        TimelineMediumWidget()
        EventsMediumWidget()
        StoreLargeWidget()
        StoreTallWidget()
        LockSalesWidget()
        LockStoreRingWidget()
        LockLaborWidget()
        LockOnNowWidget()
        LockSummaryWidget()
        LockNextEventWidget()
    }
}
