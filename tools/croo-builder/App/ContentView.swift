import SwiftUI
import ServiceManagement
import AppKit

/// The panel that pops out of the menu bar hammer.
struct PanelView: View {
    @EnvironmentObject var runner: Runner
    @State private var selectedDevice: Device?
    @State private var showLog = false
    @State private var loginOn = SMAppService.mainApp.status == .enabled
    @State private var notesText = ""
    @State private var previewNotes: String?
    @State private var infoStep: Int?
    @State private var shipWord = ""

    private let orange = Color(red: 0.92, green: 0.49, blue: 0.24)
    private let teal = Color(red: 0.31, green: 0.70, blue: 0.78)

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            header
            status
            stepsSection
            if runner.notesDraft != nil { notesEditor }
            if let preview = previewNotes, runner.notesDraft == nil { notesPreview(preview) }
            if !runner.notesStatus.isEmpty { notesStatusRow }
            deviceRow
            logSection
            footer
        }
        .padding(16)
        .frame(width: 380)
        .onAppear {
            runner.refreshBranch()
            if runner.devices.isEmpty { runner.loadDevices() }
        }
        .onChange(of: runner.isRunning) { _, running in if running { showLog = true } }
        .onChange(of: runner.notesDraft) { _, draft in if let draft { notesText = draft } }
    }

    // MARK: Header + status

    private var header: some View {
        HStack(spacing: 8) {
            Image(systemName: "hammer.fill").foregroundStyle(orange)
            Text("Croo Builder").font(.headline)
            Spacer()
            if !runner.branch.isEmpty {
                Text("Mac is on: \(runner.branch)")
                    .font(.caption.weight(.semibold))
                    .padding(.horizontal, 8).padding(.vertical, 3)
                    .background(.quaternary.opacity(0.7), in: Capsule())
                    .help("Which version of the code this Mac has right now. You can't change it here; the steps switch it for you.")
            }
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

    // MARK: The four steps

    private static let infoTexts: [String] = [
        "Your Mac catches up with everything Claude and Grok wrote on the testing branch, and also brings in any fixes Lovable made on main, so your test build has them. Then it builds the app so Xcode has the newest version. If there is nothing new, it says so and moves on. The most it does on GitHub is line testing up with main.",
        "Opens the project in Xcode. Pick your Duo, your iPhone or a simulator at the top and press Run, then try the changes. You don't edit anything in Xcode. If something is wrong, tell Claude or Grok what to fix; they write the fix onto testing, and you start again at step 1.",
        "Sends everything on testing into main, the trusted version Lovable follows. A bookmark goes on main first, so you can always go back to exactly how it was. Your website does not change until you press Publish in Lovable, so check the preview there first if the work touched shared pages. Type ship to unlock this step.",
        "Switches this Mac to main, builds the app, and uploads it to Apple for TestFlight. This comes from your computer, not from GitHub. Regular iPhone users and Duo testers get the same build; the Duo screens stay off on regular phones. When it finishes, your Mac goes back to testing."
    ]

    private var shipUnlocked: Bool {
        runner.stepDone[1] && shipWord.trimmingCharacters(in: .whitespaces).lowercased() == "ship"
    }

    @ViewBuilder private var stepsSection: some View {
        VStack(spacing: 8) {
            stepCard(0, "Pull latest from Git", "arrow.down.circle.fill", teal, unlocked: true) {
                runner.pullLatest()
            }
            stepCard(1, "Open in Xcode and test", "hammer.fill", teal, unlocked: runner.stepDone[0]) {
                runner.openXcode()
                runner.complete(1)
            }
            stepCard(2, "Ship drafts to main", "arrow.triangle.merge", orange, unlocked: shipUnlocked) {
                runner.shipToMain()
            }
            if runner.stepDone[1] && !runner.stepDone[2] {
                TextField("Type ship to unlock step 3", text: $shipWord)
                    .textFieldStyle(.roundedBorder)
                    .font(.callout)
            }
            stepCard(3, "Ship to TestFlight", "paperplane.fill", orange, unlocked: runner.stepDone[2]) {
                runner.prepareShip()
            }
            HStack {
                Button { runner.run(.saveChanges) } label: {
                    Label("Send local changes to GitHub", systemImage: "square.and.arrow.up")
                }
                .controlSize(.small)
                .disabled(runner.isRunning)
                .help("Sends anything new on this Mac to the testing branch only. Never to main.")
                Spacer()
                if !runner.stepDone[2] && !runner.stepDone[3] {
                    Button("Only Lovable fixes? Skip to step 4") { runner.skipToTestFlight() }
                        .buttonStyle(.link).font(.caption)
                        .help("For fixes Lovable already put on main. Skips steps 1 to 3.")
                }
            }
        }
    }

    private func stepCard(_ index: Int, _ title: String, _ icon: String, _ color: Color, unlocked: Bool,
                          action: @escaping () -> Void) -> some View {
        let done = runner.stepDone[index]
        let enabled = unlocked && !done && !runner.isRunning
        return VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Button(action: action) {
                    HStack(spacing: 8) {
                        Image(systemName: done ? "checkmark.circle.fill" : icon)
                            .font(.title3)
                            .foregroundStyle(done ? Color.green : color)
                        Text("\(index + 1). \(title)")
                            .font(.callout.weight(.semibold))
                            .lineLimit(1)
                            .minimumScaleFactor(0.85)
                        Spacer(minLength: 0)
                    }
                    .frame(height: 30)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .opacity(enabled ? 1 : 0.45)
                Button { infoStep = (infoStep == index) ? nil : index } label: {
                    Text(infoStep == index ? "hide" : "info")
                        .font(.caption2.weight(.semibold))
                        .padding(.horizontal, 8).padding(.vertical, 3)
                        .background(.quaternary, in: Capsule())
                }
                .buttonStyle(.plain)
            }
            if infoStep == index {
                Text(Self.infoTexts[index])
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 10).padding(.vertical, 6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.quaternary.opacity(0.6), in: RoundedRectangle(cornerRadius: 10))
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

    private func notesPreview(_ text: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Image(systemName: "eye").foregroundStyle(teal)
                Text("Next TestFlight message").font(.callout.weight(.semibold))
                Spacer()
                Button { previewNotes = nil } label: { Image(systemName: "xmark.circle.fill") }
                    .buttonStyle(.borderless).foregroundStyle(.secondary)
            }
            ScrollView {
                Text(text).font(.system(size: 12)).textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .frame(height: 140)
            .padding(6)
            .background(Color.black.opacity(0.2), in: RoundedRectangle(cornerRadius: 8))
            Text("Preview only. You can still edit it when you press Ship.")
                .font(.caption).foregroundStyle(.secondary)
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
                Text(runner.devices.isEmpty ? "No device found" : "Or run on a device (step 2)…").tag(Device?.none)
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
                    runner.runOnDevice(d)
                }
            } label: { Label("Run", systemImage: "play.fill") }
            .buttonStyle(.borderedProminent)
            .disabled(selectedDevice == nil || runner.isRunning || selectedDevice?.reachable == false || !runner.stepDone[0])
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
            Button("Preview notes") {
                previewNotes = previewNotes == nil ? TestFlightNotes.draft(repo: runner.repoPath) : nil
            }
            .buttonStyle(.link).font(.caption)
            .help("See the What to Test message the next Ship will post (nothing ships)")
            Button("Start over") { shipWord = ""; infoStep = nil; runner.startOver() }
                .buttonStyle(.link).font(.caption)
                .help("Goes back to step 1")
            Button("Change folder…") { pickFolder() }.buttonStyle(.link).font(.caption)
            Button("Terminal") { runner.openInTerminal() }.buttonStyle(.link).font(.caption)
            Button(loginOn ? "Opens at login ✓" : "Open at login") {
                if loginOn { try? SMAppService.mainApp.unregister() } else { try? SMAppService.mainApp.register() }
                loginOn = SMAppService.mainApp.status == .enabled
            }
            .buttonStyle(.link).font(.caption)
            .help("Start Croo Builder automatically when you sign in to this Mac")
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
