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
        NavigationStack {
        Group {
            if !store.isPaired {
                EmptyStateView(title: "Not Paired", message: "Pair this Watch from CrooHQ on iPhone.")
            } else if shifts.isEmpty {
                EmptyStateView(title: "No Shifts Today", message: "Today's published schedule will show up here.")
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        VStack(alignment: .leading, spacing: 0) {
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
            }
        }
        .navigationTitle("Schedule")
        }
        .background(Color.black.ignoresSafeArea())
    }
}

private struct TimelineBoard: View {
    let shifts: [WatchShift]
    let range: (start: Double, end: Double)
    let nowMin: Double

    private let nameWidth: CGFloat = 40
    @State private var selected: WatchShift?

    private func hourLabel(_ minutes: Double) -> String {
        let h = Int(minutes / 60) % 24
        let suffix = h >= 12 ? "p" : "a"
        let h12 = h % 12 == 0 ? 12 : h % 12
        return "\(h12)\(suffix)"
    }

    /// The shift template's color (same as the schedule screens); a neutral blue-gray for people with no shift.
    private func roleColor(_ s: WatchShift) -> Color {
        if let hex = s.color, !hex.isEmpty { return Color(hex: hex) }
        return Color(hex: "#7D8FA3")
    }

    private func barColor(_ s: WatchShift) -> Color {
        switch s.resolvedStatus {
        case "active": return roleColor(s)
        case "break": return CrooBrand.amber
        case "late": return roleColor(s).opacity(0.45)
        case "completed": return roleColor(s).opacity(0.25)
        default: return roleColor(s).opacity(0.6)
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
                    Button { selected = s } label: {
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
                                if s.resolvedStatus == "active" {
                                    Circle().fill(CrooBrand.green).frame(width: 6, height: 6)
                                        .offset(x: x + 4)
                                }
                            }
                        }
                        .frame(height: 15)
                    }
                    }
                    .buttonStyle(.plain)
                }
            }
            .sheet(item: $selected) { s in ShiftDetailView(shift: s) }
            .overlay(
                GeometryReader { geo in
                    let trackW = geo.size.width - nameWidth
                    let raw = (nowMin - range.start) / span
                    let f = min(max(raw, 0), 1)
                    let inside = raw >= 0 && raw <= 1
                    RoundedRectangle(cornerRadius: 1.5)
                        .fill(inside ? CrooBrand.green : Color.white.opacity(0.35))
                        .frame(width: 2, height: geo.size.height)
                        .shadow(color: inside ? CrooBrand.green.opacity(0.8) : .clear, radius: 3)
                        .offset(x: nameWidth + trackW * f - 1)
                }
                .allowsHitTesting(false)
            )
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 8)
        .background(RoundedRectangle(cornerRadius: 18, style: .continuous).fill(CrooBrand.card))
    }
}


/// Tap a pill to see the whole shift.
struct ShiftDetailView: View {
    let shift: WatchShift

    private var statusText: String {
        switch shift.resolvedStatus {
        case "active": return "Clocked in"
        case "break": return "On break"
        case "late": return "Not in yet"
        case "completed": return "Done"
        default: return "Later today"
        }
    }
    private var statusColor: Color {
        switch shift.resolvedStatus {
        case "active": return CrooBrand.green
        case "break", "late": return CrooBrand.amber
        default: return Color.white.opacity(0.6)
        }
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 8) {
                Circle()
                    .fill(CrooBrand.avatar)
                    .frame(width: 44, height: 44)
                    .overlay(Text(shift.resolvedInitials).font(.system(size: 16, weight: .heavy, design: .rounded)))
                Text(shift.isMe ? "You" : shift.name)
                    .font(.system(size: 18, weight: .heavy, design: .rounded))
                    .multilineTextAlignment(.center)
                if !shift.role.isEmpty {
                    Text(shift.role)
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                VStack(spacing: 6) {
                    row("Shift", shift.time)
                    if !shift.hoursLabel.isEmpty { row("Length", shift.hoursLabel) }
                    row("Status", statusText, color: statusColor)
                    if let live = shift.live, !live.isEmpty { row("Live", live, color: statusColor) }
                }
                .padding(10)
                .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(CrooBrand.card))
            }
            .padding(.horizontal, 4)
        }
    }

    private func row(_ label: String, _ value: String, color: Color = .white) -> some View {
        HStack {
            Text(label).font(.system(size: 11, weight: .medium, design: .rounded)).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).font(.system(size: 13, weight: .heavy, design: .rounded)).foregroundStyle(color)
                .lineLimit(1).minimumScaleFactor(0.7)
        }
    }
}
