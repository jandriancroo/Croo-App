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
                ChecklistsCard(snap: snap)
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

    /// Same sentence as the web Dash title line; labor turns orange when it's running behind.
    private func paceSentence(_ line: (sales: String?, labor: String?, behind: Bool)) -> some View {
        let laborPart: Text? = line.labor.map {
            Text($0).foregroundStyle(line.behind ? VColor.orange : .primary).fontWeight(line.behind ? .semibold : .regular)
        }
        let text: Text
        switch (line.sales, laborPart) {
        case let (s?, l?): text = Text("\(s), and it looks like you'll end with ") + l + Text(".")
        case let (s?, nil): text = Text("\(s).")
        case let (nil, l?): text = Text("It looks like you'll end with ") + l + Text(".")
        default: text = Text("")
        }
        return text.font(.title3).foregroundStyle(.secondary).lineLimit(2)
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
                if let line = snap?.paceLine {
                    paceSentence(line)
                }
                if let s = snap, !s.updatedLabel.isEmpty {
                    Text("Updated \(s.updatedLabel)").font(.callout).foregroundStyle(.tertiary)
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
    private let nameWidth: CGFloat = 150

    var body: some View {
        let shifts = (snap?.shifts ?? []).filter { $0.startMin != nil && $0.endMin != nil }
        // Whole hours that cover every shift, so the hour line reads cleanly (e.g. 9 AM – 11 PM).
        let lo = floor((shifts.compactMap { $0.startMin }.min() ?? 540) / 60) * 60
        let hi = ceil((shifts.compactMap { $0.endMin }.max() ?? 1320) / 60) * 60
        let span = max(hi - lo, 60)
        let now = snap?.nowMin ?? 0
        let hours = stride(from: lo, through: hi, by: 60).map { $0 }
        let labelEvery = span > 12 * 60 ? 2 : 1 // keep labels from crowding on long days

        VStack(alignment: .leading, spacing: 12) {
            header
            if shifts.isEmpty {
                Text("No shifts scheduled today").foregroundStyle(.secondary)
            } else {
                // Hour line: 9a 10a 11a … over the bars.
                HStack(spacing: 12) {
                    Spacer().frame(width: nameWidth)
                    GeometryReader { geo in
                        ForEach(Array(hours.enumerated()), id: \.offset) { i, h in
                            if i % labelEvery == 0 {
                                Text(VFormat.clock(h))
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                    .fixedSize()
                                    .position(x: (h - lo) / span * geo.size.width, y: 9)
                            }
                        }
                    }
                    .frame(height: 18)
                }
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(Array(shifts.enumerated()), id: \.offset) { _, s in
                            HStack(spacing: 12) {
                                Text(s.displayName).font(.callout.weight(.medium)).lineLimit(1)
                                    .frame(width: nameWidth, alignment: .leading)
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
                    .padding(.vertical, 2)
                    // Faint hour gridlines + the white "now" line, drawn across all rows.
                    .background(alignment: .topLeading) {
                        GeometryReader { geo in
                            let barX = nameWidth + 12
                            let width = geo.size.width - barX
                            ForEach(hours, id: \.self) { h in
                                Rectangle().fill(.white.opacity(0.08))
                                    .frame(width: 1, height: geo.size.height)
                                    .offset(x: barX + (h - lo) / span * width)
                            }
                        }
                        .allowsHitTesting(false)
                    }
                    .overlay(alignment: .topLeading) {
                        GeometryReader { geo in
                            let barX = nameWidth + 12
                            let width = geo.size.width - barX
                            if now >= lo && now <= hi {
                                Rectangle().fill(.white)
                                    .frame(width: 2, height: geo.size.height)
                                    .offset(x: barX + (now - lo) / span * width)
                            }
                        }
                        .allowsHitTesting(false)
                    }
                }
            }
        }
        .card()
    }

    /// "SCHEDULE · TODAY" with today's events as badges on the same row.
    private var header: some View {
        let events = snap?.events ?? []
        let now = snap?.nowMin ?? 0
        let nextId = snap?.nextEventId
        return HStack(spacing: 10) {
            CardTitle(text: "SCHEDULE · TODAY", color: VColor.teal)
            Text("\(snap?.scheduleSummary?.onNow ?? 0) on · \(snap?.scheduleSummary?.later ?? 0) later")
                .font(.caption).foregroundStyle(.secondary)
            if !events.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        ForEach(Array(events.enumerated()), id: \.offset) { _, e in
                            let isNext = e.id == nextId
                            let past = (e.startMin ?? now) < now && !isNext
                            HStack(spacing: 6) {
                                Circle().fill(e.tint).frame(width: 8, height: 8)
                                Text(e.displayTitle).font(.caption.weight(isNext ? .bold : .medium)).lineLimit(1)
                                Text(e.timeLabel ?? "").font(.caption)
                                    .foregroundStyle(isNext ? VColor.orange : .secondary)
                            }
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background(isNext ? VColor.orange.opacity(0.22) : .white.opacity(0.08), in: Capsule())
                            .opacity(past ? 0.45 : 1)
                        }
                    }
                }
                .frame(maxWidth: .infinity)
            } else {
                Spacer()
            }
        }
    }
}

/// Today's checklists with completion, in place of the old events card.
struct ChecklistsCard: View {
    let snap: VSnapshot?

    var body: some View {
        let lists = (snap?.checklists ?? []).sorted { a, b in
            // Unfinished first, then by due time.
            if a.isDone != b.isDone { return !a.isDone }
            return (a.dueBy ?? "99") < (b.dueBy ?? "99")
        }
        let doneCount = lists.filter { $0.isDone }.count
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                CardTitle(text: "CHECKLISTS · TODAY", color: VColor.green)
                Spacer()
                if !lists.isEmpty {
                    Text("\(doneCount)/\(lists.count) done").font(.caption).foregroundStyle(.secondary)
                }
            }
            if lists.isEmpty {
                Text("No checklists due today").foregroundStyle(.secondary)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        ForEach(Array(lists.enumerated()), id: \.offset) { _, c in
                            VStack(alignment: .leading, spacing: 5) {
                                HStack(spacing: 8) {
                                    Image(systemName: c.isDone ? "checkmark.circle.fill" : "circle")
                                        .foregroundStyle(c.isDone ? VColor.green : .secondary)
                                    Text(c.title ?? "Checklist").font(.callout.weight(.medium)).lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text("\(c.done ?? 0)/\(c.total ?? 0)").font(.caption).foregroundStyle(.secondary)
                                }
                                HStack(spacing: 8) {
                                    ProgressView(value: c.progress)
                                        .tint(c.isDone ? VColor.green : VColor.teal)
                                    if let due = c.dueText, !c.isDone {
                                        Text(due).font(.caption2).foregroundStyle(.secondary)
                                    }
                                }
                                .padding(.leading, 26)
                            }
                            .opacity(c.isDone ? 0.6 : 1)
                        }
                    }
                }
            }
        }
        .card()
    }
}
