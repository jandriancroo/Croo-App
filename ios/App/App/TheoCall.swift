import Foundation
import AVFoundation
import ActivityKit

// Native Theo voice for the iPhone's background call (Action Button / Siri / Control Center),
// copied from the Vision Pro engine. Same path as the web app (see AGENTS.md):
// a 5-minute pass from the theo-voice function, Grok live voice over a WebSocket,
// and every store-data question goes through ai-assistant via the ask_theo tool.

enum TheoPhase: Equatable { case idle, connecting, listening, thinking, speaking, error }

@MainActor
final class PhoneTheoVoice {
    /// Called whenever phase / caption / mute changes (the call manager updates the Live Activity).
    var onChange: (() -> Void)?
    /// Called once when the call is over (ended, limit reached, or failed).
    var onEnded: (() -> Void)?

    private(set) var phase: TheoPhase = .idle { didSet { if phase != oldValue { onChange?() } } }
    private(set) var caption = "" { didSet { onChange?() } }
    private(set) var errorText: String?
    private(set) var muted = false { didSet { onChange?() } }
    /// Theo offered to open CrooHQ for a change (shows the Open CrooHQ button).
    private(set) var offerOpen = false { didSet { if offerOpen != oldValue { onChange?() } } }
    private(set) var micLevel: Double = 0
    /// True while the server hears you talking (shows "Hearing you…").
    private(set) var hearing = false { didSet { if hearing != oldValue { onChange?() } } }
    /// Troubleshooting line, shown on the Live Activity while it's waiting for you (temporary).
    private(set) var debugLine = ""
    private var chunks = 0
    private var events = 0
    private var lastEvent = ""

    private static let rate: Double = 24000
    private static let maxLive: TimeInterval = 180
    /// Hands stays in the app: on this call Theo offers to open CrooHQ instead of making changes.
    private static let noChangesNote = "\n\nIMPORTANT, this overrides anything above about making changes: on this call (outside the app) you cannot make or preview changes. If the manager asks you to create, change, send, clock, nudge or post anything, don't describe a preview and never say \"confirm on screen\". Say: \"I can't make changes from here. Want me to open the CrooHQ app to do that?\" If they say yes, call offer_open_app, then tell them to tap Open CrooHQ. Questions about the store you answer normally with ask_theo. The app is written CrooHQ and said \"crew H Q\"."

    private static let voiceSuffix = "\n\n(Voice mode: answer the whole question. If the answer is a list of people, shifts or items, include every one with its key detail (for a schedule: name and shift time). Keep it compact: round numbers, short lines, no tables. You are talking to a manager with full access, so say names and details plainly.)"

    private var socket: URLSessionWebSocketTask?
    private var audio: TheoAudio?
    private var early: EarlyAudio?
    private var connectStart: Date?
    private var history: [(q: String, a: String)] = []
    private var responseDone = true
    private var spokeThisResponse = false
    private var limitTask: Task<Void, Never>?
    private var logId: String?
    private var liveStart: Date?
    private var questions = 0
    let locationId: String
    let locationName: String

    init(locationId: String, locationName: String) {
        self.locationId = locationId
        self.locationName = locationName
    }

    var isLive: Bool { socket != nil }

    /// Mute: Theo stops hearing you until you unmute (he can still finish talking).
    func toggleMute() {
        muted.toggle()
        if muted { audio?.setSending(false) } else if phase == .listening { audio?.setSending(true) }
    }

