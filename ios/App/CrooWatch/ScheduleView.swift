import SwiftUI

struct ScheduleView: View {
    @EnvironmentObject var store: WatchDataStore

    private var shifts: [WatchShift] { store.snapshot.schedule }

    private var active: [WatchShift] {
        shifts.filter { $0.status.lowercased() == "active" }
    }

    private var later: [WatchShift] {
        shifts.filter { $0.status.lowercased() == "later" }
    }

    private var completed: [WatchShift] {
        shifts.filter { $0.status.lowercased() == "completed" }
    }

    var body: some View {
        Group {
            if shifts.isEmpty {
                EmptyStateView(
                    title: "No Schedule",
                    message: "Today’s shifts will show here when the iPhone sends them."
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        header

                        if !active.isEmpty {
                            section(title: "NOW", count: active.count, tint: Color.green) {
                                ForEach(active) { shift in
                                    ShiftRow(shift: shift, emphasis: .active)
                                }
                            }
                        }

                        if !later.isEmpty {
                            section(title: "LATER", count: later.count, tint: Color.blue) {
                                ForEach(later) { shift in
                                    ShiftRow(shift: shift, emphasis: .later)
                                }
                            }
                        }

                        if !completed.isEmpty {
                            section(title: "DONE", count: completed.count, tint: Color.secondary) {
                                ForEach(completed) { shift in
                                    ShiftRow(shift: shift, emphasis: .done)
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("Schedule")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(store.snapshot.locationName.isEmpty ? "Today" : store.snapshot.locationName.uppercased())
                .font(.system(size: 11, weight: .heavy))
                .tracking(0.5)

            HStack(spacing: 6) {
                Text("\(active.count) active")
                    .foregroundStyle(.green)
                Text("·")
                    .opacity(0.5)
                Text("\(shifts.count) total")
                    .opacity(0.8)
                if !active.isEmpty {
                    Spacer(minLength: 0)
                    Text("LIVE")
                        .font(.system(size: 9, weight: .bold))
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Capsule().stroke(Color.red.opacity(0.9), lineWidth: 1))
                        .foregroundStyle(.red)
                }
            }
            .font(.system(size: 10, weight: .semibold))
        }
        .padding(.top, 2)
    }

    private func section<Content: View>(
        title: String,
        count: Int,
        tint: Color,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Circle()
                    .fill(tint)
                    .frame(width: 5, height: 5)
                Text(title)
                    .font(.system(size: 10, weight: .heavy))
                    .tracking(0.6)
                    .foregroundStyle(tint)
                Text("\(count)")
                    .font(.system(size: 9, weight: .semibold))
                    .opacity(0.6)
            }
            content()
        }
    }
}

private struct ShiftRow: View {
    enum Emphasis {
        case active, later, done
    }

    let shift: WatchShift
    let emphasis: Emphasis

    var body: some View {
        HStack(alignment: .top, spacing: 6) {
            RoundedRectangle(cornerRadius: 2)
                .fill(barColor)
                .frame(width: 3)
                .padding(.vertical, 2)

            VStack(alignment: .leading, spacing: 1) {
                HStack(alignment: .firstTextBaseline) {
                    Text(shift.name)
                        .font(.system(size: 13, weight: shift.isMe ? .bold : .semibold))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    if let hours = shift.hours, !hours.isEmpty {
                        Text(hours)
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                            .monospacedDigit()
                            .foregroundStyle(hoursColor)
                    }
                }
                Text(shift.time)
                    .font(.system(size: 10, weight: .medium))
                    .opacity(0.75)
                    .lineLimit(1)
                if !shift.role.isEmpty {
                    Text(shift.role)
                        .font(.system(size: 9, weight: .medium))
                        .opacity(0.55)
                        .lineLimit(1)
                }
            }
        }
        .padding(.vertical, 4)
        .padding(.horizontal, 4)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color.primary.opacity(emphasis == .active ? 0.08 : 0.04))
        )
    }

    private var barColor: Color {
        switch emphasis {
        case .active: return .green
        case .later: return .blue
        case .done: return .secondary.opacity(0.5)
        }
    }

    private var hoursColor: Color {
        switch emphasis {
        case .active: return .green
        case .later: return .primary
        case .done: return .secondary
        }
    }
}

#Preview {
    let store = WatchDataStore.shared
    store.snapshot = WatchSnapshot(
        updatedAt: "2026-08-12T16:00:00Z",
        locationName: "Hemet",
        cubes: [],
        schedule: [
            WatchShift(
                id: "1",
                name: "Nicole Mendez",
                role: "In",
                time: "12:00 PM – 7:00 PM",
                status: "active",
                hours: "3.6h",
                isMe: false
            ),
            WatchShift(
                id: "2",
                name: "Cheyenne Nauretz",
                role: "In",
                time: "3:30 PM – 11:00 PM",
                status: "active",
                hours: "0.7h",
                isMe: false
            ),
            WatchShift(
                id: "3",
                name: "Isaac Shumaker",
                role: "In",
                time: "4:00 PM – 11:00 PM",
                status: "active",
                hours: "0.2h",
                isMe: false
            ),
            WatchShift(
                id: "4",
                name: "Janessa Hinojosa",
                role: "PM Line 2",
                time: "5:30 PM – 11:00 PM",
                status: "later",
                hours: nil,
                isMe: false
            ),
            WatchShift(
                id: "5",
                name: "Allie Rowe",
                role: "",
                time: "9:00 AM – 4:00 PM",
                status: "completed",
                hours: "6.7h",
                isMe: false
            ),
            WatchShift(
                id: "6",
                name: "Jaysen Robertson",
                role: "",
                time: "9:30 AM – 3:00 PM",
                status: "completed",
                hours: "4.8h",
                isMe: false
            )
        ],
        sales: []
    )
    store.hasData = true
    return ScheduleView()
        .environmentObject(store)
}
