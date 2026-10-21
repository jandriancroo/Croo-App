import SwiftUI
import RealityKit

/// Theo as a floating 3D orb: a sphere of glowing dots you can walk around.
/// Turns slowly, breathes while listening (and grows with your voice), pulses while he talks.
/// Caption, status and End float underneath. Same native voice engine as before (TheoVoice).
struct TheoVolume: View {
    @EnvironmentObject var store: VisionStore
    @StateObject private var voice = TheoVoice()
    @State private var orb = Entity()

    var body: some View {
        RealityView { content, attachments in
            buildOrb()
            orb.position = [0, 0.08, 0]
            content.add(orb)
            if let panel = attachments.entity(for: "panel") {
                panel.position = [0, -0.16, 0.02]
                content.add(panel)
            }
        } attachments: {
            Attachment(id: "panel") {
                panel
            }
        }
        .task { await animate() }
        .task {
            if store.hasUserSession { await voice.start(store: store) }
        }
        .onChange(of: store.hasUserSession) { _, signedIn in
            if signedIn { Task { await voice.start(store: store) } }
        }
        .onDisappear { voice.stop() }
    }

    // MARK: Panel under the orb

    @ViewBuilder private var panel: some View {
        VStack(spacing: 10) {
            if !store.hasUserSession {
                TheoSignIn().padding(24).glassBackgroundEffect()
            } else {
                Text(statusText)
                    .font(.title.weight(.bold))
                    .foregroundStyle(voice.phase == .error ? VColor.red : .white)
                    .shadow(radius: 6)
                if !voice.caption.isEmpty {
                    Text(voice.caption)
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .frame(maxWidth: 420)
                        .shadow(radius: 6)
                }
                if voice.isLive {
                    Button(role: .destructive) { voice.stop() } label: {
                        Label("End", systemImage: "xmark")
                    }
                    .controlSize(.large)
                } else {
                    Button { Task { await voice.start(store: store) } } label: {
                        Label("Talk to Theo", systemImage: "waveform")
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(VColor.orange)
                    .controlSize(.large)
                }
            }
        }
        .frame(width: 460)
    }

    private var statusText: String {
        switch voice.phase {
        case .idle: return "Tap to talk"
        case .connecting: return "Connecting…"
        case .listening: return "Listening…"
        case .thinking: return "Checking…"
        case .speaking: return "Theo"
        case .error: return voice.errorText ?? "Theo’s voice isn’t available right now."
        }
    }

    // MARK: 3D orb

    private func buildOrb() {
        guard orb.children.isEmpty else { return }
        let n = 420
        let radius: Float = 0.11
        let golden = Float.pi * (3 - 5.0.squareRoot().float)
        let dot = MeshResource.generateSphere(radius: 0.0032)
        let teal = UnlitMaterial(color: UIColor(red: 0.31, green: 0.70, blue: 0.78, alpha: 1))
        let orange = UnlitMaterial(color: UIColor(red: 0.92, green: 0.49, blue: 0.24, alpha: 1))
        for i in 0..<n {
            let y = 1 - (Float(i) / Float(n - 1)) * 2
            let r = (1 - y * y).squareRoot()
            let th = golden * Float(i)
            let p = SIMD3<Float>(cos(th) * r, y, sin(th) * r) * radius
            let warm = y > 0.55 && p.x > 0 // orange cap, like the 2D orb
            let e = ModelEntity(mesh: dot, materials: [warm ? orange : teal])
            e.position = p
            orb.addChild(e)
        }
    }

    /// ~60 fps turn + breathing/pulse by phase. Runs while the window is open.
    private func animate() async {
        var angle: Float = 0
        var t: Float = 0
        while !Task.isCancelled {
            let phase = voice.phase
            let speed: Float = phase == .thinking ? 1.6 : (phase == .speaking ? 0.9 : 0.35)
            angle += speed / 60
            t += 1 / 60
            let pulse: Float
            switch phase {
            case .speaking: pulse = 1 + 0.06 * sin(t * 9)
            case .listening: pulse = 1 + 0.025 * sin(t * 2.2) + Float(voice.micLevel) * 0.18
            default: pulse = 1
            }
            orb.transform.rotation = simd_quatf(angle: angle, axis: [0, 1, 0]) * simd_quatf(angle: 0.38, axis: [1, 0, 0])
            orb.transform.scale = [pulse, pulse, pulse]
            try? await Task.sleep(nanoseconds: 16_000_000)
        }
    }
}

private extension Double {
    var float: Float { Float(self) }
}
