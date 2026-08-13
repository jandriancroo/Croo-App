import SwiftUI

struct CubesView: View {
    @EnvironmentObject var store: WatchDataStore
    @State private var showLocationSwitcher = false

    private let pastelOrange = Color(red: 0.96, green: 0.62, blue: 0.38)

    var body: some View {
        Group {
            if !store.isPaired && store.snapshot.cubes.isEmpty {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if store.snapshot.cubes.isEmpty {
                ZStack(alignment: .top) {
                    pastelOrange.ignoresSafeArea()
                    VStack(spacing: 8) {
                        locationPill
                        EmptyStateView(
                            title: "No Cubes Yet",
                            message: "Set up your Data Cubes on the iPhone app. They appear here automatically."
                        )
                        .foregroundStyle(.white)
                    }
                }
            } else {
                ZStack(alignment: .top) {
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

                    locationPill
                        .padding(.top, 1)
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
            HStack(spacing: 3) {
                Text(name)
                    .font(.system(size: 10, weight: .bold))
                    .lineLimit(1)
                Image(systemName: "chevron.down")
                    .font(.system(size: 7, weight: .bold))
                    .opacity(0.75)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 9)
            .padding(.vertical, 3)
            .background(Capsule().fill(Color.black.opacity(0.22)))
        }
        .buttonStyle(.plain)
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
        .padding(.top, 18)
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
                .font(.system(size: 9, weight: .semibold))
                .opacity(showUpArrow ? 0.3 : 0)
                .frame(height: 6)

            HStack(alignment: .center, spacing: 4) {
                VStack(alignment: .leading, spacing: 0) {
                    Text(cubeTitle.uppercased())
                        .font(.system(size: 10, weight: .heavy))
                        .tracking(0.5)
                        .lineLimit(1)
                    if !face.title.isEmpty {
                        Text(face.title)
                            .font(.system(size: 8, weight: .semibold))
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
            .padding(.bottom, 1)

            metricsLayout
                .frame(maxWidth: .infinity, maxHeight: .infinity)

            Image(systemName: "chevron.compact.down")
                .font(.system(size: 9, weight: .semibold))
                .opacity(showDownArrow ? 0.3 : 0)
                .frame(height: 6)
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
            metricCell(metrics[0], size: 42)
        case 2:
            HStack(spacing: 0) {
                metricCell(metrics[0], size: 34)
                verticalDivider
                metricCell(metrics[1], size: 34)
            }
        case 3:
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    metricCell(metrics[0], size: 30)
                    verticalDivider
                    metricCell(metrics[1], size: 30)
                }
                horizontalDivider
                metricCell(metrics[2], size: 32)
            }
        default:
            VStack(spacing: 0) {
                HStack(spacing: 0) {
                    metricCell(metrics.count > 0 ? metrics[0] : nil, size: 28)
                    verticalDivider
                    metricCell(metrics.count > 1 ? metrics[1] : nil, size: 28)
                }
                horizontalDivider
                HStack(spacing: 0) {
                    metricCell(metrics.count > 2 ? metrics[2] : nil, size: 28)
                    verticalDivider
                    metricCell(metrics.count > 3 ? metrics[3] : nil, size: 28)
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
                    .minimumScaleFactor(0.35)
                    .lineLimit(1)
                Text(metric.label)
                    .font(.system(size: 12, weight: .semibold))
                    .opacity(0.85)
                    .lineLimit(1)
                Spacer(minLength: 0)
            } else {
                Spacer(minLength: 0)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
        .padding(.horizontal, 5)
    }

    private var verticalDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.25))
            .frame(width: 1)
            .padding(.vertical, 4)
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

#Preview("Cube face") {
    CubeScreen(
        cube: WatchCube(
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
                )
            ]
        ),
        cubeIndex: 0,
        cubeCount: 1
    )
}
