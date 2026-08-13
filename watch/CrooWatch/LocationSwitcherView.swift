import SwiftUI

/// Full-screen picker listing every location this watch is scoped to.
/// Selecting one saves the choice and reloads Cubes / Schedule / Sales.
struct LocationSwitcherView: View {
    @EnvironmentObject var store: WatchDataStore
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(spacing: 6) {
                if store.locations.isEmpty {
                    Text("No other locations available for this watch.")
                        .font(.system(size: 12))
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .padding(.top, 12)
                } else {
                    ForEach(store.locations) { loc in
                        Button {
                            store.selectLocation(loc.id)
                            dismiss()
                        } label: {
                            HStack(spacing: 8) {
                                Text(loc.name)
                                    .font(.system(size: 14, weight: .medium))
                                    .lineLimit(1)
                                Spacer()
                                if loc.id == store.selectedLocationId {
                                    Image(systemName: "checkmark")
                                        .font(.system(size: 11, weight: .bold))
                                        .foregroundStyle(.green)
                                }
                            }
                            .padding(.vertical, 8)
                            .padding(.horizontal, 10)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(Color.white.opacity(loc.id == store.selectedLocationId ? 0.14 : 0.07))
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 4)
            .padding(.bottom, 8)
        }
        .navigationTitle("Location")
    }
}

/// Tappable header pill showing the current location name.
struct LocationHeaderButton: View {
    @EnvironmentObject var store: WatchDataStore
    @State private var showSwitcher = false

    var body: some View {
        Button {
            showSwitcher = true
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "mappin.and.ellipse")
                    .font(.system(size: 10, weight: .semibold))
                Text(store.currentLocationName.isEmpty ? "Location" : store.currentLocationName)
                    .font(.system(size: 12, weight: .semibold))
                    .lineLimit(1)
                if store.isSwitchingLocation {
                    ProgressView().scaleEffect(0.5).frame(width: 10, height: 10)
                } else if store.locations.count > 1 {
                    Image(systemName: "chevron.down")
                        .font(.system(size: 8, weight: .bold))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.vertical, 5)
            .padding(.horizontal, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
        }
        .buttonStyle(.plain)
        .sheet(isPresented: $showSwitcher) {
            LocationSwitcherView().environmentObject(store)
        }
    }
}
