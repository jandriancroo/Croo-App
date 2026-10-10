# Auth options: Apple-first invite sign-in (planning doc)

Status: planning only. Nothing is enabled and no code is changed. Written 2026-10-09 from Jordan's decisions.

## 1. The plan
- **The email invite stays the same shape.** The manager taps Invite (or Hire), and CrooHQ creates the account with name, role, location and wage. The email link is a one-time way in.
- **The invite page offers two options instead of only "set a password":**
  1. **Continue with Apple**: the primary, one-tap option.
  2. **Set a password**: the fallback (today's flow).
- Both options land the person in the account the manager already built, not in a new one.
- **No text or SMS option, and no Twilio.**
- The Quick Invite Link and QR code (`/auth?signup=true`) stay as they are and are out of scope. Known issue: they don't appear to show a sign-up form today.
- Why Apple first: about five out of six staff phones are iPhones.

## 2. Where things stand today
- Sign-in is email and password only (`src/lib/auth.tsx`, `src/pages/Auth.tsx`). Apple is **not enabled**.
- Invites: `supabase/functions/user-service` action `invite` creates the user, then emails a one-time recovery link to `ResetPassword.tsx`.
- Jordan has an Apple Developer account ($99/yr). CrooHQ runs on **Lovable Cloud only**, with no direct Supabase dashboard access.

## 3. Configuring Apple in Lovable Cloud (answers the open question)
Per [Lovable docs](https://docs.lovable.dev/features/apple-auth), go to **Cloud tab → Users → Auth settings → Apple**. There are two modes:
- **Managed by Lovable** (the default). Lovable runs the Apple OAuth setup, so no Apple Developer credentials are needed.
- **Your own credentials.** Use this for CrooHQ's own name on Apple's consent screen, or if the native iOS app needs it. You need these from Apple Developer:
  - an App ID with Sign in with Apple enabled
  - a **Services ID**, which is the Client ID
  - the **Team ID**
  - a **Sign in with Apple key**: the Key ID plus the `.p8` file, which can only be downloaded once
  - In Lovable, enter the Services ID and use the "Generate secret" helper (upload the `.p8`, then enter the Key ID, Services ID and Team ID) to build the JWT. Copy Lovable's Redirect URLs into the Services ID's Return URLs.
  - The JWT expires within 6 months at most, so regenerate it on a reminder.
- **Pick a mode before staff start using it.** Switching modes later can stop Lovable from recognizing users who already signed in with Apple, and Hide-My-Email relay addresses change.
- Ryan's suggestion: start with Managed by Lovable and switch only if the iOS app or branding forces it.

## 4. The real work
Lovable can add the Apple button quickly. The custom part is **linking the invite**, so an Apple sign-in attaches to the manager-created account:
- Match on the one-time invite link or token, **never on email**. Apple's Hide My Email gives an `@privaterelay.appleid.com` address that won't match the invite.
- Link the Apple identity to the existing user (identity linking) rather than creating a new user.
- Keep the real email from the invite on `profiles`.
- Edge cases: expired or used link (offer a re-invite), an Apple ID already linked to another account, and someone who signs in with Apple outside the invite (which would create a duplicate; detect it and prompt).
- Native iOS app (Capacitor): it may need native Apple sign-in and your own credentials. Check this before choosing a mode.

## 5. Open questions
- Managed mode or our own credentials (depends on branding and the iOS app)?
- After someone links Apple, should they still be able to set a password?
