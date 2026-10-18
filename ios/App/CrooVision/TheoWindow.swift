import SwiftUI

/// Theo, native: opens listening right away. No website, no second sign-in.
struct TheoWindow: View {
    @EnvironmentObject var store: VisionStore
    @StateObject private var voice = TheoVoice()

    var body: some View {
        VStack(spacing: 18) {
            HStack {
                Text("Theo").font(.title.weight(.bold))
                Spacer()
                Text(store.selectedLocationName).font(.callout).foregroundStyle(.secondary)
            }

            if !store.hasUserSession {
                TheoSignIn()
            } else {
                TheoOrb(phase: voice.phase)
                    .frame(width: 260, height: 260)
                    .scaleEffect(1 + (voice.phase == .listening ? voice.micLevel * 0.15 : 0))
                    .animation(.easeOut(duration: 0.12), value: voice.micLevel)
                    .padding(.top, 8)

                Text(statusText)
                    .font(.title2.weight(.semibold))
                    .foregroundStyle(voice.phase == .error ? VColor.red : .primary)
                    .multilineTextAlignment(.center)

                ScrollView {
                    Text(voice.caption)
                        .font(.title3)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                .frame(maxHeight: 160)

                Spacer(minLength: 0)

                // Mic meter + troubleshooting line (temporary).
                HStack(spacing: 10) {
                    Image(systemName: "mic.fill").foregroundStyle(.secondary)
                    GeometryReader { g in
                        Capsule().fill(.white.opacity(0.15))
                            .overlay(alignment: .leading) {
                                Capsule().fill(VColor.green).frame(width: g.size.width * voice.micLevel)
                            }
                    }
                    .frame(width: 180, height: 8)
                }
                Text(voice.debugLine).font(.caption2).foregroundStyle(.tertiary).lineLimit(2)

                if voice.isLive {
                    Button(role: .destructive) { voice.stop() } label: {
                        Label("End", systemImage: "xmark").frame(width: 160)
                    }
                    .controlSize(.extraLarge)
                } else {
                    Button { Task { await voice.start(store: store) } } label: {
                        Label("Talk to Theo", systemImage: "waveform").frame(width: 200)
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(VColor.orange)
                    .controlSize(.extraLarge)
                }
            }
        }
        .padding(32)
        .task {
            if store.hasUserSession { await voice.start(store: store) }
        }
        .onDisappear { voice.stop() }
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
}

/// Shown once if this Vision Pro was paired before Theo went native.
private struct TheoSignIn: View {
    @EnvironmentObject var store: VisionStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 14) {
            Text("Sign in once more to talk to Theo.").font(.title3).multilineTextAlignment(.center)
            TextField("Email", text: $email)
                .textContentType(.username)
                .keyboardType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
            SecureField("Password", text: $password).textContentType(.password)
            if let e = store.errorText { Text(e).font(.callout).foregroundStyle(VColor.red) }
            Button {
                Task { await store.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
            } label: {
                if store.loading { ProgressView() } else { Text("Sign in").frame(width: 160) }
            }
            .buttonStyle(.borderedProminent)
            .disabled(email.isEmpty || password.isEmpty || store.loading)
        }
        .textFieldStyle(.roundedBorder)
        .frame(maxWidth: 380)
    }
}

/// Theo's dot-sphere orb: slowly turns, breathes while listening, pulses while he talks.
struct TheoOrb: View {
    let phase: TheoPhase

    var body: some View {
        TimelineView(.animation) { tl in
            let t = tl.date.timeIntervalSinceReferenceDate
            Canvas { ctx, size in
                let n = 420
                let golden = Double.pi * (3 - 5.0.squareRoot())
                let c = CGPoint(x: size.width / 2, y: size.height / 2)
                let speed: Double = phase == .speaking ? 0.9 : (phase == .thinking ? 1.6 : 0.35)
                let pulse: Double
                switch phase {
                case .speaking: pulse = 1 + 0.05 * sin(t * 9)
                case .listening: pulse = 1 + 0.025 * sin(t * 2.2)
                default: pulse = 1
                }
                let R = min(size.width, size.height) * 0.44 * pulse
                let rot = t * speed, tilt = 0.38
                var pts: [(Double, Double, Double)] = []
                pts.reserveCapacity(n)
                for i in 0..<n {
                    let y = 1 - (Double(i) / Double(n - 1)) * 2
                    let r = (1 - y * y).squareRoot()
                    let th = golden * Double(i)
                    let x0 = cos(th) * r, z0 = sin(th) * r
                    let x1 = x0 * cos(rot) + z0 * sin(rot), z1 = -x0 * sin(rot) + z0 * cos(rot)
                    pts.append((x1, y * cos(tilt) - z1 * sin(tilt), y * sin(tilt) + z1 * cos(tilt)))
                }
                for p in pts.sorted(by: { $0.2 < $1.2 }) {
                    let depth = (p.2 + 1) / 2
                    let d = R * (0.018 + 0.026 * depth)
                    let rect = CGRect(x: c.x + p.0 * R - d, y: c.y + p.1 * R - d, width: d * 2, height: d * 2)
                    let warm = p.1 < -0.55 && p.0 > 0
                    let color = phase == .error ? VColor.slate : (warm ? VColor.orange : VColor.teal)
                    ctx.fill(Path(ellipseIn: rect), with: .color(color.opacity(0.3 + 0.7 * depth)))
                }
            }
        }
    }
}
