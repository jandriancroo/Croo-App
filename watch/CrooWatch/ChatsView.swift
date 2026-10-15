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
                messages = try JSONDecoder().decode([WatchChatMessage].self, from: data)
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

    func send(_ store: WatchDataStore, chatId: String, text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let pairing = store.pairing else { return }
        sending = true
        defer { sending = false }
        do {
            _ = try await WatchAPIClient.shared.chatCall(
                pairing: pairing, locationId: store.selectedLocationId,
                ["action": "send", "chatId": chatId, "content": trimmed])
            #if os(watchOS)
            WKInterfaceDevice.current().play(.success)
            #endif
            await loadThread(store, chatId: chatId)
        } catch {
            errorText = "Didn't send. Try again."
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

    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(chat.unread > 0 ? CrooBrand.teal : CrooBrand.avatar)
                .frame(width: 30, height: 30)
                .overlay(Text(chat.initials)
                    .font(.system(size: 11, weight: .bold, design: .rounded)))
            VStack(alignment: .leading, spacing: 1) {
                HStack {
                    Text(chat.title)
                        .font(.system(size: 13, weight: chat.unread > 0 ? .heavy : .bold, design: .rounded))
                        .lineLimit(1)
                    Spacer(minLength: 2)
                    Text(chat.time)
                        .font(.system(size: 9, weight: .medium, design: .rounded))
                        .foregroundStyle(.secondary)
                }
                Text(chat.preview)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(chat.unread > 0 ? Color.white.opacity(0.85) : .secondary)
                    .lineLimit(1)
            }
            if chat.unread > 0 {
                Text("\(chat.unread)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
                    .background(Capsule().fill(CrooBrand.orange))
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .background(RoundedRectangle(cornerRadius: 17, style: .continuous)
            .fill(chat.unread > 0 ? CrooBrand.card : CrooBrand.cardDim))
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
                    if let err = chatStore.errorText {
                        Text(err).font(.system(size: 10, weight: .semibold, design: .rounded))
                            .foregroundStyle(CrooBrand.amber)
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
                    .fill(m.mine ? CrooBrand.teal : CrooBrand.card))
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
            .disabled(chatStore.sending)
        }
        .foregroundStyle(.white)
        .padding(.top, 4)
    }
}
