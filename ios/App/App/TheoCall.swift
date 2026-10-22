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
    private static let voiceSuffix = "\n\n(Voice mode: answer the whole question. If the answer is a list of people, shifts or items, include every one with its key detail (for a schedule: name and shift time). Keep it compact: round numbers, short lines, no tables. You are talking to a manager with full access, so say names and details plainly.)"

    private var socket: URLSessionWebSocketTask?
    private var audio: TheoAudio?
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
            let pass = try await fetchPass(locationId: locationId)
            let audio = try TheoAudio(rate: Self.rate)
            self.audio = audio

            guard let url = URL(string: "wss://api.x.ai/v1/realtime?model=\(pass.model)") else { throw TheoError("Bad voice URL") }
            let ws = URLSession.shared.webSocketTask(with: url, protocols: ["xai-client-secret.\(pass.token)"])
            socket = ws
            ws.resume()

            try await send([
                "type": "session.update",
                "session": [
                    "voice": pass.voice,
                    "instructions": pass.instructions,
                    "turn_detection": ["type": "server_vad", "silence_duration_ms": 600],
                    "audio": [
                        "input": ["format": ["type": "audio/pcm", "rate": Int(Self.rate)]],
                        "output": ["format": ["type": "audio/pcm", "rate": Int(Self.rate)], "speed": 1.2],
                    ],
                    "tools": [[
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

            audio.onChunk = { [weak ws, weak self] b64 in
                let msg = "{\"type\":\"input_audio_buffer.append\",\"audio\":\"\(b64)\"}"
                ws?.send(.string(msg)) { err in
                    if let err { print("[theo-voice] send failed", err) }
                }
                Task { @MainActor in self?.countChunk() }
            }
            audio.onLevel = { [weak self] level in
                Task { @MainActor in self?.micLevel = level }
            }
            audio.onDrained = { [weak self] in
                Task { @MainActor in self?.playbackDrained() }
            }
            try audio.start()
            audio.setSending(true)
            audio.playCue(.ready) // "I'm listening" (same Wood cue as the web app)
            phase = .listening
            liveStart = Date()
            await startLog(locationId: locationId)

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
        let wasLive = socket != nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
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
            let output = (ev["name"] as? String) == "ask_theo" && !question.isEmpty
                ? await askTheo(question)
                : "{\"error\":\"Unknown tool\"}"
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
        if caption.isEmpty { onChange?() } // the Live Activity shows it while there's no caption
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
    private struct Pass { let token: String; let model: String; let voice: String; let instructions: String }

    private func send(_ obj: [String: Any]) async throws {
        guard let ws = socket else { return }
        let data = try JSONSerialization.data(withJSONObject: obj)
        try await ws.send(.string(String(decoding: data, as: UTF8.self)))
    }

    private func functionRequest(_ name: String, body: [String: Any]) async throws -> [String: Any] {
        let token: String
        do { token = try await NativeAuth.validAccessToken() } catch { throw TheoError("Open Crew HQ once and sign in, then try again.") }
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

    private func fetchPass(locationId: String) async throws -> Pass {
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
            let d = try await functionRequest("ai-assistant", body: [
                "messages": messages,
                "location_id": locationId,
                "location_name": locationName,
                "source": "voice",
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
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [.defaultToSpeaker, .allowBluetooth])
        try session.setActive(true)

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
            // Loudness for the on-screen meter, measured on what we actually send.
            let n = Int(out.frameLength)
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
            for i in 0..<frames { dst[i] = Float(Int16(littleEndian: src[i])) / 32768 }
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
    }

    var isLive: Bool { voice != nil }

    func start() async {
        if voice != nil { return } // already talking
        let stores = CrooSharedGroup.locations()
        let pairing = CrooSharedGroup.pairing()
        let locationId = pairing?["locationId"] ?? stores.first?.id
        let name = (pairing?["locationName"]).flatMap { $0.isEmpty ? nil : $0 }
            ?? stores.first(where: { $0.id == locationId })?.name ?? "Crew HQ"

        // The Live Activity has to start right away (iOS requires it for background recording).
        startActivity(storeName: name)

        guard NativeAuth.hasSession, let locationId else {
            await showProblem("Open Crew HQ once and sign in, then try again.")
            return
        }

        let v = PhoneTheoVoice(locationId: locationId, locationName: name)
        v.onChange = { [weak self] in self?.schedulePush() }
        v.onEnded = { [weak self, weak v] in
            guard let self else { return }
            let message = v?.phase == .error ? v?.errorText : nil
            self.voice = nil
            Task { await self.finishActivity(message: message) }
        }
        voice = v
        await v.start()
    }

    func end() {
        voice?.stop()
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
    private func voiceStateChangedPhase() -> Bool {
        guard let v = voice else { return lastPhase != "" }
        return ((v.phase == .listening && v.hearing) ? "hearing" : Self.name(for: v.phase)) != lastPhase
    }

    private func pushNow() {
        guard let v = voice, let activity else { return }
        lastPush = Date()
        lastPhase = (v.phase == .listening && v.hearing) ? "hearing" : Self.name(for: v.phase)
        // While nothing is being said, show the troubleshooting line (temporary, to find the stuck step).
        let caption = v.caption.isEmpty && v.phase == .listening && !v.hearing
            ? v.debugLine
            : String(v.caption.suffix(140))
        let state = TheoCallAttributes.ContentState(phase: lastPhase, caption: caption, muted: v.muted)
        Task { await activity.update(ActivityContent(state: state, staleDate: nil)) }
    }

    private func finishActivity(message: String?) async {
        pendingPush?.cancel()
        pendingPush = nil
        guard let activity else { return }
        self.activity = nil
        if let message {
            let state = TheoCallAttributes.ContentState(phase: "error", caption: message, muted: false)
            await activity.update(ActivityContent(state: state, staleDate: nil))
            try? await Task.sleep(nanoseconds: 4_000_000_000)
        }
        let done = TheoCallAttributes.ContentState(phase: "ended", caption: "", muted: false)
        await activity.end(ActivityContent(state: done, staleDate: nil), dismissalPolicy: .immediate)
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
