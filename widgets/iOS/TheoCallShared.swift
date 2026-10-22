import Foundation
import ActivityKit
import AppIntents

// Shared by the iPhone app and the CrooWidgets extension (both targets compile this file):
// the Theo call's Live Activity data, and the intents behind Talk to Theo / End / Mute.
// The call engine itself (TheoCall.swift) lives only in the app; the intents reach it through
// TheoCallBridge, which the app fills in at launch. iOS runs these intents in the app's process.

struct TheoCallAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// connecting · listening · thinking · speaking · error · ended
        var phase: String
        var caption: String
        var muted: Bool
    }
    var storeName: String
    var startedAt: Date
}

/// Filled in by the app (TheoCallManager.register) so the shared intents can reach the call.
enum TheoCallBridge {
    static var start: (@MainActor () async -> Void)?
    static var end: (@MainActor () -> Void)?
    static var toggleMute: (@MainActor () -> Void)?
}

/// Talk to Theo without opening the app: he lives in the Dynamic Island while you talk.
/// Action Button, Siri ("talk to Crew HQ") or the Control Center button.
@available(iOS 18.0, *)
struct TalkToTheoIntent: AudioRecordingIntent {
    static var title: LocalizedStringResource = "Talk to Theo"
    static var description = IntentDescription("Talk to Theo without opening Crew HQ. He shows up in the Dynamic Island.")
    static var openAppWhenRun: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        await TheoCallBridge.start?()
        return .result()
    }
}

/// End button on the Live Activity.
@available(iOS 17.0, *)
struct EndTheoCallIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "End Theo"
    static var isDiscoverable: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        TheoCallBridge.end?()
        return .result()
    }
}

/// Mute button on the Live Activity.
@available(iOS 17.0, *)
struct MuteTheoCallIntent: LiveActivityIntent {
    static var title: LocalizedStringResource = "Mute Theo"
    static var isDiscoverable: Bool = false

    @MainActor
    func perform() async throws -> some IntentResult {
        TheoCallBridge.toggleMute?()
        return .result()
    }
}
