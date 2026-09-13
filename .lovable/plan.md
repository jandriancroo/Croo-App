# Cold-boot "logged in as USER" theory — verdict: CONFIRMED

Every step of the theory matches the live code. A device session alone fully explains it; no human login is needed.

## Evidence

**1) Home route sends any signed-in session to the dashboard — CONFIRMED**
`src/App.tsx:169-173`
```
const HomeRoute = () => {
  const { user, loading } = useAuth();
  if (!loading && user) return <Navigate to="/dashboard" replace />;
```
No check for a punch device. The PWA start URL is `/`, so a restored device session lands on `/dashboard`.

**2) The "User" label is the no-profile fallback — CONFIRMED**
`src/components/Layout.tsx:565` selects `full_name, profile_photo_url, nickname` from `profiles`; line 698 `... || 'User'` and line 1189 `{displayFullName || 'User'}`. No name, no photo, no role → literally "User".

**3) Kiosk restore is skipped when a session exists — CONFIRMED**
`src/components/KioskAutoRestore.tsx:57-60`
```
const coldRestore =
  !isKioskExitActive() && !isDeviceSession && !user && path !== '/punch-clock';
if (!explicitPunchClock && !coldRestore) return;
```
`coldRestore` requires `!user` **and** `!isDeviceSession`. A healthy device session satisfies neither, so nothing pulls the tablet back to `/punch-clock`. The only other path (`explicitPunchClock`) needs the URL to already be `/punch-clock`.

**4) Paired tablets are real auth users with no profile — CONFIRMED**
`supabase/functions/punch-device-service/index.ts:235-240` creates the user with `user_metadata: { is_punch_device: true }`; `isPunchDeviceUser` (`src/lib/punchDevicePairing.ts:173`) reads that flag. Live check of all 6 unrevoked devices: every one has `is_punch_device = true`, **zero** have a `profiles` row, all `full_name` null, none revoked. Palm Springs device `1689ee2a` was active minutes ago.

**5) Device session alone explains the label — CONFIRMED**
The label depends only on a missing profile row, and device users never have one. No human sign-in required. Pairing is healthy (secret present, `revoked_at` null), so nothing in the pairing layer trips.

## Net effect

Power loss → tablet relaunches at `/` → device session restores → dashboard as "User", with no punch clock and no PIN pad. Staff see a logged-in app instead of the clock.

## Fix shape (not written — awaiting "ship")

1. In `HomeRoute`, when the session is a punch device, redirect to `/punch-clock` instead of `/dashboard`.
2. In `KioskAutoRestore`, add a third case: paired device + device session + not on `/punch-clock` + no exit flag → navigate to `/punch-clock`. Catches any other entry URL.
3. Optional belt-and-braces: `ProtectedRoute` bounces device sessions off non-punch-clock routes.

Locked-feature note: this touches punch-clock pairing/restore, which is under the Pairing Until Revoke lock. The proposed change is routing only — no pairing, secret, reissue, or punch-write logic — but it needs Jordan's explicit go-ahead.
