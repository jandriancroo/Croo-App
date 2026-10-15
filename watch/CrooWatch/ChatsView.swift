import SwiftUI

// MARK: - Store (chat list + open thread). Talks to watch-device-service with the watch's own token.

@MainActor
final class WatchChatStore: ObservableObject {
    @Published var chats: [WatchChat] = []
    @Published var messages: [WatchChatMessage] = []
    @Published var canReply = false
    @Published var loading = false
    @Published var sending = false
    @Published var errorText: String?

    var unreadTotal: Int { chats.reduce(0) { $0 + $1.unread } }

    func loadChats(_ store: WatchDataStore) async {
        guard let pairing = store.pairing else { return }
        loading = chats.isEmpty
        defer { loading = false }
        do {
            let obj = try await WatchAPIClient.shared.chatCall(
                pairing: pairing, locationId: store.selectedLocationId, ["action": "chats"])
            if let raw = obj["chats"] {
                let data = try JSONSerialization.data(withJSONObject: raw)
                chats = try JSONDecoder().decode([WatchChat].self, from: data)
            }
            errorText = nil
        } catch {
            errorText = "Couldn't load chats"
        }
    }

    func loadThread(_ store: WatchDataStore, chatId: String) async {
        guard let pairing = store.pairing else { return }
        do {
            let obj = try await WatchAPIClient.shared.chatCall(
                pairing: pairing, locationId: store.selectedLocationId, ["action": "thread", "chatId": chatId])
            if let raw = obj["messages"] {
                let data = try JSONSerialization.data(withJSONObject: raw)
                let fresh = try JSONDecoder().decode([WatchChatMessage].self, from: data)
                // Keep bubbles still sending (or failed) so they don't vanish between refreshes.
                messages = fresh + messages.filter { $0.id.hasPrefix("local-") && ($0.pending || $0.failed) }
            }
            canReply = (obj["canReply"] as? Bool) ?? false
            errorText = nil
            // Opening a thread marks it read on the server; clear the badge here too.
            if let i = chats.firstIndex(where: { $0.id == chatId }) {
                let c = chats[i]
                chats[i] = WatchChat(id: c.id, title: c.title, initials: c.initials, kind: c.kind, unread: 0,
                                     preview: c.preview, time: c.time, canReply: c.canReply)
            }
        } catch {
            errorText = "Couldn't load messages"
        }
    }

    /// Optimistic send: the bubble appears right away, then the server call runs in the background.
    func send(_ store: WatchDataStore, chatId: String, text: String, retrying localId: String? = nil) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let pairing = store.pairing else { return }
        let id = localId ?? "local-\(UUID().uuidString)"
        if let localId, let i = messages.firstIndex(where: { $0.id == localId }) {
            messages[i].failed = false
            messages[i].pending = true
        } else {
            messages.append(WatchChatMessage(id: id, mine: true, sender: "You", text: trimmed, time: "now", pending: true))
        }
        errorText = nil
        #if os(watchOS)
        WKInterfaceDevice.current().play(.click)
        #endif
        do {
            _ = try await WatchAPIClient.shared.chatCall(
                pairing: pairing, locationId: store.selectedLocationId,
                ["action": "send", "chatId": chatId, "content": trimmed])
            if let i = messages.firstIndex(where: { $0.id == id }) { messages[i].pending = false }
            #if os(watchOS)
            WKInterfaceDevice.current().play(.success)
            #endif
            if let i = chats.firstIndex(where: { $0.id == chatId }) {
                let c = chats[i]
                chats[i] = WatchChat(id: c.id, title: c.title, initials: c.initials, kind: c.kind, unread: 0,
                                     preview: "You: \(trimmed)", time: "now", canReply: c.canReply)
            }
            await loadThread(store, chatId: chatId)
        } catch {
            if let i = messages.firstIndex(where: { $0.id == id }) {
                messages[i].pending = false
                messages[i].failed = true
            }
            #if os(watchOS)
            WKInterfaceDevice.current().play(.failure)
            #endif
        }
    }
}

// MARK: - Chat list

struct ChatsView: View {
    @EnvironmentObject var store: WatchDataStore
    @StateObject private var chatStore = WatchChatStore()

    var body: some View {
        NavigationStack {
            Group {
                if !store.isPaired {
                    EmptyStateView(title: "Not Paired", message: "Pair this Watch from CrooHQ on iPhone.")
                } else if chatStore.chats.isEmpty && chatStore.loading {
                    ProgressView()
                } else if chatStore.chats.isEmpty {
                    EmptyStateView(title: "No Chats", message: chatStore.errorText ?? "Your chats for this store show up here.")
                } else {
                    ScrollView {
                        VStack(spacing: 6) {
                            HStack(alignment: .firstTextBaseline) {
                                Text("Chats")
                                    .font(.system(size: 16, weight: .heavy, design: .rounded))
                                    .foregroundStyle(CrooBrand.tealBright)
                                Spacer()
                                if chatStore.unreadTotal > 0 {
                                    Text("\(chatStore.unreadTotal) unread")
                                        .font(.system(size: 11, weight: .bold, design: .rounded))
                                        .foregroundStyle(CrooBrand.orange)
                                }
                            }
                            .padding(.horizontal, 6)
                            ForEach(chatStore.chats) { chat in
                                NavigationLink(value: chat) { ChatRow(chat: chat) }
                                    .buttonStyle(.plain)
                            }
                        }
                        .padding(.bottom, 8)
                    }
                }
            }
            .navigationDestination(for: WatchChat.self) { chat in
                ThreadView(chat: chat).environmentObject(chatStore)
            }
        }
        .task(id: store.selectedLocationId) { await chatStore.loadChats(store) }
        .onReceive(Timer.publish(every: 60, on: .main, in: .common).autoconnect()) { _ in
            Task { await chatStore.loadChats(store) }
        }
    }
}

