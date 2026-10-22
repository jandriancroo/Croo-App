import SwiftUI
import RealityKit

/// Theo as a floating 3D orb: a sphere of glowing dots you can walk around.
/// Turns slowly, breathes while listening (and grows with your voice), pulses while he talks.
/// Caption, status and End float underneath. Same native voice engine as before (TheoVoice).
struct TheoVolume: View {
    @EnvironmentObject var store: VisionStore
    @StateObject private var voice = TheoVoice()
    @State private var orb = Entity()
    @State private var frameTick: EventSubscription?
    @State private var motion = OrbMotion()
    /// Show Theo's words under him (remembered between sessions).
    @AppStorage("theoShowCaptions") private var showCaptions = true

    var body: some View {
        RealityView { content, attachments in
            buildOrb()
            orb.position = [0, 0.07, 0]
            content.add(orb)
            if let panel = attachments.entity(for: "panel") {
                panel.position = [0, -0.14, 0.02]
                content.add(panel)
            }
            // Animate on RealityKit's own frame clock (smooth, in step with the display).
            frameTick = content.subscribe(to: SceneEvents.Update.self) { event in
                step(dt: Float(event.deltaTime))
            }
        } attachments: {
            Attachment(id: "panel") {
                panel
            }
        }
        .volumeBaseplateVisibility(.hidden) // no glowing "plate" under him
        // Look at Theo and pinch: he starts listening. Pinch again while he's on to end.
        .gesture(
            SpatialTapGesture()
                .targetedToEntity(orb)
                .onEnded { _ in togglePinch() }
        )
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
                if showCaptions && !voice.caption.isEmpty {
                    Text(voice.caption)
                        .font(.title3)
                        .multilineTextAlignment(.center)
                        .lineLimit(4)
                        .frame(maxWidth: 420)
                        .shadow(radius: 6)
                }
                HStack(spacing: 12) {
                    if voice.isLive {
                        Button(role: .destructive) { voice.stop() } label: {
                            Label("End", systemImage: "xmark")
                        }
                        .controlSize(.large)
                    }
                    // Words on / off
                    Button { showCaptions.toggle() } label: {
                        Image(systemName: showCaptions ? "captions.bubble.fill" : "captions.bubble")
                    }
                    .buttonBorderShape(.circle)
                    .controlSize(.large)
                    .help(showCaptions ? "Hide Theo's words" : "Show Theo's words")
                    .accessibilityLabel(showCaptions ? "Hide captions" : "Show captions")
                }
            }
        }
        .frame(width: 460)
    }

    private var statusText: String {
        switch voice.phase {
        case .idle: return "Pinch Theo to talk"
        case .connecting: return "Connecting…"
        case .listening: return "Listening…"
        case .thinking: return "Checking…"
        case .speaking: return "Theo"
        case .error: return voice.errorText ?? "Theo’s voice isn’t available right now."
        }
    }

    private func togglePinch() {
        if voice.isLive {
            voice.stop()
        } else if store.hasUserSession {
            Task { await voice.start(store: store) }
        }
    }

    // MARK: 3D orb

    private func buildOrb() {
        guard orb.children.isEmpty else { return }
        // Pinch target: an invisible sphere around the dots, with the system look-highlight.
        orb.components.set(InputTargetComponent())
        orb.components.set(CollisionComponent(shapes: [.generateSphere(radius: 0.13)]))
        orb.components.set(HoverEffectComponent())
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

    /// One display frame: ease speed and size toward where the current phase wants them,
    /// so changes (listening → thinking → talking, your voice getting louder) glide instead of jump.
    private func step(dt: Float) {
        let dt = min(max(dt, 0), 0.05)
        motion.time += dt
        let phase = voice.phase
        let targetSpeed: Float = phase == .thinking ? 1.4 : (phase == .speaking ? 0.8 : 0.3)
        motion.speed += (targetSpeed - motion.speed) * min(1, dt * 3)

        let mic = Float(voice.micLevel)
        motion.mic += (mic - motion.mic) * min(1, dt * 8)
        let base: Float
        switch phase {
        case .speaking: base = 1 + 0.045 * (0.5 + 0.5 * sin(motion.time * 7))
        case .listening: base = 1 + 0.02 * sin(motion.time * 2) + motion.mic * 0.15
        case .thinking: base = 1 + 0.015 * sin(motion.time * 4)
        default: base = 1
        }
        motion.scale += (base - motion.scale) * min(1, dt * 10)
        motion.angle += motion.speed * dt

        orb.transform.rotation = simd_quatf(angle: motion.angle, axis: [0, 1, 0]) * simd_quatf(angle: 0.38, axis: [1, 0, 0])
        orb.transform.scale = [motion.scale, motion.scale, motion.scale]
    }
}

/// Smoothed animation state for the orb (kept between frames).
final class OrbMotion {
    var time: Float = 0
    var angle: Float = 0
    var speed: Float = 0.3
    var scale: Float = 1
    var mic: Float = 0
}

private extension Double {
    var float: Float { Float(self) }
}
