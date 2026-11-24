import SwiftUI

/// First-run pairing. The Apple TV hands typing to your iPhone keyboard when you select a field.
struct SignInView: View {
    @EnvironmentObject var store: TVStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 28) {
            Text("CrooHQ").font(.system(size: 76, weight: .heavy)).foregroundStyle(TVColor.text)
            Text("Sign in with your CrooHQ account to pair this Apple TV.\nYour password is only used once and never saved.")
                .font(.title3).foregroundStyle(TVColor.muted).multilineTextAlignment(.center)
            VStack(spacing: 20) {
                TextField("Email", text: $email)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
            }
            .frame(width: 720)

            if let e = store.errorText {
                Text(e).foregroundStyle(.red).font(.callout)
            }

            Button {
                Task { await store.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
            } label: {
                if store.loading { ProgressView() } else { Text("Pair this Apple TV").frame(width: 360) }
            }
            .disabled(email.isEmpty || password.isEmpty || store.loading)
        }
        .padding(80)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(TVColor.bg)
    }
}