    func start() async {
        guard socket == nil else { return }
        errorText = nil
        caption = ""
        phase = .connecting

        guard await AVAudioApplication.requestRecordPermission() else {
            fail("Microphone access is off. Turn it on in Settings > Privacy & Security > Microphone.")
            return
        }
        do {
            // Mic and the "ready" cue start immediately; Theo's connection comes up behind it
            // (4-6 s on a cold start). Anything you say meanwhile is held and sent the moment he's connected.
            connectStart = Date()
            // Get Theo's pass (a ready one if we have it) while the mic starts, and warm up the line to xAI.
            let passTask = Task { try await Self.takePass(locationId: self.locationId) }
            Self.warmVoiceLine()
            let audio = try TheoAudio(rate: Self.rate)
            self.audio = audio
            let early = EarlyAudio()
            self.early = early
            audio.onChunk = { [weak self] b64 in
                early.push(b64)
                Task { @MainActor in self?.countChunk() }
            }
            audio.onLevel = nil // no meter on the iPhone call (saves main-thread hops)
            audio.onDrained = { [weak self] in
                Task { @MainActor in self?.playbackDrained() }
            }
            try audio.start()
            audio.setSending(true)
            audio.playCue(.ready) // "I'm listening" (same Wood cue as the web app)
            phase = .listening
            liveStart = Date()

            let pass = try await passTask.value
            guard self.audio === audio else { return } // ended while connecting

            guard let url = URL(string: "wss://api.x.ai/v1/realtime?model=\(pass.model)") else { throw TheoError("Bad voice URL") }
            let ws = URLSession.shared.webSocketTask(with: url, protocols: ["xai-client-secret.\(pass.token)"])
            socket = ws
            ws.resume()

            try await send([
                "type": "session.update",
                "session": [
                    "voice": pass.voice,
                    "instructions": pass.instructions + Self.noChangesNote,
                    "turn_detection": ["type": "server_vad", "silence_duration_ms": 600],
                    "audio": [
                        "input": ["format": ["type": "audio/pcm", "rate": Int(Self.rate)]],
                        "output": ["format": ["type": "audio/pcm", "rate": Int(Self.rate)], "speed": 1.2],
                    ],
                    "tools": [[
                        "type": "function",
                        "name": "offer_open_app",
                        "description": "Call this when the manager wants a change made (a task, shift, event, message, punch, nudge or announcement) and has said yes to opening the CrooHQ app. It puts an Open CrooHQ button on their screen.",
                        "parameters": ["type": "object", "properties": [:]],
                    ], [
                        "type": "function",
                        "name": "ask_theo",
                        "description": "Ask Theo's store-data brain any question about this store (sales, labor, schedule, checklists, tips, reviews, punches, crew). Returns the answer to speak. Before calling ask_theo, say a 2-4 word filler like \"Checking the numbers…\", then call it. Don't repeat the filler after the answer.",
                        "parameters": [
                            "type": "object",
                            "properties": ["question": ["type": "string", "description": "The full question in plain English"]],
                            "required": ["question"],
                        ],
                    ]],
                ],
            ])
            early.attach(ws) // sends what you already said, then streams live
            Task { [weak self] in await self?.startLog(locationId: self?.locationId ?? "") }

            Task { [weak self] in
                while let me = self, me.socket != nil {
                    me.updateDebug()
                    try? await Task.sleep(nanoseconds: 1_000_000_000)
                }
            }
            limitTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.maxLive * 1_000_000_000))
                self?.stop()
            }
            receiveLoop(ws)
        } catch {
            fail((error as? TheoError)?.message ?? error.localizedDescription)
        }
    }

    func stop() {
        limitTask?.cancel()
        limitTask = nil
        let wasLive = socket != nil || audio != nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        early = nil
        if let a = audio {
            audio = nil
            if wasLive {
                a.playCue(.closed) // "bye" cue, then shut the audio down once it has played
                DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { a.stop() }
            } else {
                a.stop()
            }
        }
        if phase != .error { phase = .idle }
        finishLog()
        let ended = onEnded
        onEnded = nil
        ended?()
    }

    // MARK: Events

    private func receiveLoop(_ ws: URLSessionWebSocketTask) {
        Task { [weak self] in
            while true {
                guard let me = self, me.socket === ws else { return }
                do {
                    let msg = try await ws.receive()
                    if case .string(let text) = msg,
                       let data = text.data(using: .utf8),
                       let ev = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        await self?.handle(ev)
                    }
                } catch {
                    let code = ws.closeCode.rawValue
                    let reason = ws.closeReason.flatMap { String(data: $0, encoding: .utf8) } ?? error.localizedDescription
                    if let me = self, me.socket === ws { me.fail("Lost connection to Theo’s voice (\(code)): \(reason)") }
                    return
                }
            }
        }
    }

    private func handle(_ ev: [String: Any]) async {
        guard let type = ev["type"] as? String else { return }
        events += 1
        lastEvent = type
        updateDebug()
        switch type {
        case "response.created":
            hearing = false
            responseDone = false
            spokeThisResponse = false
        case "response.output_audio.delta", "response.audio.delta":
            if let b64 = ev["delta"] as? String {
                spokeThisResponse = true
                if phase != .speaking {
                    phase = .speaking
                    audio?.setSending(false) // Theo never hears himself
                }
                audio?.play(base64: b64)
            }
        case "response.output_audio_transcript.delta", "response.audio_transcript.delta":
            if let d = ev["delta"] as? String { appendCaption(d) }
        case "session.created", "session.updated":
            if let t = connectStart, caption.isEmpty {
                connectStart = nil
                caption = String(format: "Connected in %.1fs", Date().timeIntervalSince(t)) // temporary, to measure
            }
            if let session = ev["session"] as? [String: Any],
               let audioCfg = session["audio"] as? [String: Any],
               let output = audioCfg["output"] as? [String: Any],
               let format = output["format"] as? [String: Any],
               let rate = (format["rate"] as? Double) ?? (format["rate"] as? Int).map(Double.init),
               [8000, 16000, 22050, 24000, 32000, 44100, 48000].contains(rate) {
                audio?.setOutputRate(rate)
            }
        case "response.done":
            responseDone = true
            audio?.endOfResponse() // plays any waiting audio, then reports "drained" when he's done talking
            flushCaption()
        case "input_audio_buffer.speech_started":
            audio?.flushPlayback()
            caption = ""
            captionBuffer = ""
            phase = .listening
            hearing = true
        case "input_audio_buffer.speech_stopped":
            hearing = false
            if phase == .listening { audio?.playCue(.heard) } // "got it"
        case "response.function_call_arguments.done":
            // Looking it up without saying a filler: soft "one sec" double tap.
            if !spokeThisResponse { audio?.playCue(.checking) }
            spokeThisResponse = false
            phase = .thinking
            audio?.setSending(false)
            let callId = ev["call_id"] as? String ?? ""
            var question = ""
            if let args = (ev["arguments"] as? String)?.data(using: .utf8),
               let obj = try? JSONSerialization.jsonObject(with: args) as? [String: Any] {
                question = obj["question"] as? String ?? ""
            }
            let toolName = ev["name"] as? String
            let output: String
            if toolName == "offer_open_app" {
                offerOpen = true
                output = "{\"ok\":true,\"say\":\"Tap Open CrooHQ on your screen and I'll pick it up there.\"}"
            } else if toolName == "ask_theo" && !question.isEmpty {
                output = await askTheo(question)
            } else {
                output = "{\"error\":\"Unknown tool\"}"
            }
            caption = ""
            captionBuffer = ""
            try? await send(["type": "conversation.item.create",
                             "item": ["type": "function_call_output", "call_id": callId, "output": output]])
            try? await send(["type": "response.create"])
        case "error":
            let m = (ev["error"] as? [String: Any])?["message"] as? String ?? "Voice error"
            print("[theo-voice]", m)
            errorText = m
            lastEvent = "error: " + m
            caption = "Problem: " + m
            updateDebug()
        default:
            break
        }
    }

    private func countChunk() {
        chunks += 1
        if chunks % 10 == 0 { updateDebug() }
    }

    private func updateDebug() {
        let line = "sent \(chunks) · events \(events) · last \(lastEvent) · \(audio?.stats ?? "no audio")"
        guard line != debugLine else { return }
        debugLine = line
        print("[theo-call]", line)
    }

    // Caption updates are batched (~7 per second) so the 3D view isn't redrawn on every word.
    private var captionBuffer = ""
    private var captionFlushScheduled = false
    private func appendCaption(_ d: String) {
        captionBuffer += d
        guard !captionFlushScheduled else { return }
        captionFlushScheduled = true
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 150_000_000)
            self?.flushCaption()
        }
    }
    private func flushCaption() {
        captionFlushScheduled = false
        guard !captionBuffer.isEmpty else { return }
        caption += captionBuffer
        captionBuffer = ""
    }

    private func playbackDrained() {
        if responseDone && phase == .speaking { backToListening() }
    }

    private func backToListening() {
        guard socket != nil else { return }
        phase = .listening
        if !muted { audio?.setSending(true) }
    }

    private func fail(_ message: String) {
        errorText = message
        phase = .error
        stop()
    }

    // MARK: Network

    private struct TheoError: Error { let message: String; init(_ m: String) { message = m } }
    struct Pass { let token: String; let model: String; let voice: String; let instructions: String }

    // A pass fetched ahead of time (app opened, or a call just ended). Used once, and only while it
    // has more time left than a call can last (3 min of its 5), so "Talk to Theo" skips the slowest step.
    private static var readyPass: (pass: Pass, locationId: String, at: Date)?
    private static var prefetching = false

    static func takePass(locationId: String) async throws -> Pass {
        if let r = readyPass, r.locationId == locationId, Date().timeIntervalSince(r.at) < 110 {
            readyPass = nil
            return r.pass
        }
        readyPass = nil
        return try await fetchPass(locationId: locationId)
    }

    static func prefetchPass(locationId: String) {
        if let r = readyPass, r.locationId == locationId, Date().timeIntervalSince(r.at) < 90 { return }
        guard !prefetching, NativeAuth.hasSession else { return }
        prefetching = true
        Task {
            defer { prefetching = false }
            if let p = try? await fetchPass(locationId: locationId) { readyPass = (p, locationId, Date()) }
        }
    }

    /// Opens (and caches) the secure connection to xAI while the pass is being fetched.
    nonisolated static func warmVoiceLine() {
        guard let url = URL(string: "https://api.x.ai/") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "HEAD"
        req.timeoutInterval = 5
        URLSession.shared.dataTask(with: req) { _, _, _ in }.resume()
    }

    private func send(_ obj: [String: Any]) async throws {
        guard let ws = socket else { return }
        let data = try JSONSerialization.data(withJSONObject: obj)
        try await ws.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private static func functionRequest(_ name: String, body: [String: Any]) async throws -> [String: Any] {
        let token: String
        do { token = try await NativeAuth.validAccessToken() } catch { throw TheoError("Open CrooHQ once and sign in, then try again.") }
        guard let url = URL(string: NativeAuth.supabaseURL + "/functions/v1/" + name) else { throw TheoError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(NativeAuth.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("eu-west-2", forHTTPHeaderField: "x-region") // same region the web app uses
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private static func fetchPass(locationId: String) async throws -> Pass {
        let d = try await functionRequest("theo-voice", body: ["action": "session", "location_id": locationId])
        guard let token = d["token"] as? String, !token.isEmpty else {
            throw TheoError(d["error"] as? String ?? "Theo’s voice isn’t available right now.")
        }
        return Pass(token: token,
                    model: d["model"] as? String ?? "grok-voice-latest",
                    voice: d["voice"] as? String ?? "eve",
                    instructions: d["instructions"] as? String ?? "")
    }

    private func askTheo(_ question: String) async -> String {
        questions += 1
        var messages: [[String: String]] = []
        for h in history.suffix(6) {
            messages.append(["role": "user", "content": h.q])
            messages.append(["role": "assistant", "content": h.a])
        }
        messages.append(["role": "user", "content": question + Self.voiceSuffix])
        do {
            let d = try await Self.functionRequest("ai-assistant", body: [
                "messages": messages,
                "location_id": locationId,
                "location_name": locationName,
                "source": "voice",
                "no_actions": true, // this call can't confirm changes; Hands lives in the app
            ])
            let answer = d["content"] as? String ?? ""
            if !answer.isEmpty { history = Array((history + [(question, String(answer.prefix(300)))]).suffix(6)) }
            let out = ["answer": answer.isEmpty ? "No answer." : answer]
            let data = try JSONSerialization.data(withJSONObject: out)
            return String(decoding: data, as: UTF8.self)
        } catch {
            return "{\"error\":\"Theo could not reach the store data right now.\"}"
        }
    }

    // Same usage log the web app keeps (theo_voice_sessions: who, which store, how long, how many questions).
    private func startLog(locationId: String) async {
        guard let userId = NativeAuth.userId,
              let token = try? await NativeAuth.validAccessToken(),
              let url = URL(string: NativeAuth.supabaseURL + "/rest/v1/theo_voice_sessions") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(NativeAuth.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("return=representation", forHTTPHeaderField: "Prefer")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["user_id": userId, "location_id": locationId, "tts_chars": 0])
        if let (data, _) = try? await URLSession.shared.data(for: req),
           let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            logId = rows.first?["id"] as? String
        }
    }

    private func finishLog() {
        guard let id = logId, let start = liveStart else { return }
        let seconds = Int(Date().timeIntervalSince(start).rounded())
        let q = questions
        logId = nil
        liveStart = nil
        questions = 0
        Task {
            guard let token = try? await NativeAuth.validAccessToken(),
                  let url = URL(string: NativeAuth.supabaseURL + "/rest/v1/theo_voice_sessions?id=eq.\(id)") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(NativeAuth.anonKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            req.httpBody = try? JSONSerialization.data(withJSONObject: ["seconds": seconds, "questions": q])
            _ = try? await URLSession.shared.data(for: req)
        }
    }
}

// MARK: - Audio (runs on the audio thread, so it stays off the main actor)

/// Holds mic audio said before Theo's connection is up (up to ~15 s), then streams live.
nonisolated final class EarlyAudio: @unchecked Sendable {
    private let lock = NSLock()
    private var held: [String] = []
    private weak var ws: URLSessionWebSocketTask?

    func push(_ b64: String) {
        lock.lock(); defer { lock.unlock() }
        if let ws {
            Self.send(b64, on: ws)
        } else {
            held.append(b64)
            if held.count > 360 { held.removeFirst(held.count - 360) }
        }
    }

    func attach(_ socket: URLSessionWebSocketTask) {
        lock.lock(); defer { lock.unlock() }
        held.forEach { Self.send($0, on: socket) } // in order, before any new audio
        held = []
        ws = socket
    }

    private static func send(_ b64: String, on ws: URLSessionWebSocketTask) {
        ws.send(.string("{\"type\":\"input_audio_buffer.append\",\"audio\":\"\(b64)\"}")) { err in
            if let err { print("[theo-voice] send failed", err) }
        }
    }
}

nonisolated final class TheoAudio: @unchecked Sendable {
    private let engine = AVAudioEngine()
    private let player = AVAudioPlayerNode()
    private let playFormat: AVAudioFormat
    private let sendFormat: AVAudioFormat
    private let lock = NSLock()
    private var sending = false
    private var pending = 0
    private var tapCalls = 0
    private var level: Double = 0
    private var lastLevelSent: CFAbsoluteTime = 0
    private var convertFails = 0
    private var formatInfo = ""
    private var peak: Double = 0      // loudest sample in the current window (0–1)
    private var lastPeak: Double = 0  // loudest sample in the last finished ~1 s window
    private var peakWindowStart: CFAbsoluteTime = 0
    private var voiceProcessing = false
    /// "mic buffers 120 · convert fails 0 · in 48000Hz 1ch" for the troubleshooting line.
    var stats: String {
        lock.lock(); defer { lock.unlock() }
        return "mic \(tapCalls) · loud \(Int((max(lastPeak, peak) * 100).rounded()))% · vp \(voiceProcessing ? "on" : "off") · \(formatInfo)"
    }

    var onChunk: (@Sendable (String) -> Void)?
    var onDrained: (@Sendable () -> Void)?
    var onLevel: (@Sendable (Double) -> Void)?

    init(rate: Double) throws {
        guard let play = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false),
              let sendF = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: rate, channels: 1, interleaved: true) else {
            throw NSError(domain: "TheoAudio", code: 1)
        }
        playFormat = play
        sendFormat = sendF
    }

    var isIdle: Bool { lock.lock(); defer { lock.unlock() }; return pending == 0 }

    func setSending(_ on: Bool) { lock.lock(); sending = on; lock.unlock() }

    func start() throws {
        let session = AVAudioSession.sharedInstance()
        // .voiceChat is the only mode iOS lets a background call activate (.default failed: "Session activation failed").
        // Theo was faint because voiceChat routes to the earpiece, so force the loudspeaker unless headphones/car.
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)
        let onBuiltIn = session.currentRoute.outputs.allSatisfy { $0.portType == .builtInReceiver || $0.portType == .builtInSpeaker }
        if onBuiltIn { try? session.overrideOutputAudioPort(.speaker) }

        let input = engine.inputNode
        // No voice processing: with it on, iOS never opened the mic for a background call (mic 0),
        // and on Vision Pro it handed over silent buffers. Theo is muted while he talks instead.
        voiceProcessing = false
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)
        engine.attach(cuePlayer)
        engine.connect(cuePlayer, to: engine.mainMixerNode, format: TheoCues.format)

        let inFormat = input.outputFormat(forBus: 0)
        formatInfo = "in \(Int(inFormat.sampleRate))Hz \(inFormat.channelCount)ch"
        if inFormat.sampleRate == 0 || inFormat.channelCount == 0 {
            throw NSError(domain: "TheoAudio", code: 3, userInfo: [NSLocalizedDescriptionKey: "The microphone isn't available (\(formatInfo))."])
        }
        guard let converter = AVAudioConverter(from: inFormat, to: sendFormat) else { throw NSError(domain: "TheoAudio", code: 2) }
        let ratio = sendFormat.sampleRate / inFormat.sampleRate
        input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock(); let on = self.sending; self.tapCalls += 1; self.lock.unlock()
            let cap = AVAudioFrameCount(Double(buffer.frameLength) * ratio + 32)
            guard let out = AVAudioPCMBuffer(pcmFormat: self.sendFormat, frameCapacity: cap) else { return }
            var fed = false
            var err: NSError?
            converter.convert(to: out, error: &err) { _, status in
                if fed { status.pointee = .noDataNow; return nil }
                fed = true
                status.pointee = .haveData
                return buffer
            }
            guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else {
                self.lock.lock(); self.convertFails += 1; self.lock.unlock()
                return
            }
            // Small boost so normal talking reaches Theo's "someone is speaking" level (clipped, never wraps).
            let n = Int(out.frameLength)
            for i in 0..<n {
                let v = Int32(ch[0][i]) * 3
                ch[0][i] = Int16(max(-32767, min(32767, v)))
            }
            // Loudness for the on-screen meter, measured on what we actually send.
            var sum: Double = 0
            for i in 0..<n { let v = Double(ch[0][i]) / 32768; sum += v * v }
            let raw = min(1, (sum / Double(n)).squareRoot() * 12)
            var pk: Double = 0
            for i in 0..<n { pk = max(pk, abs(Double(ch[0][i])) / 32768) }
            self.lock.lock()
            self.peak = max(self.peak, pk)
            let tNow = CFAbsoluteTimeGetCurrent()
            if tNow - self.peakWindowStart > 3 { self.lastPeak = self.peak; self.peak = 0; self.peakWindowStart = tNow }
            self.level = self.level * 0.6 + raw * 0.4
            let now = CFAbsoluteTimeGetCurrent()
            let due = now - self.lastLevelSent > 0.066
            if due { self.lastLevelSent = now }
            let lvl = self.level
            self.lock.unlock()
            if due { self.onLevel?(lvl) }
            self.lock.lock(); let gated = CFAbsoluteTimeGetCurrent() < self.micGateUntil; self.lock.unlock()
            guard on, !gated else { return }
            let data = Data(bytes: ch[0], count: n * 2)
            self.onChunk?(data.base64EncodedString())
        }
        engine.prepare()
        try engine.start()
        player.play()
        cuePlayer.play()
    }

    // MARK: Cues ("Wood" taps, generated, same as the web app)

    private let cuePlayer = AVAudioPlayerNode()
    private var micGateUntil: CFAbsoluteTime = 0

    /// Plays a cue and keeps the mic from sending it to Theo (so a cue never counts as you talking).
    func playCue(_ cue: TheoCue) {
        playQueue.async { [weak self] in
            guard let self, let buf = TheoCues.buffer(for: cue) else { return }
            let seconds = Double(buf.frameLength) / TheoCues.format.sampleRate
            self.lock.lock(); self.micGateUntil = CFAbsoluteTimeGetCurrent() + seconds + 0.1; self.lock.unlock()
            self.cuePlayer.scheduleBuffer(buf, completionHandler: nil)
        }
    }

    // Playback runs on its own queue so the main thread (UI, 3D orb) can never starve it.
    private let playQueue = DispatchQueue(label: "theo.playback", qos: .userInteractive)
    private var primed = false
    private var preroll: [AVAudioPCMBuffer] = []
    private var prerollFrames: AVAudioFrameCount = 0
    private var outRate: Double = 24000

    /// Server-confirmed output rate (session.created/updated). Call before the first audio.
    func setOutputRate(_ rate: Double) {
        playQueue.async { [weak self] in
            guard let self, rate > 0, rate != self.outRate,
                  let f = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: rate, channels: 1, interleaved: false) else { return }
            self.outRate = rate
            self.player.stop()
            self.engine.disconnectNodeOutput(self.player)
            self.engine.connect(self.player, to: self.engine.mainMixerNode, format: f)
            self.player.play()
        }
    }

    func play(base64: String) {
        playQueue.async { [weak self] in self?.enqueue(base64) }
    }

    /// Theo finished generating this answer: play whatever is still waiting in the pre-roll.
    func endOfResponse() {
        playQueue.async { [weak self] in
            guard let self else { return }
            self.releasePreroll()
            self.lock.lock(); let left = self.pending; self.lock.unlock()
            if left == 0 { self.onDrained?() } // nothing (left) to play
        }
    }

    private func enqueue(_ base64: String) {
        guard let data = Data(base64Encoded: base64), data.count >= 2,
              let fmt = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: outRate, channels: 1, interleaved: false) else { return }
        let frames = data.count / 2
        guard let buf = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: AVAudioFrameCount(frames)),
              let dst = buf.floatChannelData?[0] else { return }
        buf.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            // About 3x louder for quiet sounds; loud peaks are rounded off (tanh) instead of crackling.
            // voiceChat mode plays at call level, which was too quiet on the loudspeaker.
            let k: Float = 4.5
            for i in 0..<frames { dst[i] = tanhf(k * Float(Int16(littleEndian: src[i])) / 32768) }
        }
        lock.lock(); pending += 1; lock.unlock()
        if primed {
            schedule(buf)
        } else {
            // Collect ~0.25 s before starting so a slow network moment doesn't make him stutter.
            preroll.append(buf)
            prerollFrames += buf.frameLength
            if Double(prerollFrames) >= outRate * 0.25 { releasePreroll() }
        }
    }

    private func releasePreroll() {
        guard !preroll.isEmpty else { return }
        primed = true
        let waiting = preroll
        preroll = []
        prerollFrames = 0
        waiting.forEach(schedule)
    }

    private func schedule(_ buf: AVAudioPCMBuffer) {
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }
            self.lock.lock(); self.pending = max(0, self.pending - 1); let left = self.pending; self.lock.unlock()
            if left == 0 {
                self.playQueue.async { self.primed = false }
                self.onDrained?()
            }
        }
    }

    func flushPlayback() {
        playQueue.async { [weak self] in
            guard let self else { return }
            self.lock.lock(); self.pending = 0; self.lock.unlock()
            self.preroll = []
            self.prerollFrames = 0
            self.primed = false
            self.player.stop()
            self.player.play()
        }
    }

    func stop() {
        setSending(false)
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        cuePlayer.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}

