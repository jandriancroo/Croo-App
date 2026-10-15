import SwiftUI

/// Today's published schedule like the mobile schedule page: who's on now
/// (clocked in / on break / not in yet), later, and done.
struct ScheduleView: View {
    @EnvironmentObject var store: WatchDataStore

    private var shifts: [WatchShift] { store.snapshot.schedule }

    private var onNow: [WatchShift] {
        let rank: [String: Int] = ["active": 0, "break": 1, "late": 2]
        return shifts
            .filter { rank[$0.resolvedStatus] != nil }
            .sorted { (rank[$0.resolvedStatus] ?? 9) < (rank[$1.resolvedStatus] ?? 9) }
    }
    private var later: [WatchShift] { shifts.filter { $0.resolvedStatus == "later" } }
    private var done: [WatchShift] { shifts.filter { $0.resolvedStatus == "completed" } }

    private var clockedInCount: Int {
        store.snapshot.scheduleSummary?.onNow
            ?? shifts.filter { $0.resolvedStatus == "active" || $0.resolvedStatus == "break" }.count
    }
    private var totalHours: Double {
        store.snapshot.scheduleSummary?.totalHours ?? shifts.reduce(0) { $0 + ($1.hours ?? 0) }
    }

    var body: some View {
        Group {
            if !store.isPaired {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if shifts.isEmpty {
                EmptyStateView(
                    title: "No Shifts Today",
                    message: "Today's published schedule will show up here."
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 6) {
                        header
                        chips
                        section("Now", shifts: onNow, tint: CrooBrand.green)
                        section("Later", shifts: later, tint: Color.white.opacity(0.6))
                        section("Done", shifts: done, tint: Color.white.opacity(0.4))
                    }
                    .padding(.horizontal, 2)
                    .padding(.bottom, 8)
                }
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Schedule")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(CrooBrand.tealBright)
            Spacer()
            Text(store.currentLocationName)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 6)
    }

    private var chips: some View {
        HStack(spacing: 4) {
            HStack(spacing: 3) {
                Circle().fill(CrooBrand.green).frame(width: 5, height: 5)
                Text("\(clockedInCount) on")
            }
            .foregroundStyle(CrooBrand.green)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Capsule().fill(CrooBrand.green.opacity(0.18)))

            Text("\(later.count) later")
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(CrooBrand.card))

            Text(hoursLabel(totalHours))
                .padding(.horizontal, 6)
                .padding(.vertical, 2)
                .background(Capsule().fill(CrooBrand.card))
        }
        .font(.system(size: 10, weight: .bold, design: .rounded))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .padding(.horizontal, 3)
    }

    private func hoursLabel(_ h: Double) -> String {
        h.rounded() == h ? String(format: "%.0fh", h) : String(format: "%.1fh", h)
    }

    @ViewBuilder
    private func section(_ title: String, shifts: [WatchShift], tint: Color) -> some View {
        if !shifts.isEmpty {
            Text(title.uppercased())
                .font(.system(size: 9, weight: .heavy, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(tint)
                .padding(.horizontal, 6)
                .padding(.top, 4)
            ForEach(shifts) { shift in
                ShiftRow(shift: shift)
            }
        }
    }
}

private struct ShiftRow: View {
    let shift: WatchShift

    private var status: String { shift.resolvedStatus }
    private var live: String { shift.live ?? "" }

    private var dot: Color? {
        switch status {
        case "active": return CrooBrand.green
        case "break": return CrooBrand.amber
        default: return nil
        }
    }

    private var subtitleColor: Color {
        switch status {
        case "active": return CrooBrand.green
        case "break": return CrooBrand.amber
        default: return Color.white.opacity(0.55)
        }
    }

    private var background: Color {
        if shift.isMe { return CrooBrand.tealDeep }
        return status == "completed" ? CrooBrand.cardDim : CrooBrand.card
    }

    private var rightText: String {
        if !live.isEmpty { return live }
        return shift.hoursLabel
    }

    private var nameWeight: Font.Weight { .heavy }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .center, spacing: 8) {
                ZStack(alignment: .bottomTrailing) {
                    Circle()
                        .fill(CrooBrand.avatar)
                        .frame(width: 28, height: 28)
                        .overlay(
                            Text(shift.resolvedInitials)
                                .font(.system(size: 11, weight: .bold, design: .rounded))
                                .foregroundStyle(Color.white.opacity(0.9))
                        )
                    if let dot {
                        Circle()
                            .fill(dot)
                            .frame(width: 9, height: 9)
                            .overlay(Circle().stroke(background, lineWidth: 1.5))
                            .offset(x: 1, y: 1)
                    }
                }

                VStack(alignment: .leading, spacing: 0) {
                    Text(shift.isMe ? "You" : shift.name)
                        .font(.system(size: 14, weight: nameWeight, design: .rounded))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if !shift.role.isEmpty {
                        Text(shift.role)
                            .font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(Color.white.opacity(0.55))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                }
                Spacer(minLength: 0)
            }

            Rectangle()
                .fill(Color.white.opacity(0.08))
                .frame(height: 1)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(shift.time)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.75)
                Spacer(minLength: 2)
                if !rightText.isEmpty {
                    Text(rightText)
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(live.isEmpty ? Color.white.opacity(0.5) : subtitleColor)
                        .lineLimit(1)
                        .minimumScaleFactor(0.75)
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(
            RoundedRectangle(cornerRadius: 17, style: .continuous)
                .fill(background)
        )
        .opacity(status == "completed" ? 0.7 : 1)
    }
}
