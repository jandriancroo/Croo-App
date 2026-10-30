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
#if os(iOS)
/// Small CrooHQ app icon in the bottom-right corner of home screen widgets.
/// Lives in the widget background so it sits near the corner, outside the content margins.
struct WLogo: View {
    @Environment(\.widgetFamily) private var family
    var body: some View {
        let size: CGFloat = family == .systemSmall ? 18 : 22
        Image("WidgetLogo")
            .resizable()
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.225, style: .continuous))
            .padding(8)
    }
}

/// Home screen background plus the logo.
struct WHomeBackground: View {
    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            WBackground()
            WLogo()
        }
    }
}
#endif

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
    var maxTotal: Double = 100

    var body: some View {
        let chars = Array(text)
        let natural = Double(fontSize * 0.78 / radius)
        let step = min(natural, maxTotal / Double(max(chars.count - 1, 1)))
        let size = fontSize * CGFloat(step / natural)
        let total = step * Double(max(chars.count - 1, 0))
        ZStack {
            ForEach(0..<chars.count, id: \.self) { i in
                Text(String(chars[i]))
                    .font(.system(size: size, weight: .bold, design: .rounded))
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
    var color: Color = WColor.orange
    var track: Color = WColor.trackOrange

    private let span: CGFloat = 260.0 / 360.0

    var body: some View {
        GeometryReader { geo in
            let size = min(geo.size.width, geo.size.height)
            let radius = (size - lineWidth) / 2
            ZStack {
                Circle()
                    .trim(from: 0, to: span)
                    .stroke(track, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-40))
                    .scaleEffect(x: -1, y: 1)
                Circle()
                    .trim(from: 0, to: span * CGFloat(min(max(progress, 0), 1)))
                    .stroke(color, style: StrokeStyle(lineWidth: lineWidth, lineCap: .round))
                    .rotationEffect(.degrees(-40))
                    .scaleEffect(x: -1, y: 1)
                WArcText(text: name, radius: radius, fontSize: fontSize, maxTotal: 1.3)
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

/// Same-height progress line used for both sales and labor, so the two always match.
struct WProgressLine: View {
    let progress: Double
    let color: Color
    let track: Color
    let height: CGFloat

    var body: some View {
        GeometryReader { geo in
            ZStack(alignment: .leading) {
                Capsule().fill(track)
                Capsule().fill(color)
                    .frame(width: geo.size.width * CGFloat(min(max(progress, 0), 1)))
            }
        }
        .frame(height: height)
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

/// S2 · Who's on: full first names with their start times, up to 5 people.
struct OnNowSmallView: View {
    let snap: WSnapshot
    private let maxRows = 5

    var body: some View {
        let active = snap.activeShifts
        let shown = min(active.count, maxRows)
        let more = max(snap.onNowCount - shown, 0)
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline) {
                Text("ON NOW").font(wFont(11)).foregroundStyle(WColor.green)
                Spacer()
                Text("\(snap.onNowCount)").font(wFont(18))
            }
            .padding(.bottom, 2)
            ForEach(0..<shown, id: \.self) { i in
                HStack(spacing: 6) {
                    Circle().fill(active[i].tint).frame(width: 7, height: 7)
                    Text(active[i].firstName)
                        .font(wFont(12, .medium))
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                    Spacer(minLength: 2)
                    Text("@\(active[i].startLabel)")
                        .font(wFont(11, .regular))
                        .foregroundStyle(WColor.muted)
                        .lineLimit(1)
                        .fixedSize()
                }
            }
            Spacer(minLength: 0)
            if more > 0 {
                Text("+\(more) more").font(wFont(10, .regular)).foregroundStyle(WColor.muted).lineLimit(1)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// S3 · Sales ring: store name in the ring, sales to goal, labor with a green/red line.
struct SalesRingSmallView: View {
    let snap: WSnapshot
    var body: some View {
        ZStack {
            WGapRing(progress: snap.salesProgress, name: snap.compactName.uppercased(), lineWidth: 9, fontSize: 11)
                .aspectRatio(1, contentMode: .fit)
            VStack(spacing: 4) {
                Text(WFormat.short(snap.sales)).font(wFont(22)).foregroundStyle(WColor.orange)
                    .lineLimit(1).minimumScaleFactor(0.7)
                WLaborLine(color: snap.laborColor, width: 26, height: 4)
                Text(snap.laborText).font(wFont(15)).foregroundStyle(.white)
            }
            .padding(.top, 6)
        }
        .padding(6)
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
        .padding(.bottom, 16)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

/// Timeline rows: one bar per shift with a live "now" line.
struct WTimeline: View {
    let snap: WSnapshot
    let maxRows: Int
    /// Adds a time ruler (a label every 2 hours) and snaps the window to even hours.
    var showRuler: Bool = false

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
        if showRuler { return ((lo / 120).rounded(.down) * 120, (hi / 120).rounded(.up) * 120) }
        return (lo, hi)
    }

    private func hourLabel(_ minute: Double) -> String {
        let h = Int(minute / 60) % 24
        let n = h % 12 == 0 ? 12 : h % 12
        return "\(n)\(h < 12 ? "a" : "p")"
    }

    @ViewBuilder private var ruler: some View {
        HStack(spacing: gap) {
            Color.clear.frame(width: nameWidth, height: 12)
            GeometryReader { geo in
                ForEach(Array(stride(from: window.lo, through: window.hi, by: 120)), id: \.self) { m in
                    Text(hourLabel(m))
                        .font(wFont(9, .regular))
                        .foregroundStyle(WColor.muted)
                        .fixedSize()
                        .position(x: min(max(geo.size.width * CGFloat(frac(m)), 10), geo.size.width - 10), y: 6)
                }
            }
            .frame(height: 12)
        }
    }

    private func frac(_ minute: Double) -> Double {
        let w = window
        return min(max((minute - w.lo) / (w.hi - w.lo), 0), 1)
    }

    var body: some View {
        let list = rows
        VStack(spacing: 7) {
            if showRuler { ruler }
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
        .padding(.bottom, 12)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }
}

/// M3 · Events: today's schedule events in time order, the next one highlighted.
struct EventsMediumView: View {
    let snap: WSnapshot
    private let maxRows = 5

    var body: some View {
        let list = snap.events
        let now = snap.scheduleSummary?.nowMin ?? 0
        let nextId = snap.nextEvent?.id
        let shown = Array(list.prefix(maxRows))
        VStack(alignment: .leading, spacing: 5) {
            HStack {
                Text("EVENTS · TODAY").font(wFont(11)).foregroundStyle(WColor.tealBright)
                Spacer()
                Text(snap.compactName.uppercased()).font(wFont(11, .regular)).foregroundStyle(WColor.muted).lineLimit(1)
            }
            if shown.isEmpty {
                Spacer(minLength: 0)
                Text("No events today").font(wFont(15, .medium)).foregroundStyle(WColor.muted)
            } else {
                ForEach(0..<shown.count, id: \.self) { i in
                    let e = shown[i]
                    let isNext = e.id == nextId
                    let isPast = (e.startMin ?? 0) < now
                    HStack(spacing: 8) {
                        Capsule().fill(e.tint).frame(width: 4, height: 15)
                        Text(e.timeLabel ?? "")
                            .font(wFont(12))
                            .foregroundStyle(isNext ? WColor.orange : .white)
                            .frame(width: 44, alignment: .leading)
                            .lineLimit(1)
                        Text(e.displayTitle)
                            .font(wFont(13, isNext ? .bold : .medium))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                        Spacer(minLength: 0)
                    }
                    .opacity(isPast ? 0.45 : 1)
                    .padding(.trailing, 26)
                }
                Spacer(minLength: 0)
                if list.count > shown.count {
                    Text("+\(list.count - shown.count) more").font(wFont(10, .regular)).foregroundStyle(WColor.muted)
                }
            }
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
            HStack(alignment: .top, spacing: 16) {
                VStack(spacing: 4) {
                    ZStack {
                        WRing(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, lineWidth: 9)
                        Text(snap.salesPercentText).font(wFont(17))
                    }
                    .frame(width: 84, height: 84)
                    Text(WFormat.full(snap.sales)).font(wFont(19)).foregroundStyle(WColor.orange)
                        .lineLimit(1).minimumScaleFactor(0.7)
                }
                VStack(spacing: 10) {
                    HStack(alignment: .top) {
                        cell("PACE", WFormat.full(snap.today?.paceValue ?? 0), WColor.tealBright)
                        cell("GOAL", WFormat.full(snap.goal), WColor.muted)
                    }
                    VStack(alignment: .leading, spacing: 3) {
                        Text("LABOR").font(wFont(10)).foregroundStyle(WColor.tealBright)
                        Text(snap.laborText).font(wFont(19))
                        WProgressLine(progress: 1, color: snap.laborColor, track: snap.laborColor.opacity(0.25), height: 5)
                        if let g = snap.laborGoalText {
                            Text(g).font(wFont(10, .regular)).foregroundStyle(WColor.muted)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            WTimeline(snap: snap, maxRows: 5, showRuler: true)
            if !snap.upcomingEvents.isEmpty {
                Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(snap.upcomingEvents.prefix(3).enumerated()), id: \.offset) { i, e in
                        HStack(spacing: 8) {
                            Capsule().fill(e.tint).frame(width: 3, height: 12)
                            Text(e.timeLabel ?? "").font(wFont(11)).foregroundStyle(i == 0 ? WColor.orange : .white)
                                .frame(width: 40, alignment: .leading)
                            Text(e.displayTitle).font(wFont(12, .medium)).lineLimit(1)
                            Spacer(minLength: 0)
                        }
                    }
                }
                .padding(.trailing, 30)
            }
            Spacer(minLength: 0)
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

// MARK: - Tall (Duo-size) store widget

/// Sales by hour: the gray bar is what was projected for that hour, the white bar is what actually sold.
struct WHourlyChart: View {
    let hours: [WHourly]
    var laborGoal: Double? = nil

    private let axisW: CGFloat = 32
    private let gap: CGFloat = 3

    private var lo: Int { hours.compactMap { $0.hour }.min() ?? 10 }
    private var hi: Int { hours.compactMap { $0.hour }.max() ?? 22 }

    private func niceCeil(_ v: Double, steps: [Double]) -> Double {
        for s in steps where v <= s { return s }
        return (v / 500).rounded(.up) * 500
    }
    /// Left axis top: next round dollar amount above the biggest bar.
    private var salesMax: Double {
        let m = max(hours.map { max($0.sales ?? 0, $0.projected ?? 0) }.max() ?? 1, 1)
        return niceCeil(m, steps: [100, 200, 250, 300, 400, 500, 600, 800, 1000, 1200, 1500, 2000])
    }
    /// Right axis top: round percent above the goal and the highest hour.
    private var laborMax: Double {
        let seen = hours.compactMap { $0.laborPercent }.max() ?? 0
        let m = min(max(seen, (laborGoal ?? 0) * 1.6, 20), 100)
        return niceCeil(m, steps: [20, 30, 40, 50, 60, 80, 100])
    }

    private func label(_ h: Int) -> String {
        let hh = h % 24
        let n = hh % 12 == 0 ? 12 : hh % 12
        return "\(n)\(hh < 12 ? "a" : "p")"
    }
    private func dollars(_ v: Double) -> String {
        v >= 1000 ? String(format: "$%.1fk", v / 1000).replacingOccurrences(of: ".0k", with: "k") : "$\(Int(v))"
    }

    var body: some View {
        let slots = max(hi - lo + 1, 1)
        VStack(spacing: 4) {
            HStack(spacing: 4) {
                // Left side: sales amounts
                VStack(alignment: .trailing) {
                    Text(dollars(salesMax))
                    Spacer(minLength: 0)
                    Text(dollars(salesMax / 2))
                    Spacer(minLength: 0)
                    Text("$0")
                }
                .font(wFont(8, .regular)).foregroundStyle(WColor.muted)
                .frame(width: axisW, alignment: .trailing)

                GeometryReader { geo in
                    let sw = (geo.size.width - gap * CGFloat(slots - 1)) / CGFloat(slots)
                    let h = geo.size.height
                    ZStack(alignment: .bottomLeading) {
                        // faint guide lines at top / middle
                        ForEach([0.0, 0.5, 1.0], id: \.self) { f in
                            Rectangle().fill(Color.white.opacity(f == 0 ? 0.0 : 0.07)).frame(height: 1)
                                .offset(y: -CGFloat(f) * h)
                        }
                        HStack(alignment: .bottom, spacing: gap) {
                            ForEach(0..<slots, id: \.self) { i in
                                let row = hours.first(where: { $0.hour == lo + i })
                                let p = CGFloat((row?.projected ?? 0) / salesMax) * h
                                let a = CGFloat((row?.sales ?? 0) / salesMax) * h
                                HStack(alignment: .bottom, spacing: 1) {
                                    RoundedRectangle(cornerRadius: 2).fill(Color.white.opacity(0.25))
                                        .frame(height: max(p, 2))
                                    RoundedRectangle(cornerRadius: 2).fill(Color.white)
                                        .frame(height: a > 0 ? max(a, 2) : 0)
                                }
                                .frame(maxWidth: .infinity, alignment: .bottom)
                            }
                        }
                        .frame(width: geo.size.width, height: h, alignment: .bottom)

                        // Labor goal: dashed line across the whole chart
                        if let g = laborGoal, g > 0 {
                            Path { path in
                                let y = h - CGFloat(min(g, laborMax) / laborMax) * h
                                path.move(to: CGPoint(x: 0, y: y))
                                path.addLine(to: CGPoint(x: geo.size.width, y: y))
                            }
                            .stroke(WColor.tealBright, style: StrokeStyle(lineWidth: 1.2, dash: [4, 3]))
                        }
                        // Labor % by hour: stepped line with a dot per hour
                        let pts: [CGPoint] = (0..<slots).compactMap { i in
                            guard let lp = hours.first(where: { $0.hour == lo + i })?.laborPercent else { return nil }
                            let x = CGFloat(i) * (sw + gap) + sw / 2
                            let y = h - CGFloat(min(max(lp, 0), laborMax) / laborMax) * h
                            return CGPoint(x: x, y: y)
                        }
                        if pts.count > 1 {
                            Path { path in
                                for (n, pt) in pts.enumerated() {
                                    n == 0 ? path.move(to: pt) : path.addLine(to: pt)
                                }
                            }
                            .stroke(WColor.orange, style: StrokeStyle(lineWidth: 1.6, lineJoin: .round))
                        }
                        ForEach(Array(pts.enumerated()), id: \.offset) { _, pt in
                            Circle().fill(WColor.orange).frame(width: 5, height: 5)
                                .position(x: pt.x, y: pt.y)
                        }
                    }
                    .frame(width: geo.size.width, height: h, alignment: .bottomLeading)
                }

                // Right side: labor percentages
                VStack(alignment: .leading) {
                    Text("\(Int(laborMax))%")
                    Spacer(minLength: 0)
                    Text("\(Int(laborMax / 2))%")
                    Spacer(minLength: 0)
                    Text("0%")
                }
                .font(wFont(8, .regular)).foregroundStyle(WColor.orange)
                .frame(width: axisW, alignment: .leading)
            }
            HStack(spacing: 4) {
                Color.clear.frame(width: axisW, height: 1)
                HStack(spacing: gap) {
                    ForEach(0..<slots, id: \.self) { i in
                        Text((lo + i) % 2 == 0 ? label(lo + i) : "")
                            .font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                            .lineLimit(1).minimumScaleFactor(0.6)
                            .frame(maxWidth: .infinity)
                    }
                }
                Color.clear.frame(width: axisW, height: 1)
            }
            HStack(spacing: 12) {
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.white.opacity(0.25)).frame(width: 8, height: 8)
                    Text("Projected").font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                }
                HStack(spacing: 4) {
                    RoundedRectangle(cornerRadius: 2).fill(Color.white).frame(width: 8, height: 8)
                    Text("Actual").font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                }
                HStack(spacing: 4) {
                    Circle().fill(WColor.orange).frame(width: 6, height: 6)
                    Text("Labor %").font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                }
                if let g = laborGoal, g > 0 {
                    HStack(spacing: 4) {
                        Rectangle().fill(WColor.tealBright).frame(width: 10, height: 1.5)
                        Text("Goal \(Int(g.rounded()))%").font(wFont(9, .regular)).foregroundStyle(WColor.muted)
                    }
                }
                Spacer(minLength: 0)
            }
        }
    }
}

/// Tall widget for the Duo: sales on top, hourly sales in the middle, schedule (with time ruler) at the bottom.
struct TallStoreView: View {
    let snap: WSnapshot

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text(snap.shortName).font(wFont(17)).lineLimit(1)
                Spacer()
                if !snap.updatedLabel.isEmpty {
                    Text("Updated \(snap.updatedLabel)").font(wFont(11, .regular)).foregroundStyle(WColor.muted)
                }
            }
            HStack(alignment: .bottom, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("SALES TODAY").font(wFont(11)).foregroundStyle(WColor.tealBright)
                    Text(WFormat.full(snap.sales)).font(wFont(34)).lineLimit(1).minimumScaleFactor(0.6)
                }
                Spacer(minLength: 0)
                stat("GOAL", WFormat.full(snap.goal), WColor.muted)
                stat("PACE", WFormat.full(snap.today?.paceValue ?? 0), WColor.tealBright)
                stat("LABOR", snap.laborText, snap.laborColor)
            }
            WProgressLine(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, height: 6)
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            VStack(alignment: .leading, spacing: 6) {
                Text("SALES BY HOUR").font(wFont(11)).foregroundStyle(WColor.tealBright)
                if snap.hourly.isEmpty {
                    Text("Hourly sales show up once the store is open.")
                        .font(wFont(12, .regular)).foregroundStyle(WColor.muted)
                        .frame(maxWidth: .infinity, minHeight: 120, alignment: .center)
                } else {
                    WHourlyChart(hours: snap.hourly, laborGoal: snap.today?.laborGoalPct).frame(height: 160)
                }
            }
            Rectangle().fill(Color.white.opacity(0.12)).frame(height: 1)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("SCHEDULE · TODAY").font(wFont(11)).foregroundStyle(WColor.tealBright)
                    Spacer()
                    Text("\(snap.onNowCount) on · \(snap.scheduleSummary?.later ?? 0) next")
                        .font(wFont(11, .regular)).foregroundStyle(WColor.muted)
                }
                WTimeline(snap: snap, maxRows: 6, showRuler: true)
            }
            Spacer(minLength: 0)
            if let e = snap.nextEvent {
                HStack(spacing: 8) {
                    Capsule().fill(e.tint).frame(width: 3, height: 14)
                    Text(e.displayTitle).font(wFont(12, .medium)).lineLimit(1)
                    Spacer(minLength: 0)
                    Text(e.timeLabel ?? "").font(wFont(12, .regular)).foregroundStyle(WColor.muted)
                }
                .padding(.trailing, 30)
            }
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
    }

    private func stat(_ title: String, _ value: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title).font(wFont(10)).foregroundStyle(WColor.muted)
            Text(value).font(wFont(15)).foregroundStyle(color).lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}

// MARK: - Accessory (lock screen + watch face)

/// Hands a circular complication its scale: 1 in a normal slot, ~1.8 in the big center slot
/// of faces like Waypoint, so text and ring weight grow with the circle.
struct WCircular<Content: View>: View {
    @ViewBuilder let content: (CGFloat) -> Content
    var body: some View {
        GeometryReader { geo in
            let k = max(1, min(geo.size.width, geo.size.height) / 50)
            content(k)
                .frame(width: geo.size.width, height: geo.size.height)
        }
    }
}

/// Circular · sales ring with the store name in the top gap.
struct AccSalesCircular: View {
    let snap: WSnapshot
    var body: some View {
        WCircular { k in
            ZStack {
                WGapRing(progress: snap.salesProgress, name: snap.compactName.uppercased(), lineWidth: 4 * k, fontSize: 7 * k)
                Text(snap.salesPercentText)
                    .font(.system(size: 14 * k, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6).lineLimit(1)
                    .padding(.top, 5 * k)
            }
            .padding(2)
        }
    }
}

/// Circular · one ring: store name in the top gap, the rest fills with sales vs goal,
/// sales $ and labor % stacked in the middle. In a big slot (k > 1.4) it also shows pace.
struct AccStoreRing: View {
    let snap: WSnapshot
    var body: some View {
        WCircular { k in
            ZStack {
                WGapRing(progress: snap.salesProgress, name: snap.compactName.uppercased(), lineWidth: 4 * k, fontSize: 7 * k)
                VStack(spacing: 0) {
                    Text(WFormat.short(snap.sales))
                        .font(.system(size: 13 * k, weight: .bold, design: .rounded))
                        .minimumScaleFactor(0.6).lineLimit(1)
                    Text(snap.laborText)
                        .font(.system(size: 9 * k, weight: .bold, design: .rounded))
                        .foregroundStyle(snap.laborColor)
                        .minimumScaleFactor(0.6).lineLimit(1)
                    if k > 1.4 {
                        Text("goal \(WFormat.short(snap.goal))")
                            .font(.system(size: 7 * k, weight: .semibold, design: .rounded))
                            .foregroundStyle(.secondary)
                            .minimumScaleFactor(0.6).lineLimit(1)
                    }
                }
                .padding(.top, 5 * k)
            }
            .padding(2)
        }
    }
}

/// Circular · labor %, ring and number green under goal / red over, store name in the top gap.
struct AccLaborCircular: View {
    let snap: WSnapshot
    private var fill: Double {
        guard let l = snap.labor else { return 0 }
        if let g = snap.today?.laborGoalPct, g > 0 { return min(max(l / g, 0), 1) }
        return min(max(l / 50, 0), 1)
    }
    var body: some View {
        WCircular { k in
            ZStack {
                WGapRing(progress: fill, name: snap.compactName.uppercased(), lineWidth: 4 * k, fontSize: 7 * k,
                         color: snap.laborColor, track: snap.laborColor.opacity(0.25))
                Text(snap.laborText)
                    .font(.system(size: 13 * k, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6).lineLimit(1)
                    .padding(.top, 5 * k)
            }
            .padding(2)
        }
    }
}

/// Circular · headcount on the clock, store name in the top gap.
struct AccOnNowCircular: View {
    let snap: WSnapshot
    var body: some View {
        WCircular { k in
            ZStack {
                WGapRing(progress: 0, name: snap.compactName.uppercased(), lineWidth: 4 * k, fontSize: 7 * k,
                         color: WColor.orange, track: Color.white.opacity(0.25))
                VStack(spacing: 0) {
                    Text("\(snap.onNowCount)").font(.system(size: 16 * k, weight: .bold, design: .rounded))
                    Text("ON").font(.system(size: 8 * k, weight: .semibold, design: .rounded))
                }
                .padding(.top, 5 * k)
            }
            .padding(2)
        }
    }
}

/// Rectangular · sales vs goal with the store name.
struct AccSalesGoalRect: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(snap.compactName.uppercased()) · SALES")
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
            Text(snap.compactName.uppercased())
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
                    WProgressLine(progress: snap.salesProgress, color: WColor.orange, track: WColor.trackOrange, height: 5)
                }
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 3) {
                        Text("LABOR").font(.system(size: 9, weight: .bold, design: .rounded)).foregroundStyle(.secondary)
                        if let goal = snap.laborGoalText {
                            Text(goal).font(.system(size: 8, design: .rounded)).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    Text(snap.laborText).font(.system(size: 18, weight: .bold, design: .rounded)).lineLimit(1)
                    WProgressLine(progress: 1, color: snap.laborColor, track: snap.laborColor.opacity(0.25), height: 5)
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
                Text("\(snap.compactName.uppercased()) · NEXT UP")
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

/// Rectangular · next event on today's schedule, with the store name.
struct AccNextEventRect: View {
    let snap: WSnapshot
    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack {
                Text("\(snap.compactName.uppercased()) · NEXT EVENT")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .lineLimit(1)
                Spacer(minLength: 2)
                if let next = snap.nextEvent {
                    Capsule().fill(next.tint).frame(width: 24, height: 6)
                }
            }
            if let next = snap.nextEvent {
                Text(next.displayTitle)
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .lineLimit(1).minimumScaleFactor(0.7)
                Text(afterLine(next))
                    .font(.system(size: 11, design: .rounded))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            } else {
                Text("No more events today").font(.system(size: 13, weight: .semibold, design: .rounded))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func afterLine(_ next: WEvent) -> String {
        let rest = snap.upcomingEvents.dropFirst().first
        if let rest { return "\(next.timeLabel ?? "") · then \(rest.displayTitle) \(rest.timeLabel ?? "")" }
        return next.timeLabel ?? ""
    }
}

/// Inline · one line of text.
struct AccInline: View {
    let snap: WSnapshot
    var body: some View {
        Text("\(snap.compactName) \(WFormat.short(snap.sales)) · \(snap.laborText)")
    }
}
