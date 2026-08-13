import SwiftUI

/// Today's published schedule, grouped into NOW / LATER / DONE.
struct ScheduleView: View {
    @EnvironmentObject var store: WatchDataStore

    private var active: [WatchShift] { store.snapshot.schedule.filter { $0.resolvedStatus == "active" } }
    private var later: [WatchShift] { store.snapshot.schedule.filter { $0.resolvedStatus == "later" } }
    private var done: [WatchShift] { store.snapshot.schedule.filter { $0.resolvedStatus == "completed" } }

    var body: some View {
        Group {
            if !store.isPaired {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if store.snapshot.schedule.isEmpty {
                EmptyStateView(
                    title: "No Shifts Today",
                    message: "Today's published schedule will show up here."
                )
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        section("Now", shifts: active, tint: .green)
                        section("Later", shifts: later, tint: .accentColor)
                        section("Done", shifts: done, tint: .secondary)
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("Today")
    }

    @ViewBuilder
    private func section(_ title: String, shifts: [WatchShift], tint: Color) -> some View {
        if !shifts.isEmpty {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 4) {
                    Text(title.uppercased())
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(tint)
                    Text("\(shifts.count)")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                ForEach(shifts) { shift in
                    ShiftRow(shift: shift, tint: tint)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

private struct ShiftRow: View {
    let shift: WatchShift
    let tint: Color

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(tint.opacity(shift.resolvedStatus == "completed" ? 0.35 : 0.9))
                .frame(width: 3)

            VStack(alignment: .leading, spacing: 1) {
                Text(shift.name)
                    .font(.system(size: 13, weight: shift.isMe ? .bold : .semibold))
                    .lineLimit(1)
                if !shift.role.isEmpty {
                    Text(shift.role)
                        .font(.system(size: 10))
                        .foregroundStyle(.tertiary)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 4)

            VStack(alignment: .trailing, spacing: 1) {
                Text(shift.time)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                if !shift.hoursLabel.isEmpty {
                    Text(shift.hoursLabel)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .opacity(shift.resolvedStatus == "completed" ? 0.6 : 1)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(shift.isMe ? 0.16 : 0.08))
        )
    }
}
