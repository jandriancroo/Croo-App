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
        NavigationStack {
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
        .navigationTitle("Sales")
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(store.currentLocationName)
                .font(.system(size: 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.secondary)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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

    /// Activity-style rings: outer orange = sales vs goal, inner teal = pace vs goal.
    private func scoreboard(_ p: WatchSalesPeriod) -> some View {
        let goal = p.goalValue ?? 0
        let salesFrac = goal > 0 ? (p.salesValue ?? 0) / goal : 0
        let paceFrac = goal > 0 ? (p.paceValue ?? 0) / goal : 0
        return VStack(spacing: 6) {
            Text(p.label ?? "SALES")
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .tracking(0.8)
                .foregroundStyle(CrooBrand.orange)
            ZStack {
                RingShape(color: CrooBrand.orange, fraction: salesFrac, width: 11)
                    .frame(width: 124, height: 124)
                RingShape(color: CrooBrand.tealBright, fraction: paceFrac, width: 11)
                    .frame(width: 96, height: 96)
                VStack(spacing: 0) {
                    Text(p.sales ?? "—")
                        .font(.system(size: 20, weight: .heavy, design: .rounded))
                        .monospacedDigit()
                        .lineLimit(1)
                        .minimumScaleFactor(0.5)
                    Text(goal > 0 ? "of \(p.goal ?? "—")" : "no goal")
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                }
                .frame(width: 70)
            }
            .padding(.vertical, 2)

            HStack(spacing: 10) {
                legend(CrooBrand.orange, goal > 0 ? "Sales \(Int((salesFrac * 100).rounded()))%" : "Sales")
                legend(CrooBrand.tealBright, goal > 0 ? "Pace \(Int((paceFrac * 100).rounded()))%" : "Pace")
            }

            if p.status != nil || p.vsLy != nil {
                HStack(spacing: 4) {
                    if let status = p.status { chip(text: status, icon: statusIcon(status)) }
                    if let vs = p.vsLy { chip(text: vs, icon: (p.vsLyUp ?? true) ? "arrow.up.right" : "arrow.down.right") }
                }
            }

            HStack(spacing: 0) {
                scoreStat("Last Year", p.lastYear)
                stripDivider(opacity: 0.22)
                scoreStat("Pace", p.pace)
            }
            .padding(.vertical, 6)
            .background(RoundedRectangle(cornerRadius: 13, style: .continuous).fill(Color.white.opacity(0.07)))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity)
        .foregroundStyle(.white)
        .background(RoundedRectangle(cornerRadius: 22, style: .continuous).fill(CrooBrand.card))
    }

    private func legend(_ color: Color, _ text: String) -> some View {
        HStack(spacing: 4) {
            Circle().fill(color).frame(width: 6, height: 6)
            Text(text).font(.system(size: 10, weight: .bold, design: .rounded)).lineLimit(1).minimumScaleFactor(0.7)
        }
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


/// A progress ring that can pass 100% (second lap draws on top, like Activity).
struct RingShape: View {
    let color: Color
    let fraction: Double
    let width: CGFloat

    var body: some View {
        let f = max(0, fraction)
        ZStack {
            Circle().stroke(color.opacity(0.22), lineWidth: width)
            Circle()
                .trim(from: 0, to: min(f, 1))
                .stroke(color, style: StrokeStyle(lineWidth: width, lineCap: .round))
                .rotationEffect(.degrees(-90))
            if f > 1 {
                Circle()
                    .trim(from: 0, to: min(f - 1, 1))
                    .stroke(color.opacity(0.65), style: StrokeStyle(lineWidth: width, lineCap: .round))
                    .rotationEffect(.degrees(-90))
            }
        }
    }
}
