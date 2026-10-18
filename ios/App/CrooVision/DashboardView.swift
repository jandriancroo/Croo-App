import SwiftUI

enum VPeriodChoice: String, CaseIterable, Identifiable {
    case today = "Today", week = "Week", month = "Month"
    var id: String { rawValue }
}

struct DashboardView: View {
    @EnvironmentObject var store: VisionStore
    @Environment(\.openWindow) private var openWindow
    @State private var period: VPeriodChoice = .today

    private var snap: VSnapshot? { store.snapshot }
    private var current: VPeriod? {
        switch period {
        case .today: return snap?.salesSummary?.today
        case .week: return snap?.salesSummary?.week
        case .month: return snap?.salesSummary?.month
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            header
            HStack(alignment: .top, spacing: 20) {
                SalesCard(period: current, title: period.rawValue.uppercased())
                LaborCard(period: current)
                OnNowCard(snap: snap)
            }
            .frame(height: 250)
            HStack(alignment: .top, spacing: 20) {
                TimelineCard(snap: snap)
                    .frame(maxWidth: .infinity)
                EventsCard(snap: snap)
                    .frame(width: 340)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(32)
        .overlay {
            if snap == nil {
                VStack(spacing: 12) {
                    ProgressView()
                    if let e = store.errorText { Text(e).foregroundStyle(.secondary) }
                }
            }
        }
        .ornament(attachmentAnchor: .scene(.bottom)) {
            HStack(spacing: 14) {
                Button {
                    openWindow(id: "theo")
                } label: {
                    Label("Ask Theo", systemImage: "waveform")
                        .font(.title3.weight(.semibold))
                        .padding(.horizontal, 10)
                }
                .buttonStyle(.borderedProminent)
                .tint(VColor.orange)
                .controlSize(.extraLarge)
            }
            .padding(14)
            .glassBackgroundEffect()
        }
    }

    private var header: some View {
        HStack(alignment: .center, spacing: 18) {
            VStack(alignment: .leading, spacing: 4) {
                Menu {
                    ForEach(store.locations) { loc in
                        Button(loc.name) { store.selectLocation(loc.id) }
                    }
                    Divider()
                    Button("Unpair this Vision Pro", role: .destructive) { store.signOut() }
                } label: {
                    HStack(spacing: 8) {
                        Text(snap?.locationName ?? store.selectedLocationName)
                            .font(.extraLargeTitle2)
                        Image(systemName: "chevron.down").font(.title3.weight(.bold)).foregroundStyle(.secondary)
                    }
                }
                .buttonStyle(.plain)
                if let s = snap, !s.updatedLabel.isEmpty {
                    Text("Updated \(s.updatedLabel)").font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Picker("Period", selection: $period) {
                ForEach(VPeriodChoice.allCases) { Text($0.rawValue).tag($0) }
            }
            .pickerStyle(.segmented)
            .frame(width: 320)
            Button {
                Task { await store.refresh() }
            } label: {
                Image(systemName: "arrow.clockwise")
            }
            .buttonBorderShape(.circle)
        }
    }
}

// MARK: - Cards

private struct CardBackground: ViewModifier {
    func body(content: Content) -> some View {
        content
            .padding(24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(.black.opacity(0.22), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
    }
}

private extension View {
    func card() -> some View { modifier(CardBackground()) }
}

private struct CardTitle: View {
    let text: String
    let color: Color
    var body: some View {
        Text(text).font(.caption.weight(.bold)).tracking(1.2).foregroundStyle(color)
    }
}

struct SalesCard: View {
    let period: VPeriod?
    let title: String

    var body: some View {
        HStack(spacing: 24) {
            ZStack {
                Circle().stroke(VColor.orange.opacity(0.22), lineWidth: 16)
                Circle()
                    .trim(from: 0, to: period?.progress ?? 0)
                    .stroke(VColor.orange, style: StrokeStyle(lineWidth: 16, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                Text(period?.percentOfGoal ?? "—").font(.title.weight(.bold))
            }
            .frame(width: 150, height: 150)
            VStack(alignment: .leading, spacing: 8) {
                CardTitle(text: "SALES · \(title)", color: VColor.orange)
                Text(VFormat.money(period?.salesValue))
                    .font(.system(size: 44, weight: .bold, design: .rounded))
                    .minimumScaleFactor(0.6).lineLimit(1)
                Text("of \(VFormat.money(period?.goalValue)) goal").foregroundStyle(.secondary)
                HStack(spacing: 18) {
                    stat("PACE", VFormat.money(period?.paceValue))
                    if let ly = period?.lastYear, ly != "—" { stat("LAST YEAR", ly) }
                }
            }
        }
        .card()
    }

    private func stat(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label).font(.caption2.weight(.bold)).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.semibold))
        }
    }
}

struct LaborCard: View {
    let period: VPeriod?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            CardTitle(text: "LABOR", color: VColor.teal)
            Text(VFormat.percent(period?.laborPercentValue))
                .font(.system(size: 54, weight: .bold, design: .rounded))
                .foregroundStyle(period?.laborColor ?? VColor.teal)
            Capsule()
                .fill(period?.laborColor ?? VColor.teal)
                .frame(height: 8)
            if let g = period?.laborGoalText {
                Text(g).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .card()
        .frame(width: 280)
    }
}

struct OnNowCard: View {
    let snap: VSnapshot?
    private let maxRows = 5

    var body: some View {
        let on = snap?.onNow ?? []
        VStack(alignment: .leading, spacing: 10) {
            CardTitle(text: "ON THE CLOCK", color: VColor.green)
            if on.isEmpty {
                Text("Nobody clocked in").foregroundStyle(.secondary)
            } else {
                ForEach(Array(on.prefix(maxRows).enumerated()), id: \.offset) { _, s in
                    HStack(spacing: 10) {
                        Circle().fill(s.tint).frame(width: 10, height: 10)
                        Text(s.displayName).font(.headline).lineLimit(1)
                        Spacer(minLength: 6)
                        if let start = s.startMin {
                            Text("@\(VFormat.clock(start))").font(.callout).foregroundStyle(.secondary)
                        }
                    }
                }
                if on.count > maxRows {
                    Text("+\(on.count - maxRows) more").font(.callout).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 0)
        }
        .card()
        .frame(width: 320)
    }
}

struct TimelineCard: View {
    let snap: VSnapshot?

    var body: some View {
        let shifts = (snap?.shifts ?? []).filter { $0.startMin != nil && $0.endMin != nil }
        let lo = max(0, (shifts.compactMap { $0.startMin }.min() ?? 360) - 30)
        let hi = min(1440, (shifts.compactMap { $0.endMin }.max() ?? 1380) + 30)
        let span = max(hi - lo, 60)
        let now = snap?.nowMin ?? 0

        VStack(alignment: .leading, spacing: 12) {
            HStack {
                CardTitle(text: "SCHEDULE · TODAY", color: VColor.teal)
                Spacer()
                Text("\(snap?.scheduleSummary?.onNow ?? 0) on · \(snap?.scheduleSummary?.later ?? 0) later")
                    .font(.callout).foregroundStyle(.secondary)
            }
            if shifts.isEmpty {
                Text("No shifts scheduled today").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(Array(shifts.enumerated()), id: \.offset) { _, s in
                            HStack(spacing: 12) {
                                Text(s.displayName).font(.callout.weight(.medium)).lineLimit(1)
                                    .frame(width: 150, alignment: .leading)
                                GeometryReader { geo in
                                    let x = (s.startMin! - lo) / span * geo.size.width
                                    let w = max((s.endMin! - s.startMin!) / span * geo.size.width, 8)
                                    Capsule().fill(s.tint)
                                        .frame(width: w, height: 18)
                                        .offset(x: x)
                                        .frame(maxHeight: .infinity, alignment: .center)
                                }
                                .frame(height: 22)
                            }
                        }
                    }
                    .overlay(alignment: .topLeading) {
                        GeometryReader { geo in
                            let barX = 162.0
                            let width = geo.size.width - barX
                            if now >= lo && now <= hi {
                                Rectangle().fill(.white)
                                    .frame(width: 2)
                                    .offset(x: barX + (now - lo) / span * width)
                            }
                        }
                        .allowsHitTesting(false)
                    }
                }
                HStack {
                    Spacer().frame(width: 162)
                    Text(VFormat.clock(lo)); Spacer(); Text(VFormat.clock((lo + hi) / 2)); Spacer(); Text(VFormat.clock(hi))
                }
                .font(.caption).foregroundStyle(.secondary)
            }
        }
        .card()
    }
}

struct EventsCard: View {
    let snap: VSnapshot?

    var body: some View {
        let events = snap?.events ?? []
        let now = snap?.nowMin ?? 0
        let nextId = snap?.nextEventId
        VStack(alignment: .leading, spacing: 12) {
            CardTitle(text: "EVENTS · TODAY", color: VColor.teal)
            if events.isEmpty {
                Text("No events today").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(events.enumerated()), id: \.offset) { _, e in
                            let isNext = e.id == nextId
                            HStack(spacing: 12) {
                                Capsule().fill(e.tint).frame(width: 5, height: 28)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(e.displayTitle).font(isNext ? .headline : .body).lineLimit(1)
                                    Text(e.timeLabel ?? "").font(.callout)
                                        .foregroundStyle(isNext ? VColor.orange : .secondary)
                                }
                                Spacer(minLength: 0)
                                if isNext {
                                    Text("NEXT").font(.caption2.weight(.bold))
                                        .padding(.horizontal, 8).padding(.vertical, 4)
                                        .background(VColor.orange, in: Capsule())
                                }
                            }
                            .opacity((e.startMin ?? now) < now && !isNext ? 0.45 : 1)
                        }
                    }
                }
            }
        }
        .card()
    }
}
