import SwiftUI

/// Watch-formatted version of the dashboard Sales Summary.
struct SalesSummaryView: View {
    @EnvironmentObject var store: WatchDataStore

    private var headline: WatchMetric? { store.snapshot.sales.first }
    private var rest: [WatchMetric] { Array(store.snapshot.sales.dropFirst()) }

    var body: some View {
        Group {
            if !store.isPaired {
                EmptyStateView(
                    title: "Not Paired",
                    message: "Pair this Watch from CrooHQ on iPhone."
                )
            } else if store.snapshot.sales.isEmpty {
                EmptyStateView(
                    title: "No Sales Data",
                    message: "Pull to refresh from the Status tab."
                )
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 10) {
                        if let headline {
                            VStack(alignment: .leading, spacing: 0) {
                                Text(headline.label.uppercased())
                                    .font(.system(size: 10, weight: .semibold))
                                    .foregroundStyle(.secondary)
                                Text(headline.value)
                                    .font(.system(size: 30, weight: .bold, design: .rounded))
                                    .monospacedDigit()
                                    .minimumScaleFactor(0.6)
                                    .lineLimit(1)
                            }
                        }

                        VStack(spacing: 4) {
                            ForEach(rest, id: \.self) { metric in
                                HStack {
                                    Text(metric.label)
                                        .font(.system(size: 12))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(1)
                                    Spacer(minLength: 4)
                                    Text(metric.value)
                                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                                        .monospacedDigit()
                                }
                                .padding(.vertical, 3)
                                .padding(.horizontal, 8)
                                .background(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(Color.white.opacity(0.08))
                                )
                            }
                        }

                        if !store.snapshot.locationName.isEmpty {
                            Text(store.snapshot.locationName)
                                .font(.system(size: 10))
                                .foregroundStyle(.tertiary)
                        }
                    }
                    .padding(.horizontal, 4)
                    .padding(.bottom, 8)
                }
            }
        }
        .navigationTitle("Sales")
    }
}
