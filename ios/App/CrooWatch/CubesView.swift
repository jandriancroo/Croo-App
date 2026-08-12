import SwiftUI

struct CubesView: View {
    @EnvironmentObject var store: WatchDataStore

    var body: some View {
        Group {
            if store.snapshot.cubes.isEmpty {
                EmptyStateView(
                    title: "No Cubes Yet",
                    message: "Set up your Data Cubes on the iPhone app. They appear here automatically."
                )
            } else {
                TabView {
                    ForEach(Array(store.snapshot.cubes.enumerated()), id: \.element.id) { index, cube in
                        CubeScreen(
                            cube: cube,
                            cubeIndex: index,
                            cubeCount: store.snapshot.cubes.count
                        )
                    }
                }
                .tabViewStyle(.verticalPage)
            }
        }
    }
}

private struct CubeScreen: View {
    let cube: WatchCube
    let cubeIndex: Int
    let cubeCount: Int

    @State private var faceIndex = 0
    @State private var isPaused = false

    private let pastelOrange = Color(red: 0.96, green: 0.62, blue: 0.38)
    private let rotateInterval: TimeInterval = 10

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
            isPaused: isPaused,
            showUpArrow: cubeIndex > 0,
            showDownArrow: cubeIndex < cubeCount - 1
        )
        .background(pastelOrange)
        .containerBackground(pastelOrange.gradient, for: .tabView)
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
    let showUpArrow: Bool
    let showDownArrow: Bool

    private var metrics: [WatchMetric] {
        face.metrics.filter { !$0.value.isEmpty }
    }

    var body: some View {
        VStack(spacing: 0) {
            Image(systemName: "chevron.compact.up")
                .font(.system(size: 10, weight: .semibold))
                .opacity(showUpArrow ? 0.35 : 0)
                .frame(height: 8)

            HStack(alignment: .center, spacing: 4) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(cubeTitle.uppercased())
                        .font(.system(size: 11, weight: .heavy))
                        .tracking(0.5)
                        .lineLimit(1)
                    if !face.title.isEmpty {
                        Text(face.title)
                            .font(.system(size: 9, weight: .semibold))
                            .opacity(0.75)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 2)
                if faceCount > 1 {
                    HStack(spacing: 2) {
                        ForEach(0..<faceCount, id: \.self) { i in
                            Capsule()
                                .fill(Color.white.opacity(i == faceIndex ? 1.0 : 0.3))
                                .frame(width: i == faceIndex ? 8 : 5, height: 2)
                        }
                    }
                }
                if isPaused {
                    Image(systemName: "pause.fill")
                        .font(.system(size: 7, weight: .bold))
                }
            }
            .padding(.horizontal, 6)
            .padding(.bottom, 2)

            metricsLayout
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Image(systemName: "chevron.compact.down")
                .font(.system(size: 10, weight: .semibold))
                .opacity(showDownArrow ? 0.35 : 0)
                .frame(height: 8)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    @ViewBuilder
    private var metricsLayout: some View {
        switch metrics.count {
        case 0:
            EmptyView()
        case 1:
            metricCell(metrics[0], size: 36)
        case 2:
            HStack(spacing: 0) {
                metricCell(metrics[0], size: 30)
                verticalDivider
                metricCell(metrics[1], size: 30)
            }
        case 3:
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    metricCell(metrics[0], size: 26)
                    verticalDivider
                    metricCell(metrics[1], size: 26)
                }
                horizontalDivider
                metricCell(metrics[2], size: 28)
            }
        default:
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    metricCell(metrics.count > 0 ? metrics[0] : nil, size: 24)
                    verticalDivider
                    metricCell(metrics.count > 1 ? metrics[1] : nil, size: 24)
                }
                horizontalDivider
                HStack(spacing: 0) {
                    metricCell(metrics.count > 2 ? metrics[2] : nil, size: 24)
                    verticalDivider
                    metricCell(metrics.count > 3 ? metrics[3] : nil, size: 24)
                }
            }
        }
    }

    private func metricCell(_ metric: WatchMetric?, size: CGFloat) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            if let metric, !metric.value.isEmpty {
                Spacer(minLength: 0)
                Text(metric.value)
                    .font(.system(size: size, weight: .bold, design: .rounded))
                    .monospacedDigit()
                    .minimumScaleFactor(0.4)
                    .lineLimit(1)
                Text(metric.label)
                    .font(.system(size: 11, weight: .semibold))
                    .opacity(0.85)
                    .lineLimit(1)
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 6)
    }

    private var verticalDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.25))
            .frame(width: 1)
            .padding(.vertical, 6)
    }

    private var horizontalDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.25))
            .frame(height: 1)
            .padding(.horizontal, 4)
    }
}

struct EmptyStateView: View {
    let title: String
    let message: String

    var body: some View {
        VStack(spacing: 6) {
            Text(title)
                .font(.system(size: 14, weight: .semibold))
            Text(message)
                .font(.system(size: 11))
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
        }
        .padding()
    }
}

#Preview {
    let store = WatchDataStore.shared
    store.snapshot = WatchSnapshot(
        updatedAt: "2026-08-12T15:00:00Z",
        locationName: "Hemet #12",
        cubes: [
            WatchCube(
                id: "weekly",
                title: "Weekly Sales",
                accentColor: "#E8833A",
                faces: [
                    WatchCubeFace(
                        title: "This Week",
                        metrics: [
                            WatchMetric(label: "WTD", value: "$5,448"),
                            WatchMetric(label: "EOW Goal", value: "$20,195"),
                            WatchMetric(label: "Wkly Pace", value: "$19,719"),
                            WatchMetric(label: "SWLY", value: "$21,160")
                        ]
                    ),
                    WatchCubeFace(
                        title: "Labor",
                        metrics: [
                            WatchMetric(label: "Lab%", value: "24.1%"),
                            WatchMetric(label: "Hrs", value: "186")
                        ]
                    )
                ]
            ),
            WatchCube(
                id: "monthly",
                title: "D/W/M",
                accentColor: "#E8833A",
                faces: [
                    WatchCubeFace(
                        title: "Monthly",
                        metrics: [
                            WatchMetric(label: "MTD", value: "$32.8k"),
                            WatchMetric(label: "Pace", value: "$89.7k"),
                            WatchMetric(label: "SMLY", value: "$95.2k")
                        ]
                    )
                ]
            )
        ],
        schedule: [],
        sales: []
    )
    store.hasData = true
    return CubesView()
        .environmentObject(store)
}