private struct ChatRow: View {
    let chat: WatchChat

    private static let palette: [Color] = [CrooBrand.teal, CrooBrand.orange, Color(hex: "#7C5CBF"), Color(hex: "#3F8F6B"), Color(hex: "#C2506B")]
    private var tint: Color {
        let sum = chat.title.unicodeScalars.reduce(0) { $0 + Int($1.value) }
        return ChatRow.palette[sum % ChatRow.palette.count]
    }

    var body: some View {
        HStack(alignment: .top, spacing: 9) {
            ZStack {
                Circle().fill(tint.opacity(chat.unread > 0 ? 1 : 0.55))
                if chat.kind == "group" {
                    Image(systemName: "person.2.fill").font(.system(size: 13, weight: .bold))
                } else {
                    Text(chat.initials).font(.system(size: 13, weight: .heavy, design: .rounded))
                }
            }
            .frame(width: 34, height: 34)
            .overlay(Circle().stroke(chat.unread > 0 ? CrooBrand.orange : Color.clear, lineWidth: 2).padding(-3))

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(chat.title)
                        .font(.system(size: 14, weight: .heavy, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(chat.time)
                        .font(.system(size: 9, weight: .semibold, design: .rounded))
                        .foregroundStyle(chat.unread > 0 ? CrooBrand.orange : Color.white.opacity(0.45))
                }
                HStack(alignment: .top, spacing: 4) {
                    Text(chat.preview.isEmpty ? "No messages yet" : chat.preview)
                        .font(.system(size: 11, weight: chat.unread > 0 ? .semibold : .medium, design: .rounded))
                        .foregroundStyle(Color.white.opacity(chat.unread > 0 ? 0.9 : 0.55))
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                    Spacer(minLength: 0)
                    if chat.unread > 0 {
                        Text("\(chat.unread)")
                            .font(.system(size: 10, weight: .heavy, design: .rounded))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(CrooBrand.orange))
                    }
                }
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(chat.unread > 0 ? CrooBrand.card : CrooBrand.cardDim)
        )
        .foregroundStyle(.white)
    }
}

// MARK: - Thread

private struct ThreadView: View {
    let chat: WatchChat
    @EnvironmentObject var store: WatchDataStore
    @EnvironmentObject var chatStore: WatchChatStore
    @State private var draft = ""
    @State private var composing = false

    private let quickReplies = ["On it", "Be right there", "Thanks!", "Can't today"]

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 5) {
                    ForEach(chatStore.messages) { m in
                        bubble(m).id(m.id)
                    }
                    if chatStore.canReply {
                        replyArea.id("reply")
                    } else {
                        Text("Read-only chat")
                            .font(.system(size: 10, weight: .medium, design: .rounded))
                            .foregroundStyle(.secondary)
                            .frame(maxWidth: .infinity)
                            .id("reply")
                    }
                }
                .padding(.horizontal, 2)
            }
            .onChange(of: chatStore.messages) { _, _ in
                withAnimation { proxy.scrollTo("reply", anchor: .bottom) }
            }
        }
        .navigationTitle(chat.title)
        .task { await chatStore.loadThread(store, chatId: chat.id) }
        .sheet(isPresented: $composing) {
            NavigationStack {
                VStack(spacing: 8) {
                    TextField("Message", text: $draft)
                    Button("Send") {
                        let text = draft
                        draft = ""
                        composing = false
                        Task { await chatStore.send(store, chatId: chat.id, text: text) }
                    }
                    .disabled(draft.trimmingCharacters(in: .whitespaces).isEmpty)
                    .tint(CrooBrand.orange)
                }
            }
        }
    }

    private func bubble(_ m: WatchChatMessage) -> some View {
        VStack(alignment: m.mine ? .trailing : .leading, spacing: 1) {
            if !m.mine && chat.kind == "group" {
                Text(m.sender)
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(CrooBrand.orange)
            }
            Text(m.text)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .padding(.horizontal, 10)
                .padding(.vertical, 6)
                .background(RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(m.failed ? CrooBrand.amber.opacity(0.35) : (m.mine ? CrooBrand.teal : CrooBrand.card)))
                .opacity(m.pending ? 0.6 : 1)
            if m.failed {
                Text("Not sent · tap to retry")
                    .font(.system(size: 9, weight: .bold, design: .rounded))
                    .foregroundStyle(CrooBrand.amber)
            }
        }
        .contentShape(Rectangle())
        .onTapGesture {
            guard m.failed else { return }
            Task { await chatStore.send(store, chatId: chat.id, text: m.text, retrying: m.id) }
        }
        .frame(maxWidth: .infinity, alignment: m.mine ? .trailing : .leading)
    }

    private var replyArea: some View {
        VStack(spacing: 5) {
            ForEach(quickReplies, id: \.self) { text in
                Button {
                    Task { await chatStore.send(store, chatId: chat.id, text: text) }
                } label: {
                    Text(text)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 7)
                        .background(Capsule().fill(CrooBrand.card))
                }
                .buttonStyle(.plain)
            }
            Button {
                composing = true
            } label: {
                Label("Dictate or type", systemImage: "mic.fill")
                    .font(.system(size: 13, weight: .heavy, design: .rounded))
                    .frame(maxWidth: .infinity)
                    .padding(.vertical, 8)
                    .background(Capsule().fill(CrooBrand.orange))
            }
            .buttonStyle(.plain)
                    }
        .foregroundStyle(.white)
        .padding(.top, 4)
    }
}
