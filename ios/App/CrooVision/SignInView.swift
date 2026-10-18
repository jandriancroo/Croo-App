import SwiftUI

struct SignInView: View {
    @EnvironmentObject var store: VisionStore
    @State private var email = ""
    @State private var password = ""

    var body: some View {
        VStack(spacing: 22) {
            Text("CrooHQ").font(.extraLargeTitle)
            Text("Sign in with your CrooHQ account to pair this Vision Pro.\nYour password is only used once and never saved.")
                .font(.title3).foregroundStyle(.secondary).multilineTextAlignment(.center)
            VStack(spacing: 12) {
                TextField("Email", text: $email)
                    .textContentType(.username)
                    .keyboardType(.emailAddress)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                SecureField("Password", text: $password)
                    .textContentType(.password)
            }
            .textFieldStyle(.roundedBorder)
            .frame(width: 420)

            if let e = store.errorText {
                Text(e).foregroundStyle(VColor.red).font(.callout)
            }

            Button {
                Task { await store.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password) }
            } label: {
                if store.loading { ProgressView() } else { Text("Sign in").frame(width: 200) }
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.extraLarge)
            .disabled(email.isEmpty || password.isEmpty || store.loading)
        }
        .padding(60)
    }
}