// MARK: - Theo's cues

nonisolated enum TheoCue: Sendable { case ready, heard, closed, checking }

/// Theo's "Wood" cues, rendered in code (same pitches and timing as src/components/ai/theoCues.ts).
nonisolated enum TheoCues {
    static let format = AVAudioFormat(standardFormatWithSampleRate: 48000, channels: 1)!
    private static let lo: Double = 659.25, hi: Double = 830.61

    /// Each cue's taps: (seconds after start, pitch Hz, level).
    private static func taps(_ cue: TheoCue) -> [(Double, Double, Double)] {
        switch cue {
        case .ready: return [(0, lo, 1), (0.085, hi, 1)]
        case .heard: return [(0, hi, 0.55)]
        case .closed: return [(0, hi, 1), (0.1, lo, 1)]
        case .checking: return [(0, lo, 0.45), (0.16, lo, 0.45)]
        }
    }

    static func buffer(for cue: TheoCue) -> AVAudioPCMBuffer? {
        let sr = format.sampleRate
        let list = taps(cue)
        let total = (list.last?.0 ?? 0) + 0.45
        let n = Int(total * sr)
        guard let buf = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(n)),
              let out = buf.floatChannelData?[0] else { return nil }
        buf.frameLength = AVAudioFrameCount(n)
        for i in 0..<n { out[i] = 0 }
        for (start, f, level) in list {
            let s0 = Int(start * sr)
            partial(out, n, s0, sr, f: f, peak: 0.35 * level, dur: 0.32, attack: 0.002, from: f * 1.25, glide: 0.012)
            partial(out, n, s0, sr, f: f * 4, peak: 0.09 * level, dur: 0.07, attack: 0.001, from: nil, glide: 0)
            puff(out, n, s0, sr, dur: 0.014, peak: 0.035 * level)
        }
        // A touch of room (a few soft echoes), like the web version's small reverb.
        let echoes: [(Double, Float)] = [(0.031, 0.10), (0.047, 0.08), (0.067, 0.06), (0.089, 0.04)]
        let dry = Array(UnsafeBufferPointer(start: out, count: n))
        for (d, g) in echoes {
            let off = Int(d * sr)
            if off < n { for i in off..<n { out[i] += dry[i - off] * g } }
        }
        return buf
    }

    private static func partial(_ out: UnsafeMutablePointer<Float>, _ n: Int, _ s0: Int, _ sr: Double,
                                f: Double, peak: Double, dur: Double, attack: Double, from: Double?, glide: Double) {
        var phase = 0.0
        let count = Int(dur * sr)
        for k in 0..<count {
            let i = s0 + k
            if i >= n { break }
            let t = Double(k) / sr
            var freq = f
            if let from, glide > 0, t < glide { freq = from * pow(f / from, t / glide) }
            phase += 2 * .pi * freq / sr
            let env: Double = t < attack
                ? peak * (t / attack)
                : peak * exp(log(0.0001 / peak) * (t - attack) / max(dur - attack, 0.001))
            out[i] += Float(sin(phase) * env)
        }
    }

    private static func puff(_ out: UnsafeMutablePointer<Float>, _ n: Int, _ s0: Int, _ sr: Double, dur: Double, peak: Double) {
        let count = Int(dur * sr)
        for k in 0..<count {
            let i = s0 + k
            if i >= n { break }
            let t = Double(k) / Double(max(count, 1))
            let env = t < 0.35 ? peak * (t / 0.35) : peak * pow(1 - (t - 0.35) / 0.65, 2)
            out[i] += Float(Double.random(in: -1...1) * env)
        }
    }
}

