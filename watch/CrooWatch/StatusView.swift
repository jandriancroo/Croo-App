import SwiftUI

/// Troubleshooting tab: shows whether the watch and iPhone are talking,
/// and lets you pull a fresh snapshot by hand.
struct StatusView: View {
    @EnvironmentObject var store: WatchDataStore

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 10) {
                Text("Connection")
                    .font(.headline)

                Text(store.statusLine)
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(.secondary)

                Text("Last event: \(store.lastEvent)")
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)

                Text(store.hasData ? "Snapshot: loaded" : "Snapshot: none yet")
                    .font(.system(size: 12))
                    .foregroundStyle(store.hasData ? .green : .orange)

                if !store.snapshot.updatedAt.isEmpty {
                    Text("Updated: \(store.snapshot.updatedAt)")
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                }

                Button {
                    store.refreshStatus()
                    store.requestRefresh()
                } label: {
                    Text("Refresh now")
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 4)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 4)
        }
    }
}
