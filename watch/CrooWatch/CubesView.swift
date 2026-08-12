import SwiftUI

/// Mirrors the phone's Data Cubes. Faces are swiped horizontally, cubes vertically.
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
                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(store.snapshot.cubes) { cube in
                            CubeCard(cube: cube)
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("Cubes")
    }
}

private struct CubeCard: View {
    let cube: WatchCube
    @State private var faceIndex: Int = 0

    private var accent: Color { Color(hex: cube.accentColor) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(accent).frame(width: 6, height: 6)
                Text(cube.title.uppercased())
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                Spacer()
                if cube.faces.count > 1 {
                    Text("\(faceIndex + 1)/\(cube.faces.count)")
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(.tertiary)
                }
            }

            if cube.faces.count > 1 {
                TabView(selection: $faceIndex) {
                    ForEach(Array(cube.faces.enumerated()), id: \.offset) { index, face in
                        CubeFaceView(face: face, accent: accent)
                            .tag(index)
                    }
                }
                .tabViewStyle(.page(indexDisplayMode: .never))
                .frame(height: CGFloat(min(cube.faces.map { $0.metrics.count }.max() ?? 1, 4)) * 26 + 16)
            } else if let face = cube.faces.first {
                CubeFaceView(face: face, accent: accent)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [accent.opacity(0.05), accent.opacity(0.14)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(accent.opacity(0.25), lineWidth: 1)
        )
    }
}

private struct CubeFaceView: View {
    let face: WatchCubeFace
    let accent: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !face.title.isEmpty {
                Text(face.title)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundStyle(.tertiary)
                    .lineLimit(1)
                    .padding(.bottom, 4)
            }
            ForEach(Array(face.metrics.enumerated()), id: \.offset) { index, metric in
                if index > 0 {
                    Rectangle()
                        .fill(accent.opacity(0.18))
                        .frame(height: 1)
                        .padding(.vertical, 2)
                }
                HStack(alignment: .firstTextBaseline) {
                    Text(metric.label)
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .lineLimit(1)
                    Spacer(minLength: 4)
                    Text(metric.value)
                        .font(.system(size: 15, weight: .semibold, design: .rounded))
                        .monospacedDigit()
                        .foregroundStyle(accent)
                }
                .padding(.vertical, 1)
            }
        }
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

// MARK: - Preview

#if DEBUG
private struct CubesPreviewCanvas: View {
    private let cubes = [
        WatchCube(
            id: "preview-1",
            title: "Today",
            accentColor: "#2A8399",
            faces: [
                WatchCubeFace(
                    title: "Live Snapshot",
                    metrics: [
                        WatchMetric(label: "Sales", value: "$4,218"),
                        WatchMetric(label: "Pace", value: "+8%"),
                        WatchMetric(label: "Guests", value: "312"),
                        WatchMetric(label: "Avg Ticket", value: "$13.52")
                    ]
                )
            ]
        ),
        WatchCube(
            id: "preview-2",
            title: "D/W/M",
            accentColor: "#EB7D3C",
            faces: [
                WatchCubeFace(
                    title: "Day",
                    metrics: [
                        WatchMetric(label: "Sales", value: "$4,218"),
                        WatchMetric(label: "Labor %", value: "22.4%"),
                        WatchMetric(label: "SPLH", value: "$41.20")
                    ]
                ),
                WatchCubeFace(
                    title: "Week",
                    metrics: [
                        WatchMetric(label: "Sales", value: "$31,405"),
                        WatchMetric(label: "Labor %", value: "24.1%"),
                        WatchMetric(label: "SPLH", value: "$38.75")
                    ]
                )
            ]
        )
    ]

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 10) {
                    ForEach(cubes) { cube in
                        CubeCard(cube: cube)
                    }
                }
                .padding(.horizontal, 4)
                .padding(.bottom, 8)
            }
            .navigationTitle("Cubes")
        }
    }
}

struct CubesView_Previews: PreviewProvider {
    static var previews: some View {
        CubesPreviewCanvas()
            .previewDisplayName("Data Cubes")
    }
}
#endif
