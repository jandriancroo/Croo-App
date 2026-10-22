import SwiftUI
import AppKit

struct ContentView: View {
    @EnvironmentObject var runner: Runner
    @State private var selectedDevice: Device?

    private let orange = Color(red: 0.92, green: 0.49, blue: 0.24)
    private let teal = Color(red: 0.31, green: 0.70, blue: 0.78)

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            header
            HStack(alignment: .top, spacing: 14) {
                bigButton("Get latest", "arrow.down.circle.fill", teal,
                          "Pulls GitHub and builds the web app into the iPhone app.") { runner.run(.getLatest) }
                bigButton("Ship to TestFlight", "paperplane.fill", orange,
                          "Get latest, next build number, archive, upload.") { runner.run(.ship) }
                bigButton("Save my changes", "square.and.arrow.up.fill", .green,
                          "Sends anything changed on this Mac (e.g. in Xcode) to GitHub.") { runner.run(.saveChanges) }
            }
            deviceRow
            logView
        }
        .padding(20)
        .onAppear { runner.loadDevices() }
    }

    // MARK: Header

    private var header: some View {
        HStack(spacing: 12) {
            Image(systemName: "hammer.fill").font(.title).foregroundStyle(orange)
            VStack(alignment: .leading, spacing: 2) {
                Text("Croo Builder").font(.title2.weight(.bold))
                HStack(spacing: 6) {
                    Image(systemName: runner.repoLooksRight ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                        .foregroundStyle(runner.repoLooksRight ? .green : .orange)
                    Text(runner.repoPath).font(.caption).foregroundStyle(.secondary).lineLimit(1).truncationMode(.middle)
                    Button("Change…") { pickFolder() }.buttonStyle(.link).font(.caption)
                }
            }
            Spacer()
            Button { runner.openXcode() } label: { Label("Open in Xcode", systemImage: "hammer") }
            Button { runner.openInTerminal() } label: { Label("Terminal", systemImage: "terminal") }
        }
    }

    private func bigButton(_ title: String, _ icon: String, _ color: Color, _ subtitle: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 6) {
                Image(systemName: icon).font(.system(size: 26)).foregroundStyle(color)
                Text(title).font(.headline)
                Text(subtitle).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .padding(14)
            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 14))
        }
        .buttonStyle(.plain)
        .disabled(runner.isRunning)
        .opacity(runner.isRunning ? 0.5 : 1)
    }

    // MARK: Run on device

    private var deviceRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "play.circle.fill").font(.title2).foregroundStyle(.blue)
            Text("Run on").font(.headline)
            Picker("", selection: $selectedDevice) {
                Text(runner.devices.isEmpty ? "No device found" : "Choose a device").tag(Device?.none)
                ForEach(runner.devices) { d in
                    Label(d.name, systemImage: d.symbol).tag(Device?.some(d))
                }
            }
            .labelsHidden()
            .frame(width: 260)
            Button {
                runner.loadDevices()
            } label: {
                if runner.loadingDevices { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
            }
            .help("Look for devices again (unlocked, same Wi-Fi or plugged in)")
            Button("Run") {
                if let d = selectedDevice {
                    runner.run(.runOnDevice(scheme: d.scheme, udid: d.id, platform: d.platform, name: d.name))
                }
            }
            .buttonStyle(.borderedProminent)
            .disabled(selectedDevice == nil || runner.isRunning)
            Spacer()
            Text("Tip: press Get latest first").font(.caption).foregroundStyle(.secondary)
        }
        .padding(12)
        .background(.quaternary.opacity(0.4), in: RoundedRectangle(cornerRadius: 12))
    }

    // MARK: Log

    private var logView: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                if runner.isRunning {
                    ProgressView().controlSize(.small)
                    Text("\(runner.currentTitle)…").font(.headline)
                } else if let r = runner.lastResult {
                    Image(systemName: r.ok ? "checkmark.circle.fill" : "xmark.octagon.fill")
                        .foregroundStyle(r.ok ? .green : .red)
                    Text(r.ok ? "\(r.title) finished" : "\(r.title) failed").font(.headline)
                } else {
                    Text("Ready").font(.headline).foregroundStyle(.secondary)
                }
                Spacer()
                if runner.isRunning { Button("Stop") { runner.stop() } }
                Button { runner.copyErrorReport() } label: { Label("Copy error", systemImage: "doc.on.doc") }
                    .disabled(runner.lines.isEmpty)
                    .help("Copies the errors and last lines so you can paste them to Claude")
            }
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 3) {
                        ForEach(runner.lines) { line in
                            Text(line.text)
                                .font(.system(.callout, design: .monospaced))
                                .foregroundStyle(color(for: line.kind))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(line.id)
                        }
                    }
                    .padding(12)
                }
                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 12))
                .onChange(of: runner.lines.count) { _, _ in
                    if let last = runner.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        }
    }

    private func color(for kind: LogLine.Kind) -> Color {
        switch kind {
        case .step: return teal
        case .ok: return .green
        case .error: return .red
        case .plain: return .secondary
        }
    }

    private func pickFolder() {
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.message = "Pick your Croo-App folder"
        if panel.runModal() == .OK, let url = panel.url { runner.repoPath = url.path }
    }
}
