import Foundation
import ActivityKit
import AppIntents

// Shared by the iPhone app and the CrooWidgets extension (both targets compile this file):
// the Theo call's Live Activity data, and the intents behind Talk to Theo / End / Mute.
// The call engine itself (TheoCall.swift) lives only in the app; the intents reach it through
// TheoCallBridge, which the app fills in at launch. iOS runs these intents in the app's process.

struct TheoCallAttributes: ActivityAttributes {
    public struct ContentState: Codable, Hashable {
        /// connecting · listening · hearing · thinking · speaking · error · ended
        var phase: String
        var caption: String
        var muted: Bool
        /// Ticks about once a second while someone is talking, so the bars move (Live Activities can't animate on their own).
        var pulse: Int = 0
        /// Theo offered to open Crew HQ (for a change): the card shows an "Open Crew HQ" button.
        var offerOpen: Bool = false
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

/// Backup path for End / Mute: if iOS runs the button's intent in the widget extension (where the call
/// isn't), it rings this bell instead and the app hears it. Darwin notifications cross processes.
enum TheoCallSignal {
    static let end = "com.croohq.kitchenmate.theo.end"
    static let mute = "com.croohq.kitchenmate.theo.mute"
    static func post(_ name: String) {
        CFNotificationCenterPostNotification(CFNotificationCenterGetDarwinNotifyCenter(),
                                             CFNotificationName(name as CFString), nil, nil, true)
    }
}

/// Talk to Theo without opening the app: he lives in the Dynamic Island while you talk.
/// Action Button, Siri ("talk to Crew HQ") or the Control Center button.
@available(iOS 18.0, *)
struct TalkToTheoIntent: AudioRecordingIntent, LiveActivityIntent {
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
        if let end = TheoCallBridge.end { end() } else { TheoCallSignal.post(TheoCallSignal.end) }
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
        if let mute = TheoCallBridge.toggleMute { mute() } else { TheoCallSignal.post(TheoCallSignal.mute) }
        return .result()
    }
}