// MARK: - The call: Live Activity + voice, started from the Action Button / Siri / Control Center

/// Runs one Theo call in the background (the app never opens) and mirrors it in a Live Activity:
/// the Dynamic Island and the Lock Screen show the orb, what he's doing, his words, Mute and End.
@available(iOS 18.0, *)
@MainActor
final class TheoCallManager {
    static let shared = TheoCallManager()

    private var voice: PhoneTheoVoice?
    private var activity: Activity<TheoCallAttributes>?
    private var lastPush = Date.distantPast
    private var pendingPush: Task<Void, Never>?

    /// Called once at app launch: lets the shared intents (in widgets/iOS/TheoCallShared.swift) reach this.
    func register() {
        TheoCallBridge.start = { await TheoCallManager.shared.start() }
        TheoCallBridge.end = { TheoCallManager.shared.end() }
        TheoCallBridge.toggleMute = { TheoCallManager.shared.toggleMute() }
        let center = CFNotificationCenterGetDarwinNotifyCenter()
        CFNotificationCenterAddObserver(center, nil, { _, _, name, _, _ in
            let n = name?.rawValue as String?
            Task { @MainActor in
                if n == TheoCallSignal.end { TheoCallManager.shared.end() }
                if n == TheoCallSignal.mute { TheoCallManager.shared.toggleMute() }
            }
        }, TheoCallSignal.end as CFString, nil, .deliverImmediately)
        CFNotificationCenterAddObserver(center, nil, { _, _, name, _, _ in
            let n = name?.rawValue as String?
            Task { @MainActor in
                if n == TheoCallSignal.end { TheoCallManager.shared.end() }
                if n == TheoCallSignal.mute { TheoCallManager.shared.toggleMute() }
            }
        }, TheoCallSignal.mute as CFString, nil, .deliverImmediately)
    }

