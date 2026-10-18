import Foundation
import AVFoundation
import Combine

// Native Theo voice for Vision Pro, the same path as the web app (see AGENTS.md):
// a 5-minute pass from the theo-voice function, Grok live voice over a WebSocket,
// and every store-data question goes through ai-assistant via the ask_theo tool.

enum TheoPhase: Equatable { case idle, connecting, listening, thinking, speaking, error }

@MainActor
final class TheoVoice: ObservableObject {
    @Published private(set) var phase: TheoPhase = .idle
    @Published private(set) var caption = ""
    @Published private(set) var errorText: String?

    private static let rate: Double = 24000
    private static let maxLive: TimeInterval = 180
    private static let voiceSuffix = "\n\n(Voice mode: answer the whole question. If the answer is a list of people, shifts or items, include every one with its key detail (for a schedule: name and shift time). Keep it compact: round numbers, short lines, no tables. You are talking to a manager with full access, so say names and details plainly.)"

    private var socket: URLSessionWebSocketTask?
    private var audio: TheoAudio?
    private var history: [(q: String, a: String)] = []
    private var responseDone = true
    private var limitTask: Task<Void, Never>?
    private var logId: String?
    private var liveStart: Date?
    private var questions = 0
    private weak var store: VisionStore?

    var isLive: Bool { socket != nil }

    func start(store: VisionStore) async {
        guard socket == nil, let locationId = store.selectedLocationId ?? store.snapshot?.locationId else { return }
        self.store = store
        errorText = nil
        caption = ""
        phase = .connecting

        guard await AVAudioApplication.requestRecordPermission() else {
            fail("Microphone access is off. Turn it on in Settings > Privacy & Security > Microphone.")
            return
        }
        do {
            let pass = try await fetchPass(store: store, locationId: locationId)
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

            audio.onChunk = { [weak ws] b64 in
                let msg = "{\"type\":\"input_audio_buffer.append\",\"audio\":\"\(b64)\"}"
                ws?.send(.string(msg)) { _ in }
            }
            audio.onDrained = { [weak self] in
                Task { @MainActor in self?.playbackDrained() }
            }
            try audio.start()
            audio.setSending(true)
            phase = .listening
            liveStart = Date()
            await startLog(store: store, locationId: locationId)

            limitTask = Task { [weak self] in
                try? await Task.sleep(nanoseconds: UInt64(Self.maxLive * 1_000_000_000))
                self?.stop()
            }
            receiveLoop(ws)
        } catch {
            fail((error as? TheoError)?.message ?? "Theo’s voice isn’t available right now.")
        }
    }

    func stop() {
        limitTask?.cancel()
        limitTask = nil
        socket?.cancel(with: .normalClosure, reason: nil)
        socket = nil
        audio?.stop()
        audio = nil
        if phase != .error { phase = .idle }
        finishLog()
    }

    // MARK: Events

    private func receiveLoop(_ ws: URLSessionWebSocketTask) {
        Task { [weak self] in
            while let self, self.socket === ws {
                do {
                    let msg = try await ws.receive()
                    if case .string(let text) = msg,
                       let data = text.data(using: .utf8),
                       let ev = try? JSONSerialization.jsonObject(with: data) as? [String: Any] {
                        await self.handle(ev)
                    }
                } catch {
                    if self.socket === ws { self.fail("Lost connection to Theo’s voice.") }
                    return
                }
            }
        }
    }

    private func handle(_ ev: [String: Any]) async {
        guard let type = ev["type"] as? String else { return }
        switch type {
        case "response.created":
            responseDone = false
        case "response.output_audio.delta", "response.audio.delta":
            if let b64 = ev["delta"] as? String {
                if phase != .speaking {
                    phase = .speaking
                    audio?.setSending(false) // Theo never hears himself
                }
                audio?.play(base64: b64)
            }
        case "response.output_audio_transcript.delta", "response.audio_transcript.delta":
            if let d = ev["delta"] as? String { caption += d }
        case "response.done":
            responseDone = true
            if audio?.isIdle ?? true { backToListening() }
        case "input_audio_buffer.speech_started":
            audio?.flushPlayback()
            caption = ""
            phase = .listening
        case "response.function_call_arguments.done":
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
            try? await send(["type": "conversation.item.create",
                             "item": ["type": "function_call_output", "call_id": callId, "output": output]])
            try? await send(["type": "response.create"])
        case "error":
            if let e = ev["error"] as? [String: Any], let m = e["message"] as? String { print("[theo-voice]", m) }
        default:
            break
        }
    }

    private func playbackDrained() {
        if responseDone && phase == .speaking { backToListening() }
    }

