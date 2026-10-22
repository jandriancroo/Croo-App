import ActivityKit
import AppIntents
import SwiftUI
import WidgetKit

// The Theo call as a Live Activity: Dynamic Island (compact, expanded, minimal) and Lock Screen.
// Data comes from TheoCallManager in the app; Mute / End run the shared LiveActivityIntents.

private let theoOrange = Color(red: 0.92, green: 0.49, blue: 0.24)
private let theoTeal = Color(red: 0.31, green: 0.70, blue: 0.78)

private func statusText(_ s: TheoCallAttributes.ContentState) -> String {
    if s.muted && s.phase == "listening" { return "Muted" }
    switch s.phase {
    case "connecting": return "Connecting…"
    case "listening": return "Listening…"
    case "hearing": return "Hearing you…"
    case "thinking": return "Checking…"
    case "speaking": return "Theo"
    case "error": return "Couldn't connect"
    default: return "Theo"
    }
}

private func statusColor(_ s: TheoCallAttributes.ContentState) -> Color {
    switch s.phase {
    case "speaking": return theoOrange
    case "error": return .red
    default: return theoTeal
    }
}

/// Little sound bars; heights change by phase (Live Activities can't animate continuously).
private struct TheoBars: View {
    let state: TheoCallAttributes.ContentState
    var body: some View {
        let heights: [CGFloat] = {
            switch state.phase {
            case "speaking": return [7, 14, 20, 11, 16]
            case "listening": return state.muted ? [3, 3, 3, 3, 3] : [5, 9, 13, 8, 10]
            case "hearing": return [10, 18, 22, 15, 19]
            case "thinking": return [6, 6, 6, 6, 6]
            default: return [4, 6, 8, 6, 4]
            }
        }()
        HStack(spacing: 2) {
            ForEach(0..<heights.count, id: \.self) { i in
                Capsule().fill(statusColor(state)).frame(width: 3, height: heights[i])
            }
        }
        .animation(.easeInOut(duration: 0.3), value: state.phase)
    }
}

@available(iOS 17.0, *)
private struct TheoCallButtons: View {
    let state: TheoCallAttributes.ContentState
    var body: some View {
        HStack(spacing: 10) {
            Button(intent: MuteTheoCallIntent()) {
                Label(state.muted ? "Unmute" : "Mute", systemImage: state.muted ? "mic.slash.fill" : "mic.fill")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
            }
            .tint(Color(white: 0.25))
            Button(intent: EndTheoCallIntent()) {
                Label("End", systemImage: "xmark")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .frame(maxWidth: .infinity)
            }
            .tint(.red)
        }
        .buttonStyle(.borderedProminent)
        .buttonBorderShape(.capsule)
    }
}

@available(iOS 17.0, *)
struct TheoCallLiveActivity: Widget {
    var body: some WidgetConfiguration {
        ActivityConfiguration(for: TheoCallAttributes.self) { context in
            // Lock Screen / banner
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 12) {
                    TheoOrbView().frame(width: 48, height: 48)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(statusText(context.state)).font(.system(size: 16, weight: .bold, design: .rounded))
                        Text("Crew HQ · \(context.attributes.storeName)")
                            .font(.system(size: 12, design: .rounded)).foregroundStyle(.secondary)
                    }
                    Spacer()
                    TheoBars(state: context.state)
                }
                if !context.state.caption.isEmpty {
                    Text(context.state.caption)
                        .font(.system(size: 13, design: .rounded))
                        .lineLimit(2)
                }
                TheoCallButtons(state: context.state)
            }
            .padding(16)
            .activityBackgroundTint(Color(red: 0.06, green: 0.12, blue: 0.14).opacity(0.85))
            .activitySystemActionForegroundColor(.white)
            .foregroundStyle(.white)
        } dynamicIsland: { context in
            DynamicIsland {
                DynamicIslandExpandedRegion(.leading) {
                    TheoOrbView().frame(width: 56, height: 56).padding(.leading, 4)
                }
                DynamicIslandExpandedRegion(.center) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Theo").font(.system(size: 16, weight: .bold, design: .rounded))
                        Text("\(statusText(context.state)) · \(context.attributes.storeName)")
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(statusColor(context.state))
                            .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
                DynamicIslandExpandedRegion(.trailing) {
                    Text(context.attributes.startedAt, style: .timer)
                        .font(.system(size: 12, design: .rounded).monospacedDigit())
                        .foregroundStyle(.secondary)
                        .frame(width: 44)
                }
                DynamicIslandExpandedRegion(.bottom) {
                    VStack(alignment: .leading, spacing: 10) {
                        if !context.state.caption.isEmpty {
                            Text("“\(context.state.caption)”")
                                .font(.system(size: 13, design: .rounded))
                                .lineLimit(2)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        TheoCallButtons(state: context.state)
                    }
                }
            } compactLeading: {
                TheoOrbView().frame(width: 22, height: 22)
            } compactTrailing: {
                TheoBars(state: context.state)
            } minimal: {
                TheoOrbView().frame(width: 20, height: 20)
            }
            .keylineTint(theoTeal)
        }
    }
}
