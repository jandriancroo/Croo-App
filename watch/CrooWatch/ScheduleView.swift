import SwiftUI

/// Today's published schedule as a timeline: one bar per person across the day,
/// with a glowing "now" line. Green = clocked in, amber = on break, gray = not started.
struct ScheduleView: View {
    @EnvironmentObject var store: WatchDataStore

    private var shifts: [WatchShift] { store.snapshot.schedule }
    private var nowMin: Double { store.snapshot.scheduleSummary?.nowMin ?? 0 }

    /// Hour range that covers every shift, padded to whole hours.
    private var range: (start: Double, end: Double) {
        let starts = shifts.compactMap { $0.startMin }
        let ends = shifts.compactMap { $0.endMin }
        guard let s = starts.min(), let e = ends.max(), e > s else { return (9 * 60, 22 * 60) }
        let lo = (s / 60).rounded(.down) * 60
        let hi = max((e / 60).rounded(.up) * 60, lo + 180)
        return (lo, hi)
    }

    private var clockedInCount: Int {
        store.snapshot.scheduleSummary?.onNow
            ?? shifts.filter { $0.resolvedStatus == "active" || $0.resolvedStatus == "break" }.count
    }

    var body: some View {
        Group {
            if !store.isPaired {
                EmptyStateView(title: "Not Paired", message: "Pair this Watch from CrooHQ on iPhone.")
            } else if shifts.isEmpty {
                EmptyStateView(title: "No Shifts Today", message: "Today's published schedule will show up here.")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        VStack(alignment: .leading, spacing: 0) {
                            Text("Today")
                                .font(.system(size: 16, weight: .heavy, design: .rounded))
                                .foregroundStyle(CrooBrand.tealBright)
                            Text("\(clockedInCount) on now")
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundStyle(CrooBrand.green)
                        }
                        .padding(.horizontal, 6)

                        TimelineBoard(shifts: shifts, range: range, nowMin: nowMin)

                        Text(store.currentLocationName)
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            .padding(.horizontal, 6)
                    }
                    .padding(.bottom, 8)
                }
                .ignoresSafeArea(edges: .top)
            }
        }
    }
}

private struct TimelineBoard: View {
    let shifts: [WatchShift]
    let range: (start: Double, end: Double)
    let nowMin: Double

    private let nameWidth: CGFloat = 40

    private func hourLabel(_ minutes: Double) -> String {
        let h = Int(minutes / 60) % 24
        let suffix = h >= 12 ? "p" : "a"
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12)\(suffix)"
    }

    private func barColor(_ s: WatchShift) -> Color {
        if s.isMe && (s.resolvedStatus == "later") { return CrooBrand.tealBright }
        switch s.resolvedStatus {
        case "active": return CrooBrand.green
        case "break": return CrooBrand.amber
        case "late": return CrooBrand.amber.opacity(0.55)
        case "completed": return Color(white: 0.22)
        default: return Color(white: 0.30)
        }
    }

    private func shortName(_ s: WatchShift) -> String {
        if s.isMe { return "You" }
        let first = s.name.split(separator: " ").first.map(String.init) ?? s.name
        return String(first.prefix(6))
    }

    var body: some View {
        let span = max(range.end - range.start, 60)
        VStack(spacing: 5) {
            // Hour ticks
            HStack(spacing: 0) {
                Color.clear.frame(width: nameWidth)
                HStack {
                    Text(hourLabel(range.start))
                    Spacer()
                    Text(hourLabel(range.start + span / 2))
                    Spacer()
                    Text(hourLabel(range.end))
                }
            }
            .font(.system(size: 8, weight: .bold, design: .rounded))
            .foregroundStyle(.secondary)

            VStack(spacing: 5) {
                ForEach(shifts) { s in
                    HStack(spacing: 0) {
                        Text(shortName(s))
                            .font(.system(size: 10, weight: .heavy, design: .rounded))
                            .foregroundStyle(s.isMe ? CrooBrand.tealBright : Color.white.opacity(0.9))
                            .lineLimit(1)
                            .frame(width: nameWidth, alignment: .leading)
                        GeometryReader { geo in
                            let st = max(s.startMin ?? range.start, range.start)
                            let en = min(s.endMin ?? range.end, range.end)
                            let x = geo.size.width * (st - range.start) / span
                            let w = max(geo.size.width * (en - st) / span, 6)
                            ZStack(alignment: .leading) {
                                Capsule().fill(Color(white: 0.09))
                                Capsule().fill(barColor(s)).frame(width: w).offset(x: x)
                            }
                        }
                        .frame(height: 15)
                    }
                }
            }
            .overlay(
                GeometryReader { geo in
                    let trackW = geo.size.width - nameWidth
                    let f = (nowMin - range.start) / span
                    if f >= 0 && f <= 1 {
                        RoundedRectangle(cornerRadius: 1.5)
                            .fill(CrooBrand.green)
                            .frame(width: 2, height: geo.size.height)
                            .shadow(color: CrooBrand.green.opacity(0.8), radius: 3)
                            .offset(x: nameWidth + trackW * f - 1)
                    }
                }
            )
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(CrooBrand.card))
    }
}
