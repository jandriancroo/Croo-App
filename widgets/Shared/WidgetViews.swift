import SwiftUI
import WidgetKit

// All widget / complication layouts. Shared by both extensions so the phone and the watch match.

// MARK: - Building blocks

struct WBackground: View {
    var body: some View {
        LinearGradient(
            colors: [WColor.tealDeep, Color(red: 0.05, green: 0.13, blue: 0.15)],
            startPoint: .topLeading, endPoint: .bottomTrailing
        )
    }
}

struct WUnpaired: View {
    let paired: Bool
    var body: some View {
        VStack(spacing: 4) {
            Image(systemName: "link")
                .font(.system(size: 18, weight: .semibold))
            Text(paired ? "No data yet" : "Pair CrooHQ")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .multilineTextAlignment(.center)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Renders content once a snapshot exists, otherwise a short "pair" hint.
struct WidgetBody<Content: View>: View {
    let entry: CrooEntry
    let content: (WSnapshot) -> Content

    init(entry: CrooEntry, @ViewBuilder content: @escaping (WSnapshot) -> Content) {
        self.entry = entry
        self.content = content
    }

    var body: some View {
        if let snap = entry.snapshot {
            content(snap)
        } else {
            WUnpaired(paired: entry.paired)
        }
    }
}

struct WRing: View {
    let progress: Double
    let color: Color
    let track: Color
    let lineWidth: CGFloat

    var body: some View {
        ZStack {
            Circle().stroke(track, lineWidth: lineWidth)
            Circle()
                .trim(from: 0, to: CGFloat(min(max(progress, 0), 1)))
                .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                .rotationEffect(.degrees(-90))
        }
    }
}

/// Letters laid along an arc centred at the top of a circle.
struct WArcText: View {
    let text: String
    let radius: CGFloat
    let fontSize: CGFloat

    var body: some View {
        let chars = Array(text)
        let step = Double(fontSize * 0.78 / radius)
        let total = step * Double(max(chars.count - 1, 0))
        ZStack {
            ForEach(0..<chars.count, id: \.self) { i in
                Text(String(chars[i]))
                    .font(.system(size: fontSize, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .offset(y: -radius)
                    .rotationEffect(.radians(-total / 2 + step * Double(i)))
            }
        }
    }
}

/// Sales ring with the store name sitting in the top of the ring. Only the rest of the ring fills,
/// left to right (down the left side, around the bottom, up the right side).
struct WGapRing: View {
    let progress: Double
    let name: String
    let lineWidth: CGFloat
    let fontSize: CGFloat

    private let span: CGFloat = 260.0 / 360.0

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let radius = (size - lineWidth) / 2
            ZStack {
                Circle()
                    .trim(from: 0, to: span)
                    .stroke(WColor.trackOrange, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-40))
                    .scaleEffect(x: -1, y: 1)
                Circle()
                    .trim(from: 0, to: span * CGFloat(min(max(progress, 0), 1)))
                    .stroke(WColor.orange, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-40))
                    .scaleEffect(x: -1, y: 1)
                WArcText(text: name, radius: radius, fontSize: fontSize)
            }
            .frame(width: size, height: size)
            .position(x: geo.size.width / 2, y: geo.size.height / 2)
        }
    }
}

struct WLaborLine: View {
    let color: Color
    let width: CGFloat?
    let height: CGFloat