    var isLive: Bool { voice != nil || starting }

    /// The store a call would use (the paired store, else the first one).
    private static func callStore() -> (id: String, name: String)? {
        let stores = CrooSharedGroup.locations()
        let pairing = CrooSharedGroup.pairing()
        guard let id = pairing?["locationId"] ?? stores.first?.id else { return nil }
        let name = (pairing?["locationName"]).flatMap { $0.isEmpty ? nil : $0 }
            ?? stores.first(where: { $0.id == id })?.name ?? "CrooHQ"
        return (id, name)
    }

    /// Get a pass ready ahead of time (app opened, or a call just ended) so the next call connects faster.
    func prefetch() {
        guard voice == nil, !starting, let store = Self.callStore() else { return }
        PhoneTheoVoice.prefetchPass(locationId: store.id)
    }
    /// True from the button press until the call is up (or has failed). Blocks a second call.
    private var starting = false

    /// One call at a time. Pressing Talk to Theo again while a call is running (or connecting) hangs up.
    func start() async {
        if starting && voice == nil { return } // still setting up: ignore the extra press
        if voice != nil {
            end()
            return
        }
        starting = true
        defer { starting = false }
        let stores = CrooSharedGroup.locations()
        let pairing = CrooSharedGroup.pairing()
        let locationId = pairing?["locationId"] ?? stores.first?.id
        let name = (pairing?["locationName"]).flatMap { $0.isEmpty ? nil : $0 }
            ?? stores.first(where: { $0.id == locationId })?.name ?? "CrooHQ"

        // Start the Live Activity right away (iOS requires it for background recording),
        // then clear any leftover cards from earlier calls without waiting on it.
        startActivity(storeName: name)
        let keep = activity?.id
        Task { for a in Activity<TheoCallAttributes>.activities where a.id != keep { await a.end(nil, dismissalPolicy: .immediate) } }

        guard NativeAuth.hasSession, let locationId else {
            await showProblem("Open CrooHQ once and sign in, then try again.")
            return
        }

        let v = PhoneTheoVoice(locationId: locationId, locationName: name)
        v.onChange = { [weak self] in self?.schedulePush() }
        v.onEnded = { [weak self, weak v] in
            guard let self else { return }
            let message = v?.phase == .error ? v?.errorText : nil
            self.voice = nil
            Task { await self.finishActivity(message: message) }
            if message == nil { self.prefetch() } // ready for a quick follow-up call
        }
        voice = v
        await v.start()
    }

