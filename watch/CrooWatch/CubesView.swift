import SwiftUI

/// CrooHQ brand colors for the watch (mirrors src/index.css tokens).
enum CrooBrand {
    static let orange = Color(hex: "#EB7D3C")      // --accent
    static let teal = Color(hex: "#2A8399")        // --primary
    static let tealBright = Color(hex: "#4FB3C8")  // teal that reads on black
    static let tealDeep = Color(hex: "#16343B")    // "you" card on black
    static let card = Color(white: 0.11)
    static let cardDim = Color(white: 0.07)
    static let avatar = Color(white: 0.17)
    static let green = Color(red: 0.19, green: 0.82, blue: 0.35)
    static let amber = Color(red: 1.0, green: 0.62, blue: 0.04)
}

/// Data Cubes: each cube fills the whole watch face in its own color, laid out
/// like the PWA's DataCube3D face (2×2 corners, optional 5th metric in the center,
/// fading crosshair dividers). Swipe up/down between cubes, tap to flip faces.
struct CubesView: View {
    @EnvironmentObject var store: WatchDataStore
    @State private var showLocationSwitcher = false

    var body: some View {
        Group {
            if !store.isPaired && store.snapshot.cubes.isEmpty {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if store.snapshot.cubes.isEmpty {
                ZStack(alignment: .top) {
                    CrooBrand.teal.ignoresSafeArea()
                    VStack(spacing: 8) {
                        locationPill
                        EmptyStateView(
                            title: "No Cubes Yet",
                            message: "Add Data Cubes to your CrooHQ dashboard. They appear here automatically."
                        )
                    }
                    .foregroundStyle(.white)
                }
            } else {
                ZStack(alignment: .top) {
                    TabView {
                        ForEach(Array(store.snapshot.cubes.enumerated()), id: \.element.id) { _, cube in
                            CubeScreen(cube: cube)
                        }
                    }
                    .tabViewStyle(.verticalPage)
                }
                // The pill sits in the clock area above the safe area. Hits only register inside a
                // view's own frame, so let this overlay extend into the top safe area (it was shifted
                // out with a negative padding before, where taps were ignored).
                .overlay(alignment: .top) {
                    locationPill
                        .padding(.top, 2)
                        .frame(maxWidth: .infinity, alignment: .center)
                        .ignoresSafeArea(edges: .top)
                }
            }
        }
        .sheet(isPresented: $showLocationSwitcher) {
            LocationSwitcherView()
                .environmentObject(store)
        }
    }

    private var locationPill: some View {
        let name = store.currentLocationName.isEmpty ? "Location" : store.currentLocationName
        return Button {
            showLocationSwitcher = true
        } label: {
            HStack(spacing: 4) {
                Text(name)
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                Image(systemName: "chevron.down")
                    .font(.system(size: 9, weight: .bold))
                    .opacity(0.8)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 5)
            .background(Capsule().fill(Color.black.opacity(0.16)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Switch location, current \(name)")
    }
}

private struct CubeScreen: View {
    let cube: WatchCube

    @State private var faceIndex = 0
    @State private var isPaused = false

    private let rotateInterval: TimeInterval = 10

    @EnvironmentObject private var store: WatchDataStore

    private var accent: Color { Color(hex: cube.accentColor) }

    /// Today's sales ÷ goal, but only when this cube actually shows sales.
    private var goalFraction: Double? {
        let showsSales = cube.faces.contains { f in f.metrics.contains { $0.label.lowercased().contains("sales") } }
        guard showsSales, let t = store.snapshot.salesSummary?.today,
              let sales = t.salesValue, let goal = t.goalValue, goal > 0 else { return nil }
        return sales / goal
    }

    var body: some View {
        let safeIndex = cube.faces.isEmpty ? 0 : min(faceIndex, cube.faces.count - 1)
        let face = cube.faces.isEmpty
            ? WatchCubeFace(title: "", metrics: [])
            : cube.faces[safeIndex]

        CubeFacePage(
            cubeTitle: cube.title,
            face: face,
            faceIndex: safeIndex,
            faceCount: max(cube.faces.count, 1),
            isPaused: isPaused
        )
        .background(accent.ignoresSafeArea())
        .contentShape(Rectangle())
        .onTapGesture {
            guard !isPaused, cube.faces.count > 1 else { return }
            withAnimation(.easeInOut(duration: 0.25)) {
                faceIndex = (faceIndex + 1) % cube.faces.count
            }
            #if os(watchOS)
            WKInterfaceDevice.current().play(.click)
            #endif
        }
        .onLongPressGesture(minimumDuration: 0.45) {
            withAnimation(.easeInOut(duration: 0.2)) {
                isPaused.toggle()
            }
            #if os(watchOS)
            WKInterfaceDevice.current().play(isPaused ? .click : .success)
            #endif
        }
        .onReceive(Timer.publish(every: rotateInterval, on: .main, in: .common).autoconnect()) { _ in
            guard !isPaused, cube.faces.count > 1 else { return }
            withAnimation(.easeInOut(duration: 0.35)) {
                faceIndex = (faceIndex + 1) % cube.faces.count
            }
        }
    }
}

private struct CubeFacePage: View {
    let cubeTitle: String
    let face: WatchCubeFace
    let faceIndex: Int
    let faceCount: Int
    let isPaused: Bool

    private var metrics: [WatchMetric] {
        Array(face.metrics.filter { !$0.value.isEmpty }.prefix(5))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .bottom, spacing: 4) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(cubeTitle.uppercased())
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .tracking(0.7)
                        .lineLimit(1)
                        .minimumScaleFactor(0.7)
                    if !face.title.isEmpty {
                        Text(face.title)
                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                            .opacity(0.75)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 2)
                if isPaused {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 7, weight: .bold))
                        .padding(.bottom, 3)
                }
                if faceCount > 1 {
                    HStack(spacing: 2) {
                        ForEach(0..<faceCount, id: \.self) { i in
                            Capsule()
                                .fill(Color.white.opacity(i == faceIndex ? 1.0 : 0.4))
                                .frame(width: i == faceIndex ? 9 : 3, height: 3)
                        }
                    }
                    .padding(.bottom, 4)
                }
            }

            metricsLayout
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .padding(.horizontal, 12)
        .padding(.top, 2)
        .padding(.bottom, 6)
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var metricsLayout: some View {
        switch metrics.count {
        case 0:
            Text("No metrics")
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .opacity(0.75)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        case 1:
            cell(metrics[0], align: .leading, size: 34)
        case 2:
            ZStack {
                GlowLine(vertical: true, centerGap: false)
                HStack(spacing: 10) {
                    cell(metrics[0], align: .leading, size: 24)
                    cell(metrics[1], align: .trailing, size: 24)
                }
            }
        case 3:
            ZStack {
                GlowLine(vertical: false, centerGap: false)
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        cell(metrics[0], align: .leading, size: 21)
                        cell(metrics[1], align: .trailing, size: 21)
                    }
                    cell(metrics[2], align: .leading, size: 24)
                }
            }
        default:
            let hasCenter = metrics.count == 5
            ZStack {
                GlowLine(vertical: true, centerGap: hasCenter)
                GlowLine(vertical: false, centerGap: hasCenter)
                VStack(spacing: 0) {
                    HStack(spacing: 10) {
                        cell(metrics[0], align: .leading, size: 20, vAlign: hasCenter ? .top : .center)
                        cell(metrics[1], align: .trailing, size: 20, vAlign: hasCenter ? .top : .center)
                    }
                    HStack(spacing: 10) {
                        cell(metrics[2], align: .leading, size: 20, vAlign: hasCenter ? .bottom : .center)
                        cell(metrics[3], align: .trailing, size: 20, vAlign: hasCenter ? .bottom : .center)
                    }
                }
                if hasCenter {
                    centerPill(metrics[4])
                }
            }
        }
    }

    private func cell(_ metric: WatchMetric, align: HorizontalAlignment, size: CGFloat,
                      vAlign: VerticalAlignment = .center) -> some View {
        VStack(alignment: align, spacing: 1) {
            Text(metric.value)
                .font(.system(size: size, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.45)
            Text(metric.label)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .opacity(0.72)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .multilineTextAlignment(align == .trailing ? .trailing : .leading)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: Alignment(horizontal: align, vertical: vAlign))
        .padding(.vertical, 2)
    }

    private func centerPill(_ metric: WatchMetric) -> some View {
        VStack(spacing: 0) {
            Text(metric.value)
                .font(.system(size: 16, weight: .heavy, design: .rounded))
                .monospacedDigit()
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(metric.label)
                .font(.system(size: 9, weight: .semibold, design: .rounded))
                .opacity(0.75)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.black.opacity(0.16))
        )
        .frame(maxWidth: 96)
    }
}

