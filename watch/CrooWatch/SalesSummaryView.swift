import SwiftUI

/// Compact version of the dashboard Sales Summary widget: Today / Week / Month
/// scoreboard (orange), labor strip (teal), counts strip, to-date totals.
struct SalesSummaryView: View {
    @EnvironmentObject var store: WatchDataStore
    @State private var period = 0 // 0 = Today, 1 = Week, 2 = Month

    private var summary: WatchSalesSummary? { store.snapshot.salesSummary }

    private var current: WatchSalesPeriod? {
        switch period {
        case 1: return summary?.week
        case 2: return summary?.month
        default: return summary?.today
        }
    }

    var body: some View {
        Group {
            if !store.isPaired {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if let p = current {
                ScrollView {
                    VStack(spacing: 7) {
                        header
                        periodPicker
                        scoreboard(p)
                        statStrip(
                            [("Labor %", p.laborPercent), ("Labor $", p.laborCost), ("Hours", p.laborHours)],
                            background: CrooBrand.teal,
                            labelOpacity: 0.8
                        )
                        statStrip(
                            [("Pizzas", p.pizzas), ("Ticket", p.ticket), ("Guests", p.guests)],
                            background: CrooBrand.card,
                            labelOpacity: 0.6
                        )
                        toDateCard
                        if !store.snapshot.updatedAt.isEmpty {
                            Text("Updated \(SalesSummaryView.timeLabel(store.snapshot.updatedAt))")
                                .font(.system(size: 9, weight: .medium, design: .rounded))
                                .foregroundStyle(.secondary)
                                .padding(.top, 2)
                        }
                    }
                    .padding(.horizontal, 2)
                    .padding(.bottom, 8)
                }
            } else {
                EmptyStateView(
                    title: "No Sales Data",
                    message: "Sales show up here after the next refresh."
                )
            }
        }
    }

    private var header: some View {
        HStack {
            Text("Sales")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(CrooBrand.orange)
            Spacer()
            Text(store.currentLocationName)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .padding(.horizontal, 6)
    }

    private var periodPicker: some View {
        HStack(spacing: 2) {
            ForEach(Array(["Today", "Week", "Month"].enumerated()), id: \.offset) { index, title in
                Button {
                    withAnimation(.easeInOut(duration: 0.2)) { period = index }
                    #if os(watchOS)
                    WKInterfaceDevice.current().play(.click)
                    #endif
                } label: {
                    Text(title)
                        .font(.system(size: 11, weight: period == index ? .bold : .semibold, design: .rounded))
                        .foregroundStyle(period == index ? Color.white : Color.white.opacity(0.75))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 4)
                        .background(Capsule().fill(period == index ? CrooBrand.teal : Color.clear))
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(period == index ? .isSelected : [])
            }
        }
        .padding(2)
        .background(Capsule().fill(CrooBrand.card))
    }

    private func scoreboard(_ p: WatchSalesPeriod) -> some View {
        VStack(spacing: 5) {
            Text(p.label ?? "SALES")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .tracking(0.8)
                .opacity(0.88)
            Text(p.sales ?? "—")
                .font(.system(size: 34, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.5)

            if p.status != nil || p.vsLy != nil {
                HStack(spacing: 4) {
                    if let status = p.status {
                        chip(text: status, icon: statusIcon(status))
                    }
                    if let vs = p.vsLy {
                        chip(text: vs, icon: (p.vsLyUp ?? true) ? "arrow.up.right" : "arrow.down.right")
                    }
                }
            }

            HStack(spacing: 0) {
                scoreStat("Last Year", p.lastYear)
                stripDivider(opacity: 0.22)
                scoreStat("Goal", p.goal)
                stripDivider(opacity: 0.22)
                scoreStat("Pace", p.pace)
            }
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 13, style: .continuous)
                    .fill(Color.black.opacity(0.13))
            )
            .padding(.top, 2)
        }
        .padding(.horizontal, 8)
        .padding(.top, 10)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .foregroundStyle(.white)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(CrooBrand.orange)
        )
    }

    private func statusIcon(_ status: String) -> String {
        switch status {
        case "On Fire": return "flame.fill"
        case "Behind": return "exclamationmark.circle"
        default: return "waveform.path.ecg"
        }
    }

    private func chip(text: String, icon: String) -> some View {
        HStack(spacing: 3) {
            Image(systemName: icon)
                .font(.system(size: 8, weight: .bold))
            Text(text)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 6)
        .padding(.vertical, 2)
        .background(Capsule().fill(Color.white.opacity(0.2)))
        .overlay(Capsule().stroke(Color.white.opacity(0.3), lineWidth: 1))
    }

    private func scoreStat(_ label: String, _ value: String?) -> some View {
        VStack(spacing: 1) {
            Text(label)
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .opacity(0.88)
                .lineLimit(1)
            Text(value ?? "—")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
        }
        .frame(maxWidth: .infinity)
    }

    private func stripDivider(opacity: Double) -> some View {
        Rectangle()
            .fill(Color.white.opacity(opacity))
            .frame(width: 1, height: 22)
    }

    private func statStrip(_ items: [(String, String?)], background: Color, labelOpacity: Double) -> some View {
        HStack(spacing: 0) {
            ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                if index > 0 { stripDivider(opacity: 0.2) }
                VStack(spacing: 1) {
                    Text(item.1 ?? "—")
                        .font(.system(size: 15, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.6)
                    Text(item.0)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .opacity(labelOpacity)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.vertical, 8)
        .foregroundStyle(.white)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(background)
        )
    }

    private var toDateCard: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("TO DATE")
                .font(.system(size: 9, weight: .bold, design: .rounded))
                .tracking(0.7)
                .foregroundStyle(.secondary)
            toDateRow("Week to date", summary?.wtd)
            toDateRow("Month to date", summary?.mtd)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(CrooBrand.card)
        )
    }

    private func toDateRow(_ label: String, _ value: String?) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(label)
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(Color.white.opacity(0.8))
            Spacer(minLength: 4)
            Text(value ?? "—")
                .font(.system(size: 14, weight: .heavy, design: .rounded))
                .monospacedDigit()
        }
    }

    /// "2026-10-15T06:32:10.123Z" → "11:32 PM" in the watch's time zone.
    static func timeLabel(_ iso: String) -> String {
        let withFraction = ISO8601DateFormatter()
        withFraction.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        let plain = ISO8601DateFormatter()
        guard let date = withFraction.date(from: iso) ?? plain.date(from: iso) else { return "" }
        let out = DateFormatter()
        out.dateFormat = "h:mm a"
        return out.string(from: date)
    }
}
