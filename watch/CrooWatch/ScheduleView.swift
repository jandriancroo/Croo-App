import SwiftUI

/// Scrollable list of today's published shifts, mirrored from the phone.
struct ScheduleView: View {
    @EnvironmentObject var store: WatchDataStore

    var body: some View {
        Group {
            if store.snapshot.schedule.isEmpty {
                EmptyStateView(
                    title: "No Shifts Today",
                    message: "Today's published schedule will show up here."
                )
            } else {
                ScrollView {
                    VStack(spacing: 6) {
                        ForEach(store.snapshot.schedule) { shift in
                            ShiftRow(shift: shift)
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("Today")
    }
}

private struct ShiftRow: View {
    let shift: WatchShift

    var body: some View {
        HStack(spacing: 8) {
            RoundedRectangle(cornerRadius: 2)
                .fill(shift.isMe ? Color.accentColor : Color.secondary.opacity(0.4))
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

            Text(shift.time)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.vertical, 6)
        .padding(.horizontal, 8)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(shift.isMe ? 0.16 : 0.08))
        )
    }
}