    /// End always works: stops the call if one is running, and clears any leftover card either way.
    func end() {
        if let v = voice {
            v.stop() // its onEnded closes every card
        } else {
            activity = nil
            Task { await Self.endAllActivities() }
        }
    }

    /// Clears every Theo call card (leftovers from a failed or force-quit call).
    static func endAllActivities() async {
        for a in Activity<TheoCallAttributes>.activities {
            await a.end(nil, dismissalPolicy: .immediate)
        }
    }

    func toggleMute() {
        voice?.toggleMute()
    }

    // MARK: Live Activity

    private func startActivity(storeName: String) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let state = TheoCallAttributes.ContentState(phase: "connecting", caption: "", muted: false)
        activity = try? Activity.request(
            attributes: TheoCallAttributes(storeName: storeName, startedAt: Date()),
            content: ActivityContent(state: state, staleDate: nil),
            pushType: nil
        )
    }

    /// Phase changes go out right away; caption changes at most about once a second.
    private func schedulePush() {
        let wait = 1.0 - Date().timeIntervalSince(lastPush)
        if wait <= 0 || voiceStateChangedPhase() {
            pushNow()
            return
        }
        guard pendingPush == nil else { return }
        pendingPush = Task { [weak self] in
            try? await Task.sleep(nanoseconds: UInt64(wait * 1_000_000_000))
            self?.pendingPush = nil
            self?.pushNow()
        }
    }

    private var lastPhase = ""
    private var lastOffer = false
    private var pulse = 0
    private var pulseTask: Task<Void, Never>?

    /// While Theo is talking or hearing you, tick the bars about once a second.
    private func updatePulseLoop() {
        let talking = lastPhase == "speaking" || lastPhase == "hearing"
        if talking, pulseTask == nil {
            pulseTask = Task { [weak self] in
                while !Task.isCancelled {
                    try? await Task.sleep(nanoseconds: 900_000_000)
                    guard let self, !Task.isCancelled else { return }
                    self.pulse += 1
                    self.pushNow()
                }
            }
        } else if !talking, let t = pulseTask {
            t.cancel()
            pulseTask = nil
        }
    }
    private func voiceStateChangedPhase() -> Bool {
        guard let v = voice else { return lastPhase != "" }
        return ((v.phase == .listening && v.hearing) ? "hearing" : Self.name(for: v.phase)) != lastPhase
    }

    private func pushNow() {
        guard let v = voice, let activity else { return }
        lastPush = Date()
        let previous = lastPhase
        lastPhase = (v.phase == .listening && v.hearing) ? "hearing" : Self.name(for: v.phase)
        let caption = String(v.caption.suffix(140))
        let state = TheoCallAttributes.ContentState(phase: lastPhase, caption: caption, muted: v.muted, pulse: pulse, offerOpen: v.offerOpen)
        let content = ActivityContent(state: state, staleDate: nil)
        let newOffer = v.offerOpen && !lastOffer
        lastOffer = v.offerOpen
        if newOffer {
            // Pop the Island open so the Open CrooHQ button is right there.
            let alert = AlertConfiguration(title: "Theo", body: "Open CrooHQ to make that change", sound: .named("theo-silent.wav"))
            Task { await activity.update(content, alertConfiguration: alert) }
        } else if lastPhase == "speaking" && previous != "speaking" {
            // Pops the Dynamic Island open (and lights the Lock Screen) when Theo starts answering.
            // iOS decides how long it stays open; a silent sound so it doesn't ding.
            let alert = AlertConfiguration(title: "Theo", body: "Answering…", sound: .named("theo-silent.wav"))
            Task { await activity.update(content, alertConfiguration: alert) }
        } else {
            Task { await activity.update(content) }
        }
        updatePulseLoop()
    }

    private func finishActivity(message: String?) async {
        pendingPush?.cancel()
        pendingPush = nil
        pulseTask?.cancel()
        pulseTask = nil
        guard let activity else { return }
        self.activity = nil
        lastOffer = false
        if let message {
            let state = TheoCallAttributes.ContentState(phase: "error", caption: message, muted: false)
            await activity.update(ActivityContent(state: state, staleDate: nil))
            try? await Task.sleep(nanoseconds: 4_000_000_000)
        }
        let done = TheoCallAttributes.ContentState(phase: "ended", caption: "", muted: false)
        await activity.end(ActivityContent(state: done, staleDate: nil), dismissalPolicy: .immediate)
        // Never leave a stray card behind (unless a new call started meanwhile).
        if voice == nil && !starting && self.activity == nil { await Self.endAllActivities() }
    }

    private func showProblem(_ message: String) async {
        await finishActivity(message: message)
    }

    static func name(for phase: TheoPhase) -> String {
        switch phase {
        case .idle: return "idle"
        case .connecting: return "connecting"
        case .listening: return "listening"
        case .thinking: return "thinking"
        case .speaking: return "speaking"
        case .error: return "error"
        }
    }
}
