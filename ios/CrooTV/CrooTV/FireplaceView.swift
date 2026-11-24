import SwiftUI
import AVFoundation
import Combine
import UIKit

/// Screensaver page: your fire footage on a seamless loop, crackle audio, big thin time,
/// and two quiet stats. Swipe left on the remote to go back to the dashboard.
struct FireplaceView: View {
    @EnvironmentObject var store: TVStore
    @StateObject private var crackle = CrackleAudio()
    private var today: TVPeriod? { store.snapshot?.salesSummary?.today }

    var body: some View {
        ZStack {
            LoopingVideo(resource: "fire-loop", ext: "mp4")
                .ignoresSafeArea()

            // keep the fire clear on the left, make the right side readable
            LinearGradient(colors: [Color.black.opacity(0.82), Color.black.opacity(0.55), .clear],
                           startPoint: .trailing, endPoint: UnitPoint(x: 0.4, y: 0.5))
                .ignoresSafeArea()
            LinearGradient(colors: [Color.black.opacity(0.85), .clear],
                           startPoint: .bottom, endPoint: UnitPoint(x: 0.5, y: 0.65))
                .ignoresSafeArea()

            VStack(alignment: .trailing, spacing: 0) {
                TimelineView(.periodic(from: .now, by: 1)) { context in
                    VStack(alignment: .trailing, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 20) {
                            Text(context.date.formatted(.dateTime.hour(.defaultDigits(amPM: .omitted)).minute()))
                                .font(.system(size: 240, weight: .ultraLight))
                                .foregroundStyle(TVColor.cream)
                            Text(context.date.formatted(.dateTime.hour(.defaultDigits(amPM: .abbreviated))).uppercased().suffix(2))
                                .font(.system(size: 60, weight: .light))
                                .foregroundStyle(TVColor.creamSoft)
                        }
                        Text(context.date.formatted(.dateTime.weekday(.wide).month(.wide).day()).uppercased())
                            .font(.system(size: 34, weight: .regular)).tracking(6)
                            .foregroundStyle(TVColor.creamSoft)
                    }
                }
                Spacer()
                HStack(alignment: .top, spacing: 80) {
                    stat(title: "SALES TODAY", value: TVFormat.money(today?.salesValue),
                         sub: today?.goalValue.map { "of \(TVFormat.money($0)) goal" } ?? "")
                    stat(title: "LABOR", value: TVFormat.percent(today?.laborPercentValue),
                         sub: [today?.laborGoalText?.lowercased(), today?.laborGapText].compactMap { $0 }.joined(separator: " · "))
                }
                .padding(.bottom, 70)
            }
            .padding(.horizontal, 96)
            .padding(.top, 60)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .trailing)
        }
        .onAppear { crackle.start() }
        .onDisappear { crackle.stop() }
    }

    private func stat(title: String, value: String, sub: String) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            Text(title).font(.system(size: 22, weight: .bold)).tracking(3).foregroundStyle(TVColor.creamSoft)
            Text(value).font(.system(size: 92, weight: .light)).foregroundStyle(TVColor.cream)
            Text(sub).font(.system(size: 24, weight: .regular)).foregroundStyle(TVColor.creamSoft)
        }
    }
}

// MARK: - Video

struct LoopingVideo: UIViewRepresentable {
    let resource: String
    let ext: String

    func makeUIView(context: Context) -> PlayerUIView { PlayerUIView(resource: resource, ext: ext) }
    func updateUIView(_ uiView: PlayerUIView, context: Context) {}
}

final class PlayerUIView: UIView {
    private let queuePlayer = AVQueuePlayer()
    private var looper: AVPlayerLooper?

    override class var layerClass: AnyClass { AVPlayerLayer.self }

    init(resource: String, ext: String) {
        super.init(frame: .zero)
        backgroundColor = .black
        guard let url = Bundle.main.url(forResource: resource, withExtension: ext) else { return }
        looper = AVPlayerLooper(player: queuePlayer, templateItem: AVPlayerItem(url: url))
        if let layer = layer as? AVPlayerLayer {
            layer.player = queuePlayer
            layer.videoGravity = .resizeAspectFill
        }
        queuePlayer.isMuted = true
        queuePlayer.play()
    }

    required init?(coder: NSCoder) { fatalError("init(coder:) has not been implemented") }
}

// MARK: - Crackle sound

@MainActor
final class CrackleAudio: ObservableObject {
    private var player: AVAudioPlayer?

    func start() {
        guard player == nil,
              let url = Bundle.main.url(forResource: "fireplace-crackle", withExtension: "m4a") else { return }
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .default, options: [])
        try? AVAudioSession.sharedInstance().setActive(true)
        player = try? AVAudioPlayer(contentsOf: url)
        player?.numberOfLoops = -1
        player?.volume = 0.7
        player?.play()
    }

    func stop() {
        player?.stop()
        player = nil
    }
}