/// The PWA cube divider: a thin white line that fades out at both ends with a
/// soft glow; with a center metric it also fades out around the middle.
private struct GlowLine: View {
    let vertical: Bool
    let centerGap: Bool

    private var stops: [Gradient.Stop] {
        let c = Color.white.opacity(0.28)
        if centerGap {
            return [
                .init(color: .clear, location: 0),
                .init(color: c, location: 0.15),
                .init(color: c, location: 0.27),
                .init(color: .clear, location: 0.4),
                .init(color: .clear, location: 0.6),
                .init(color: c, location: 0.73),
                .init(color: c, location: 0.85),
                .init(color: .clear, location: 1),
            ]
        }
        return [
            .init(color: .clear, location: 0),
            .init(color: c, location: 0.2),
            .init(color: c, location: 0.8),
            .init(color: .clear, location: 1),
        ]
    }

    var body: some View {
        Rectangle()
            .fill(LinearGradient(stops: stops,
                                 startPoint: vertical ? .top : .leading,
                                 endPoint: vertical ? .bottom : .trailing))
            .frame(width: vertical ? 1 : nil, height: vertical ? nil : 1)
            .shadow(color: Color.white.opacity(0.25), radius: 3)
            .padding(vertical ? Edge.Set.vertical : Edge.Set.horizontal, 4)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
            Text(message)
                .font(.system(size: 11, design: .rounded))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview("Cube face — 5 metrics") {
    CubeScreen(
        cube: WatchCube(
            id: "main",
            title: "Main",
            accentColor: "#2A8399",
            faces: [
                WatchCubeFace(
                    title: "Daily",
                    metrics: [
                        WatchMetric(label: "Sales", value: "$2,184"),
                        WatchMetric(label: "Pace", value: "$3,512"),
                        WatchMetric(label: "AI Goal", value: "$3,400"),
                        WatchMetric(label: "SDLW", value: "$3,288"),
                        WatchMetric(label: "vs SDLY", value: "+6.2%")
                    ]
                ),
                WatchCubeFace(title: "", metrics: [
                    WatchMetric(label: "Guests", value: "128"),
                    WatchMetric(label: "Pizzas", value: "142")
                ])
            ]
        )
    )
}