    var body: some View {
        Capsule()
            .fill(color)
            .frame(width: width, height: height)
    }
}

private func wFont(_ size: CGFloat, _ weight: Font.Weight = .bold) -> Font {
    .system(size: size, weight: weight, design: .rounded)
}

// MARK: - iPhone home screen · small

/// S1 · Sales: ring, amount, goal.
struct SalesSmallView: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("SALES TODAY").font(wFont(11)).foregroundStyle(WColor.orange)
            HStack(spacing: 10) {
                ZStack {
                    WRing(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, lineWidth: 7)
                    Text(snap.salesPercentText).font(wFont(14))
                }
                .frame(width: 62, height: 62)
                VStack(alignment: .leading, spacing: 0) {
                    Text("of").font(wFont(11, .regular)).foregroundStyle(WColor.muted)
                    Text(WFormat.full(snap.goal)).font(wFont(11, .semibold)).foregroundStyle(WColor.muted)
                }
            }
            Spacer(minLength: 0)
            Text(WFormat.full(snap.sales))
                .font(wFont(26))
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(snap.updatedLabel.isEmpty ? snap.shortName : "\(snap.shortName) · \(snap.updatedLabel)")
                .font(wFont(10, .regular))
                .foregroundStyle(WColor.muted)
                .lineLimit(1)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// S2 · Who's on: names and start times.
struct OnNowSmallView: View {
    let snap: WSnapshot
    var body: some View {
        let active = snap.activeShifts
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text("ON NOW").font(wFont(11)).foregroundStyle(WColor.green)
                Spacer()
                Text("\(snap.onNowCount)").font(wFont(20))
            }
            ForEach(0..<min(active.count, 3), id: \.self) { i in
                HStack(spacing: 7) {
                    Circle().fill(active[i].tint).frame(width: 8, height: 8)
                    Text(active[i].firstName).font(wFont(13, .medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text("since \(active[i].startLabel)").font(wFont(10, .regular)).foregroundStyle(WColor.muted).lineLimit(1)
                }
            }
            Spacer(minLength: 0)
            Text(footer(active.count)).font(wFont(10, .regular)).foregroundStyle(WColor.muted).lineLimit(1)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func footer(_ shown: Int) -> String {
        var parts: [String] = []
        let more = snap.onNowCount - min(shown, 3)
        if more > 0 { parts.append("+\(more) more") }
        if let next = snap.nextShift { parts.append("Next: \(next.firstName) \(next.startLabel)") }
        return parts.joined(separator: " · ")
    }
}

/// S3 · Sales ring: store name in the ring, sales to goal, labor with a green/red line.
struct SalesRingSmallView: View {
    let snap: WSnapshot
    var body: some View {
        ZStack {
            WGapRing(progress: snap.salesProgress, name: snap.shortName.uppercased(), lineWidth: 9, fontSize: 11)
                .aspectRatio(1, contentMode: .fit)
            VStack(spacing: 4) {
                Text(WFormat.short(snap.sales)).font(wFont(22)).foregroundStyle(WColor.orange)
                    .lineLimit(1).minimumScaleFactor(0.7)
                WLaborLine(color: snap.laborColor, width: 26, height: 4)
                Text(snap.laborText).font(wFont(15)).foregroundStyle(.white)
            }
            .padding(.top, 6)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

// MARK: - iPhone home screen · medium

private struct MetricRow: View {
    let label: String
    let value: String
    let color: Color
    var line: Color? = nil

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline) {
                Text(label).font(wFont(12)).foregroundStyle(color)
                Spacer(minLength: 4)
                Text(value).font(wFont(17)).foregroundStyle(.white).lineLimit(1).minimumScaleFactor(0.7)
            }
            if let line {
                WLaborLine(color: line, width: nil, height: 3)
            }
        }
    }
}

/// M1 · Scoreboard: sales and pace rings plus labor and headcount.
struct ScoreboardMediumView: View {
    let snap: WSnapshot
    var body: some View {
        HStack(spacing: 18) {
            ZStack {
                WRing(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, lineWidth: 8)
                WRing(progress: snap.paceProgress, color: WColor.tealBright, track: Color(white: 0.2), lineWidth: 8)
                    .padding(11)
                VStack(spacing: 1) {
                    Text(WFormat.short(snap.sales)).font(wFont(18)).lineLimit(1).minimumScaleFactor(0.6)
                    Text("of \(WFormat.short(snap.goal))").font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                }
                .padding(.horizontal, 20)
            }
            .frame(width: 104, height: 104)
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(snap.shortName).font(wFont(12, .semibold)).foregroundStyle(WColor.muted).lineLimit(1)
                    Spacer()
                    Text(snap.updatedLabel).font(wFont(10, .regular)).foregroundStyle(WColor.muted)
                }
                MetricRow(label: "Pace", value: WFormat.short(snap.today?.paceValue), color: WColor.orange)
                MetricRow(label: "Labor", value: snap.laborText, color: WColor.tealBright, line: snap.laborColor)
                MetricRow(label: "On now", value: "\(snap.onNowCount)", color: WColor.green)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Timeline rows: one bar per shift with a live "now" line.
struct WTimeline: View {
    let snap: WSnapshot
    let maxRows: Int

    private let nameWidth: CGFloat = 46
    private let gap: CGFloat = 8

    private var rows: [WShift] {
        let active = snap.shifts.filter { $0.status == "active" || $0.status == "break" }
        let rest = snap.shifts.filter { !($0.status == "active" || $0.status == "break") && $0.status != "done" }
        return Array((active + rest).prefix(maxRows))
    }

    private var window: (lo: Double, hi: Double) {
        let starts = snap.shifts.compactMap { $0.startMin }
        let ends = snap.shifts.compactMap { $0.endMin }
        guard let lo = starts.min(), let hi = ends.max(), hi - lo >= 60 else { return (360, 1320) }
        return (lo, hi)
    }

    private func frac(_ minute: Double) -> Double {
        let w = window
        return min(max((minute - w.lo) / (w.hi - w.lo), 0), 1)
    }

    var body: some View {
        let list = rows
        VStack(spacing: 7) {
            ForEach(0..<list.count, id: \.self) { i in
                HStack(spacing: gap) {
                    Text(list[i].firstName).font(wFont(12, .medium)).lineLimit(1)
                        .frame(width: nameWidth, alignment: .leading)
                    GeometryReader { geo in
                        let s = frac(list[i].startMin ?? window.lo)
                        let e = frac(list[i].endMin ?? window.hi)
                        let isLater = (list[i].status ?? "later") == "later"
                        Capsule()
                            .fill(list[i].tint.opacity(isLater ? 0.45 : 1))
                            .frame(width: max(8, geo.size.width * CGFloat(e - s)), height: 14)
                            .offset(x: geo.size.width * CGFloat(s))
                    }
                    .frame(height: 14)
                }
            }
        }
        .overlay(alignment: .leading) {
            GeometryReader { geo in
                let now = snap.scheduleSummary?.nowMin
                if let now, now >= window.lo, now <= window.hi {
                    Rectangle()
                        .fill(Color.white)
                        .frame(width: 2, height: geo.size.height + 4)
                        .offset(x: nameWidth + gap + (geo.size.width - nameWidth - gap) * CGFloat(frac(now)), y: -2)
                }
            }
        }
        .foregroundStyle(.white)
    }
}

/// M2 · Timeline.
struct TimelineMediumView: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text("SCHEDULE · TODAY").font(wFont(11)).foregroundStyle(WColor.tealBright)
                Spacer()
                Text("\(snap.onNowCount) on · \(snap.scheduleSummary?.later ?? 0) next")
                    .font(wFont(11, .regular)).foregroundStyle(WColor.muted)
            }
            WTimeline(snap: snap, maxRows: 4)
            Spacer(minLength: 0)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

// MARK: - iPhone home screen · large

/// L1 · Everything: header, rings and numbers, timeline, next up.
struct StoreLargeView: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(snap.name).font(wFont(15)).lineLimit(1)
                Spacer()
                if !snap.updatedLabel.isEmpty {
                    Text("Updated \(snap.updatedLabel)").font(wFont(11, .regular)).foregroundStyle(WColor.muted)
                }
            }
            HStack(spacing: 16) {
                ZStack {
                    WRing(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, lineWidth: 8)
                    WRing(progress: snap.paceProgress, color: WColor.tealBright, track: Color(white: 0.2), lineWidth: 8)
                        .padding(11)
                    Text(snap.salesPercentText).font(wFont(17))
                }
                .frame(width: 96, height: 96)
                VStack(spacing: 10) {
                    HStack(alignment: .top) {
                        cell("SALES", WFormat.full(snap.sales), WColor.orange)
                        cell("GOAL", WFormat.full(snap.goal), WColor.muted)
                    }
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("LABOR").font(wFont(10)).foregroundStyle(WColor.tealBright)
                            Text(snap.laborText).font(wFont(19))
                            WLaborLine(color: snap.laborColor, width: 28, height: 3)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        cell("ON NOW", "\(snap.onNowCount)", WColor.green)
                    }
                }
            }
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            WTimeline(snap: snap, maxRows: 4)
            Spacer(minLength: 0)
            if let next = snap.nextShift {
                Text("Next: \(next.firstName) · \(next.startLabel)")
                    .font(wFont(12, .regular)).foregroundStyle(WColor.muted).lineLimit(1)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func cell(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(wFont(10)).foregroundStyle(color)
            Text(value).font(wFont(19)).lineLimit(1).minimumScaleFactor(0.7)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Accessory (lock screen + watch face)

/// Circular · sales ring.
struct AccSalesCircular: View {
    let snap: WSnapshot
    var body: some View {
        Gauge(value: snap.salesProgress) {
            Text("SALES")
        } currentValueLabel: {
            Text(snap.salesPercentText)
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(WColor.orange)
    }
}

/// Circular · one ring: store name in the top gap, the rest fills with sales vs goal,
/// sales $ and labor % stacked in the middle.
struct AccStoreRing: View {
    let snap: WSnapshot
    var body: some View {
        ZStack {
            WGapRing(progress: snap.salesProgress, name: snap.shortName.uppercased(), lineWidth: 4, fontSize: 7)
            VStack(spacing: 0) {
                Text(WFormat.short(snap.sales))
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
                Text(snap.laborText)
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(snap.laborColor)
                    .minimumScaleFactor(0.6)
                    .lineLimit(1)
            }
            .padding(.top, 5)
        }
        .padding(2)
    }
}

/// Circular · labor %, green under goal / red over.
struct AccLaborCircular: View {
    let snap: WSnapshot
    private var fill: Double {
        guard let l = snap.labor else { return 0 }
        if let g = snap.today?.laborGoalPct, g > 0 { return min(max(l / g, 0), 1) }
        return min(max(l / 50, 0), 1)
    }
    var body: some View {
        Gauge(value: fill) {
            Text("LABOR")
        } currentValueLabel: {
            Text(snap.laborText.replacingOccurrences(of: "%", with: ""))
        }
        .gaugeStyle(.accessoryCircularCapacity)
        .tint(snap.laborColor)
    }
}

/// Circular · headcount on the clock.
struct AccOnNowCircular: View {
    let snap: WSnapshot
    var body: some View {
        ZStack {
            AccessoryWidgetBackground()
            VStack(spacing: 0) {
                Text("\(snap.onNowCount)").font(.system(size: 22, weight: .bold, design: .rounded))
                Text("ON").font(.system(size: 9, weight: .semibold, design: .rounded))
            }
        }
    }
}

/// Rectangular · sales vs goal with the store name.
struct AccSalesGoalRect: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(snap.shortName.uppercased()) · SALES")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 2)
                Text(snap.salesPercentText).font(.system(size: 11, weight: .semibold, design: .rounded))
            }
            HStack(alignment: .firstTextBaseline, spacing: 3) {
                Text(WFormat.full(snap.sales))
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text("/ \(WFormat.short(snap.goal))")
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            }
            ProgressView(value: snap.salesProgress)
                .progressViewStyle(.linear)
                .tint(WColor.orange)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Rectangular · store, sales to goal, labor with a green/red line (all in one).
struct AccStoreRect: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(snap.name.uppercased())
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .lineLimit(1).minimumScaleFactor(0.6)
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("SALES").font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(WColor.orange)
                        Spacer(minLength: 2)
                        Text(snap.salesPercentText).font(.system(size: 9, design: .rounded)).foregroundStyle(.secondary)
                    }
                    Text(WFormat.short(snap.sales)).font(.system(size: 18, weight: .bold, design: .rounded)).lineLimit(1)
                    ProgressView(value: snap.salesProgress).progressViewStyle(.linear).tint(WColor.orange)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text("LABOR").font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                    Text(snap.laborText).font(.system(size: 18, weight: .bold, design: .rounded)).lineLimit(1)
                    WLaborLine(color: snap.laborColor, width: nil, height: 4)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Rectangular · next shift to start.
struct AccNextShiftRect: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(snap.shortName.uppercased()) · NEXT UP")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 2)
                if let next = snap.nextShift {
                    Capsule().fill(next.tint).frame(width: 30, height: 6)
                }
            }
            if let next = snap.nextShift {
                Text("\(next.displayName) · \(next.role ?? "")")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(next.rangeLabel)
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
            } else {
                Text("No more shifts today").font(.system(size: 13, weight: .semibold, design: .rounded))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// Inline · one line of text.
struct AccInline: View {
    let snap: WSnapshot
    var body: some View {
        Text("\(snap.shortName) \(WFormat.short(snap.sales)) · \(snap.laborText)")
    }
}