    private func backToListening() {
        guard socket != nil else { return }
        phase = .listening
        audio?.setSending(true)
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

    private func functionRequest(_ name: String, body: [String: Any], store: VisionStore) async throws -> [String: Any] {
        let token = try await store.userAccessToken()
        guard let url = URL(string: CrooConfig.supabaseURL + "/functions/v1/" + name) else { throw TheoError("Bad URL") }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 60
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("eu-west-2", forHTTPHeaderField: "x-region") // same region the web app uses
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        let (data, _) = try await URLSession.shared.data(for: req)
        return (try JSONSerialization.jsonObject(with: data) as? [String: Any]) ?? [:]
    }

    private func fetchPass(store: VisionStore, locationId: String) async throws -> Pass {
        let d = try await functionRequest("theo-voice", body: ["action": "session", "location_id": locationId], store: store)
        guard let token = d["token"] as? String, !token.isEmpty else {
            throw TheoError(d["error"] as? String ?? "Theo’s voice isn’t available right now.")
        }
        return Pass(token: token,
                    model: d["model"] as? String ?? "grok-voice-latest",
                    voice: d["voice"] as? String ?? "eve",
                    instructions: d["instructions"] as? String ?? "")
    }

    private func askTheo(_ question: String) async -> String {
        guard let store else { return "{\"error\":\"Theo could not reach the store data right now.\"}" }
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
                "location_id": store.selectedLocationId ?? store.snapshot?.locationId ?? "",
                "location_name": store.selectedLocationName,
                "source": "voice",
            ], store: store)
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
    private func startLog(store: VisionStore, locationId: String) async {
        guard let userId = store.userId,
              let token = try? await store.userAccessToken(),
              let url = URL(string: CrooConfig.supabaseURL + "/rest/v1/theo_voice_sessions") else { return }
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        req.setValue("return=representation", forHTTPHeaderField: "Prefer")
        req.httpBody = try? JSONSerialization.data(withJSONObject: ["user_id": userId, "location_id": locationId, "tts_chars": 0])
        if let (data, _) = try? await URLSession.shared.data(for: req),
           let rows = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] {
            logId = rows.first?["id"] as? String
        }
    }

    private func finishLog() {
        guard let id = logId, let start = liveStart, let store else { return }
        let seconds = Int(Date().timeIntervalSince(start).rounded())
        let q = questions
        logId = nil
        liveStart = nil
        questions = 0
        Task {
            guard let token = try? await store.userAccessToken(),
                  let url = URL(string: CrooConfig.supabaseURL + "/rest/v1/theo_voice_sessions?id=eq.\(id)") else { return }
            var req = URLRequest(url: url)
            req.httpMethod = "PATCH"
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(CrooConfig.anonKey, forHTTPHeaderField: "apikey")
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

    var onChunk: (@Sendable (String) -> Void)?
    var onDrained: (@Sendable () -> Void)?

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
        try session.setCategory(.playAndRecord, mode: .voiceChat, options: [])
        try session.setActive(true)

        let input = engine.inputNode
        try? input.setVoiceProcessingEnabled(true) // echo cancellation
        engine.attach(player)
        engine.connect(player, to: engine.mainMixerNode, format: playFormat)

        let inFormat = input.outputFormat(forBus: 0)
        guard let converter = AVAudioConverter(from: inFormat, to: sendFormat) else { throw NSError(domain: "TheoAudio", code: 2) }
        let ratio = sendFormat.sampleRate / inFormat.sampleRate
        input.installTap(onBus: 0, bufferSize: 2048, format: inFormat) { [weak self] buffer, _ in
            guard let self else { return }
            self.lock.lock(); let on = self.sending; self.lock.unlock()
            guard on else { return }
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
            guard err == nil, out.frameLength > 0, let ch = out.int16ChannelData else { return }
            let data = Data(bytes: ch[0], count: Int(out.frameLength) * 2)
            self.onChunk?(data.base64EncodedString())
        }
        engine.prepare()
        try engine.start()
        player.play()
    }

    func play(base64: String) {
        guard let data = Data(base64Encoded: base64), data.count >= 2 else { return }
        let frames = data.count / 2
        guard let buf = AVAudioPCMBuffer(pcmFormat: playFormat, frameCapacity: AVAudioFrameCount(frames)),
              let dst = buf.floatChannelData?[0] else { return }
        buf.frameLength = AVAudioFrameCount(frames)
        data.withUnsafeBytes { raw in
            let src = raw.bindMemory(to: Int16.self)
            for i in 0..<frames { dst[i] = Float(Int16(littleEndian: src[i])) / 32768 }
        }
        lock.lock(); pending += 1; lock.unlock()
        player.scheduleBuffer(buf, completionCallbackType: .dataPlayedBack) { [weak self] _ in
            guard let self else { return }
            self.lock.lock(); self.pending = max(0, self.pending - 1); let left = self.pending; self.lock.unlock()
            if left == 0 { self.onDrained?() }
        }
    }

    func flushPlayback() {
        lock.lock(); pending = 0; lock.unlock()
        player.stop()
        player.play()
    }

    func stop() {
        setSending(false)
        engine.inputNode.removeTap(onBus: 0)
        player.stop()
        engine.stop()
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }
}
