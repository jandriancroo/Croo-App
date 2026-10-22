import SwiftUI
import AppKit

/// The panel that pops out of the menu bar hammer.
struct PanelView: View {
    @EnvironmentObject var runner: Runner
    @State private var selectedDevice: Device?
    @State private var showLog = false
    @State private var notesText = ""

    private let orange = Color(red: 0.92, green: 0.49, blue: 0.24)
    private let teal = Color(red: 0.31, green: 0.70, blue: 0.78)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            status
            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                tile("Get latest", "arrow.down.circle.fill", teal) { runner.run(.getLatest) }
                tile("Ship to TestFlight", "paperplane.fill", orange) { runner.prepareShip() }
                tile("Save my changes", "square.and.arrow.up.fill", .green) { runner.run(.saveChanges) }
                tile("Open in Xcode", "hammer", .secondary, alwaysOn: true) { runner.openXcode() }
            }
            if runner.notesDraft != nil { notesEditor }
            if !runner.notesStatus.isEmpty { notesStatusRow }
            deviceRow
            logSection
            footer
        }
        .padding(16)
        .frame(width: 380)
        .onAppear { if runner.devices.isEmpty { runner.loadDevices() } }
        .onChange(of: runner.isRunning) { _, running in if running { showLog = true } }
        .onChange(of: runner.notesDraft) { _, draft in if let draft { notesText = draft } }
    }

    // MARK: Header + status

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "hammer.fill").foregroundStyle(orange)
            Text("Croo Builder").font(.headline)
            Spacer()
            Image(systemName: runner.repoLooksRight ? "checkmark.circle.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(runner.repoLooksRight ? .green : .orange)
                .help(runner.repoPath)
        }
    }

    @ViewBuilder private var status: some View {
        HStack(spacing: 8) {
            if runner.isRunning {
                ProgressView().controlSize(.small)
                Text(runner.lines.last(where: { $0.kind == .step })?.text.replacingOccurrences(of: "▶ ", with: "") ?? "\(runner.currentTitle)…")
                    .font(.callout).lineLimit(2)
                Spacer()
                Button("Stop") { runner.stop() }.controlSize(.small)
            } else if let r = runner.lastResult {
                Image(systemName: r.ok ? "checkmark.circle.fill" : "xmark.octagon.fill").foregroundStyle(r.ok ? .green : .red)
                Text(r.ok ? "\(r.title) finished" : "\(r.title) failed").font(.callout.weight(.semibold))
                Spacer()
                if !r.ok {
                    Button { runner.copyErrorReport() } label: { Label("Copy error", systemImage: "doc.on.doc") }
                        .controlSize(.small)
                }
            } else {
                Text("Ready").font(.callout).foregroundStyle(.secondary)
                Spacer()
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }

    private func tile(_ title: String, _ icon: String, _ color: Color, alwaysOn: Bool = false,
                      action: @escaping () -> Void) -> some View {
        let disabled = runner.isRunning && !alwaysOn
        return Button(action: action) {
            HStack(spacing: 8) {
                Image(systemName: icon).font(.title3).foregroundStyle(color)
                Text(title).font(.callout.weight(.semibold)).lineLimit(1).minimumScaleFactor(0.85)
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .frame(height: 44)
            .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
            .contentShape(RoundedRectangle(cornerRadius: 10))
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .opacity(disabled ? 0.45 : 1)
    }

    // MARK: TestFlight notes

    private var notesEditor: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "text.bubble.fill").foregroundStyle(orange)
                Text("What to Test").font(.callout.weight(.semibold))
                Spacer()
                Text(runner.hasASCKey ? "Posts to TestFlight" : "Copied for you to paste")
                    .font(.caption).foregroundStyle(.secondary)
            }
            TextEditor(text: $notesText)
                .font(.system(size: 12))
                .frame(height: 150)
                .scrollContentBackground(.hidden)
                .padding(6)
                .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            Text("This is what testers see. Edit it if you want, then ship.")
                .font(.caption).foregroundStyle(.secondary)
            HStack {
                Button("Cancel") { runner.cancelShip() }
                Spacer()
                Button {
                    runner.ship(notes: notesText)
                } label: { Label("Ship build", systemImage: "paperplane.fill") }
                .buttonStyle(.borderedProminent)
                .tint(orange)
                .disabled(notesText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
        }
        .padding(10)
        .background(.quaternary.opacity(0.5), in: RoundedRectangle(cornerRadius: 10))
    }

    private var notesStatusRow: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "text.bubble").foregroundStyle(teal)
            Text(runner.notesStatus).font(.caption).fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if !runner.hasASCKey {
                Button("Open") { runner.openAppStoreConnect() }.controlSize(.small)
            }
        }
    }

    // MARK: Run on device

    private var deviceRow: some View {
        HStack(spacing: 8) {
            Picker("", selection: $selectedDevice) {
                Text(runner.devices.isEmpty ? "No device found" : "Run on…").tag(Device?.none)
                ForEach(runner.devices) { d in
                    Label(d.label, systemImage: d.symbol).tag(Device?.some(d))
                }
            }
            .labelsHidden()
            Button {
                runner.loadDevices()
            } label: {
                if runner.loadingDevices { ProgressView().controlSize(.small) } else { Image(systemName: "arrow.clockwise") }
            }
            .help("Look for devices again (unlocked, same Wi-Fi or plugged in)")
            Button {
                if let d = selectedDevice {
                    runner.run(.runOnDevice(scheme: d.scheme, udid: d.id, platform: d.platform, name: d.name))
                }
            } label: { Label("Run", systemImage: "play.fill") }
            .buttonStyle(.borderedProminent)
            .disabled(selectedDevice == nil || runner.isRunning || selectedDevice?.reachable == false)
        }
        .help("Only your real iPhones and Vision Pro show here (no simulators). “Not connected” = unlock it and join the same Wi-Fi, then tap refresh.")
    }

    // MARK: Log

    private var logSection: some View {
        DisclosureGroup(isExpanded: $showLog) {
            ScrollViewReader { proxy in
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 2) {
                        ForEach(runner.lines) { line in
                            Text(line.text)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(color(for: line.kind))
                                .textSelection(.enabled)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .id(line.id)
                        }
                    }
                    .padding(8)
                }
                .frame(height: 180)
                .background(Color.black.opacity(0.25), in: RoundedRectangle(cornerRadius: 8))
                .onChange(of: runner.lines.count) { _, _ in
                    if let last = runner.lines.last { proxy.scrollTo(last.id, anchor: .bottom) }
                }
            }
        } label: {
            HStack {
                Text("Details").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Spacer()
                if !runner.lines.isEmpty {
                    Button { runner.copyErrorReport() } label: { Image(systemName: "doc.on.doc") }
                        .buttonStyle(.borderless)
                        .help("Copy errors + last lines to paste to Claude")
                }
            }
        }
    }

    private var footer: some View {
        HStack {
            Button("Change folder…") { pickFolder() }.buttonStyle(.link).font(.caption)
            Button("Terminal") { runner.openInTerminal() }.buttonStyle(.link).font(.caption)
            Spacer()
            Button("Quit") { NSApp.terminate(nil) }.buttonStyle(.link).font(.caption)
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
        NSApp.activate(ignoringOtherApps: true)
        if panel.runModal() == .OK, let url = panel.url { runner.repoPath = url.path }
    }
}
