import SwiftUI

/// The wall dashboard: read-only, refreshes itself. Layout follows the approved mock-up
/// (1920x1080): sales + labor on the left, hourly chart on the right, who's on and the
/// day's schedule along the bottom.
struct DashboardView: View {
    @EnvironmentObject var store: TVStore
    private var snap: TVSnapshot? { store.snapshot }

    var body: some View {
        VStack(spacing: 28) {
            topBar
            HStack(spacing: 32) {
                VStack(spacing: 20) {
                    SalesHero(period: snap?.salesSummary?.today, chip: snap?.paceChip)
                    LaborCard(period: snap?.salesSummary?.today)
                        .frame(height: 170)
                }
                .frame(width: 600)
                HourlyCard(snap: snap)
            }
            .frame(height: 520)
            HStack(spacing: 32) {
                OnClockCard(snap: snap).frame(width: 600)
                ScheduleCard(snap: snap)
            }
            .frame(maxHeight: .infinity)
        }
        .padding(.horizontal, 64)
        .padding(.vertical, 48)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TVColor.bg)
        .overlay {
            if snap == nil {
                VStack(spacing: 12) {
                    ProgressView()
                    if let e = store.errorText { Text(e).foregroundStyle(TVColor.muted) }
                }
            }
        }
    }

    private var topBar: some View {
        HStack {
            HStack(spacing: 14) {
                Circle().fill(TVColor.teal).frame(width: 14, height: 14)
                Text(snap?.locationName ?? store.selectedLocationName)
                    .font(.system(size: 30, weight: .bold)).foregroundStyle(TVColor.text)
                if let s = snap, !s.updatedLabel.isEmpty {
                    Text("Live · updated \(s.updatedLabel)")
                        .font(.system(size: 24, weight: .semibold)).foregroundStyle(TVColor.muted)
                }
            }
            Spacer()
            TimelineView(.periodic(from: .now, by: 1)) { context in
                HStack(alignment: .firstTextBaseline, spacing: 24) {
                    Text(context.date.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day()))
                        .font(.system(size: 26, weight: .semibold)).foregroundStyle(TVColor.muted)
                    Text(context.date.formatted(.dateTime.hour().minute()))
                        .font(.system(size: 56, weight: .heavy)).foregroundStyle(TVColor.text)
                }
            }
        }
        .frame(height: 72)
    }
}

// MARK: - Cards

private struct Card: ViewModifier {
    var padding: CGFloat = 30
    func body(content: Content) -> some View {
        content
            .padding(padding)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(TVColor.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(TVColor.border, lineWidth: 1))
    }
}

private extension View {
    func card(padding: CGFloat = 30) -> some View { modifier(Card(padding: padding)) }
}

private struct CardTitle: View {
    let text: String
    var body: some View {
        Text(text).font(.system(size: 22, weight: .heavy)).tracking(2).foregroundStyle(TVColor.muted)
    }
}

struct SalesHero: View {
    let period: TVPeriod?
    let chip: (text: String, good: Bool)?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CardTitle(text: "SALES TODAY")
            Spacer(minLength: 0)
            Text(TVFormat.money(period?.salesValue))
                .font(.system(size: 160, weight: .heavy))
                .minimumScaleFactor(0.5).lineLimit(1)
                .foregroundStyle(.white)
            Spacer(minLength: 0)
            HStack {
                (Text("of ").foregroundColor(TVColor.soft)
                 + Text(TVFormat.money(period?.goalValue)).foregroundColor(.white).fontWeight(.heavy)
                 + Text(" goal").foregroundColor(TVColor.soft))
                    .font(.system(size: 30, weight: .semibold))
                Spacer()
                if let chip {
                    Text(chip.text)
                        .font(.system(size: 24, weight: .heavy))
                        .foregroundStyle(TVColor.bg)
                        .padding(.horizontal, 20).padding(.vertical, 8)
                        .background(chip.good ? TVColor.teal : TVColor.orange, in: Capsule())
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(TVColor.grid)
                    Capsule().fill(TVColor.teal).frame(width: geo.size.width * (period?.progress ?? 0))
                }
            }
            .frame(height: 14)
            .padding(.top, 14)
        }
        .card(padding: 30)
    }
}

struct LaborCard: View {
    let period: TVPeriod?

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                CardTitle(text: "LABOR")
                Text(TVFormat.percent(period?.laborPercentValue))
                    .font(.system(size: 92, weight: .heavy))
                    .foregroundStyle(TVColor.orange)
                    .minimumScaleFactor(0.6).lineLimit(1)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 6) {
                if let g = period?.laborGoalText {
                    Text(g).font(.system(size: 26, weight: .semibold)).foregroundStyle(TVColor.muted)
                }
                if let gap = period?.laborGapText {
                    Text(gap).font(.system(size: 32, weight: .heavy)).foregroundStyle(.white)
                }
            }
        }
        .card(padding: 28)
    }
}

struct HourlyCard: View {
    let snap: TVSnapshot?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                CardTitle(text: "SALES & LABOR BY HOUR")
                Spacer()
                HStack(spacing: 26) {
                    legend(color: TVColor.bar, text: "Projected", dash: false, bar: true)
                    legend(color: .white, text: "Actual", dash: false, bar: true)
                    legend(color: TVColor.orange, text: "Labor %", dash: false, bar: false)
                    legend(color: TVColor.teal, text: snap?.salesSummary?.today?.laborGoalText ?? "Goal", dash: true, bar: false)
                }
            }
            HourlyChart(hours: snap?.hourly ?? [], laborGoal: snap?.salesSummary?.today?.laborGoalPct)
        }
        .card(padding: 28)
    }

    @ViewBuilder
    private func legend(color: Color, text: String, dash: Bool, bar: Bool) -> some View {
        HStack(spacing: 8) {
            if bar {
                RoundedRectangle(cornerRadius: 4).fill(color).frame(width: 16, height: 16)
            } else if dash {
                Rectangle().stroke(color, style: StrokeStyle(lineWidth: 3, dash: [5, 3])).frame(width: 22, height: 3)
            } else {
                Capsule().fill(color).frame(width: 22, height: 4)
            }
            Text(text).font(.system(size: 20, weight: .semibold)).foregroundStyle(TVColor.soft)
        }
    }
}

struct OnClockCard: View {
    let snap: TVSnapshot?

    var body: some View {
        let people = Array((snap?.onNow ?? []).prefix(4))
        VStack(alignment: .leading, spacing: 4) {
            CardTitle(text: "ON THE CLOCK · \(snap?.onNow.count ?? 0)")
                .padding(.bottom, 6)
            ForEach(Array(people.enumerated()), id: \.offset) { _, p in
                HStack(spacing: 16) {
                    Text(String(p.displayName.prefix(1)))
                        .font(.system(size: 18, weight: .heavy)).foregroundStyle(.white)
                        .frame(width: 36, height: 36).background(TVColor.tealDeep, in: Circle())
                    Text(p.displayName).font(.system(size: 28, weight: .bold)).foregroundStyle(TVColor.text).lineLimit(1)
                    if let r = p.role, !r.isEmpty {
                        Text(r).font(.system(size: 22, weight: .semibold)).foregroundStyle(TVColor.muted).lineLimit(1)
                    }
                    Spacer()
                    if let e = p.endMin {
                        Text("until \(TVFormat.clock(e))").font(.system(size: 22, weight: .semibold)).foregroundStyle(TVColor.soft)
                    }
                }
                .frame(height: 48)
            }
            Spacer(minLength: 0)
            if let n = snap?.nextIn, let s = n.startMin {
                (Text("Next in: ").foregroundColor(TVColor.muted)
                 + Text(n.displayName).foregroundColor(.white).fontWeight(.heavy)
                 + Text(" · \(TVFormat.clock(s))").foregroundColor(TVColor.muted))
                    .font(.system(size: 22, weight: .semibold))
            }
        }
        .card(padding: 24)
    }
}

struct ScheduleCard: View {
    let snap: TVSnapshot?
    private let labelW: CGFloat = 130

    var body: some View {
        let shifts = (snap?.shifts ?? [])
            .filter { $0.startMin != nil && $0.endMin != nil }
            .sorted { ($0.startMin ?? 0) < ($1.startMin ?? 0) }
        let rows = Array(shifts.prefix(5))
        let startH = rows.map { Int(($0.startMin ?? 600) / 60) }.min() ?? 10
        let endRaw = rows.map { Int((($0.endMin ?? 1320) / 60).rounded(.up)) }.max() ?? 22
        let endH = max(endRaw, startH + 6)
        let span = Double(max(endH - startH, 1) * 60)
        let lo = Double(startH * 60)

        VStack(alignment: .leading, spacing: 4) {
            CardTitle(text: "TODAY'S SCHEDULE").frame(height: 30)
            HStack(spacing: 0) {
                Spacer().frame(width: labelW)
                ForEach(startH..<endH, id: \.self) { h in
                    Text(TVFormat.hourLabel(h)).font(.system(size: 18, weight: .semibold)).foregroundStyle(TVColor.muted)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .frame(height: 26)
            ZStack(alignment: .topLeading) {
                VStack(spacing: 4) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { _, s in
                        HStack(spacing: 0) {
                            Text(s.displayName).font(.system(size: 22, weight: .bold))
                                .foregroundStyle(s.isOn || (s.startMin ?? 0) <= (snap?.nowMin ?? 0) ? TVColor.text : TVColor.muted)
                                .lineLimit(1).frame(width: labelW, alignment: .leading)
                            GeometryReader { geo in
                                let sMin = s.startMin ?? 0
                                let eRaw = s.endMin ?? 0
                                let eMin = eRaw < sMin ? eRaw + 1440 : eRaw
                                let x = geo.size.width * CGFloat(max((sMin - lo) / span, 0))
                                let w = geo.size.width * CGFloat(min(max((eMin - sMin) / span, 0.02), 1))
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(TVColor.tealDeep.opacity((snap?.nowMin ?? 0) < sMin ? 0.4 : 1))
                                    .frame(width: w, height: geo.size.height - 12)
                                    .offset(x: x, y: 6)
                            }
                        }
                        .frame(height: 40)
                    }
                }
                // "now" marker
                GeometryReader { geo in
                    let gridW = geo.size.width - labelW
                    let x = labelW + gridW * CGFloat(min(max(((snap?.nowMin ?? lo) - lo) / span, 0), 1))
                    Rectangle().fill(Color.white.opacity(0.85)).frame(width: 3)
                        .offset(x: x)
                }
            }
            Spacer(minLength: 0)
        }
        .card(padding: 24)
    }
}
