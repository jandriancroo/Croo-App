# Palm Springs PIN kick — revised diagnosis (same host, new build)

Plan only. No code written.

## The constraint changes one thing, not everything

Jordan's sequence rules out the *subdomain* split (`kiosk.croohq.com` vs `croohq.com`). It does **not** rule out a storage-container split, because on iOS an "Add to Home Screen" web app gets its own website data store, separate from the Safari tab it was created from. Same host, different jar. Everything below is traced against that.

## 1. What runs after `verifyPin` sets the user

`verifyPin` (`src/pages/PunchClock.tsx` ~895–960) is auth-inert: `punch_clock_lookup_pin` RPC, `punch_clock_get_role` RPC, `setCurrentUser`, `setCurrentUserRole`. No sign-in, no `setSession`, no `signOut`.

Then, in order:
- `logPunchAttempt` inserts into `punch_clock_attempts` (`PunchClock.tsx` ~845–890).
- Data effect at `PunchClock.tsx:699–708`: `checkTodayShift`, `checkLastPunch`, `checkExpiringCertifications`, `checkActiveMeetingEvent`.
- Location self-heal at `PunchClock.tsx:712–719` — if the location is missing after PIN it calls `refetchLocations()`.
- `onPinScreenRef.current` flips to false (`PunchClock.tsx:243–245`), which *disables* the idle reload and Universal-Update reload paths.

No navigation, no `exitKioskMode`, no repair call on this path. Nothing in `src/components/punchclock/*` navigates except `PunchDeviceEntry.tsx:33,66`, which only ever goes **to** `/punch-clock`.

**Important discovery:** both PIN RPCs are granted to `anon` (`supabase/migrations/20260730054636_...sql:20–21`, `20260731035231_...sql:155–156`) and `punch_clock_attempts` INSERT is `TO public WITH CHECK (true)` (`20260517011643_...sql:1–7`). A successful PIN and a logged attempt therefore prove **nothing** about the device session being alive. That is why the DB looks healthy.

The one thing the PIN *did* need is a location: the kiosk gets it from the pairing blob (`src/hooks/useLocation.tsx:68–88`, device short-circuit) or from the `currentLocationCache` localStorage hydrate (`useLocation.tsx:38–47`). So at PIN time, that container had either a live device session **or** a cached location left over from earlier.

## 2. Why zero `time_punches`

Nothing auto-punches. After PIN the screen is identity + today's shift; a punch only happens on an explicit tap through `insertPunch` (`PunchClock.tsx:334–390`). A failed punch would have surfaced a toast and, on an auth-shaped error, run `repairDeviceSession`. No row and no reported punch error is consistent with: he never got to tap — the screen changed under him first.

## 3. What can navigate to `/auth` with the punch clock open

Only two things in the whole app can do it without a manual tap:

- `src/lib/auth.tsx:174–181` — boot session validation. A definitive 401/403/400 from `getUser()` triggers `signOut({ scope: 'local' })` + `navigate('/auth')`. This fires on the *initial* load and can resolve **seconds after** the PIN screen already painted (the check is wrapped in a 15s timeout, `auth.tsx:162–166`). That is a perfect match for "stamp was visible, typed PIN, immediately at login".
- `src/components/ProtectedRoute.tsx:11` — irrelevant here, `/punch-clock` is unprotected (`src/App.tsx:218`).

`handleMasterExit` (`PunchClock.tsx:415–437`) also goes to `/auth`, but requires the manager gesture.

## 4. Every way `getPairing()` becomes null

`clearPairing()` (`src/lib/punchDevicePairing.ts:164`) has **zero callers**, so this is never a deliberate un-pair. `getPairing()` returns null only when the read fails (`punchDevicePairing.ts:112–135`):

1. **Different storage container.** Redeem happened in the Safari tab; the login screen shown was the newly installed home-screen app (its own data store, `start_url: "/"` per `public/manifest.webmanifest`). Blob genuinely absent there.
2. **`isUsablePairing` false** (`punchDevicePairing.ts:107`): `deviceId` present but neither `deviceSecret` nor `session.refresh_token`. Reads as "never paired", not "dead".
3. **Cookie fallback truncated.** `setCookie` (`punchDevicePairing.ts:85–90`) writes the whole credential — access token JWT + refresh token + location — as one cookie. Past the ~4KB per-cookie limit the browser drops or truncates it, and `JSON.parse` then fails silently. Every `updateStoredSession` / `applySession` rewrite (`punchDevicePairing.ts:141–147`, `269–271`) re-writes that oversized cookie. If the localStorage write ever failed (quota / eviction), the cookie is the only copy and it is the fragile one.
4. **localStorage write silently swallowed.** Every `setItem` in that file is wrapped in `try {} catch {}` — a failed write is indistinguishable from a successful one.
5. **Deleting the old home-screen app** clears that app's data store. It does not clear the Safari tab's, and the new install starts empty — which is exactly the seam this floor sequence walked through.

## 5. Can `repairDeviceSession` / `reissueOnce` strand the tablet at `/auth`?

Yes, mechanically. `reissueOnce` (`punchDevicePairing.ts:265–290`) does `signOut({ scope: 'local' })` **before** `setSession`. If `setSession` then fails, the tablet is left with no session at all while the pairing blob survives. `enterKioskModeOnce` (`punchDevicePairing.ts:390–410`) has the same shape on the legacy token branch. In that state `PunchDeviceEntry` (`src/components/punchclock/PunchDeviceEntry.tsx:83–87`) would still say **"Open Punch Clock (Paired Device)"** — because pairing is present and not dead.

Dave saw **"Setting Up a Punch Clock"**, the third branch. So the signed-out-but-still-paired failure is *not* what he hit. The blob was unreadable in the container that rendered that screen.

## Leading hypothesis

Two things happened, and only together do they produce these exact symptoms:

1. The pairing blob and the login screen were in **different iOS storage containers** — redeem/PIN in one, the "Setting Up a Punch Clock" screen in the freshly installed home-screen app (or vice-versa). That, and only that, explains the third label with `clearPairing` uncalled and `dead` unset.
2. The session teardown that ejected him to `/auth` is the boot validation in `auth.tsx:174–181`, which resolves asynchronously and can land right after the PIN — no reload required, and it leaves the DB completely healthy.

The deeper design flaw underneath both: a tablet's paired identity lives **only** in browser storage. Every recovery path (`enterKioskMode`, `refreshDeviceSession`, `KioskAutoRestore.tsx:38`) is gated on `isPaired()`, so the moment the blob is unreadable the tablet cannot self-heal even though the server row, the secret and the auth user are all fine.

## Floor next step (does not mint "Punch Clock PS 2")

Have Dave do this in one pass, from the **home-screen icon only** — not a Safari tab:

1. Open the icon. Note what the button says on the login screen: "Open Punch Clock (Paired Device)", "Needs Re-Pairing", or "Setting Up a Punch Clock". That single word is the whole diagnosis.
2. If it says "Open Punch Clock", tap it — done, no code.
3. If it says "Setting Up a Punch Clock", pair once from **inside the icon app**, and when the duplicate-name dialog appears choose **Replace it** (`src/components/organization/PunchDeviceManager.tsx`), never "Add a new device". Then verify from the icon that a force-quit and reopen returns straight to the punch clock.

Do all future pairing from the installed icon. Pairing in a Safari tab writes the credential into a jar the icon app cannot read.

## Fix I would propose (only when Jordan names a ship)

- Server-backed pairing rebuild: on boot, if the live auth user is a punch device (`is_punch_device`) but `getPairing()` is null, ask `punch-device-service` who this device is and rewrite the blob (reusing the existing `reissue` / `backfill_secret` actions). Same row, same user, no new code.
- Before `auth.tsx` navigates to `/auth` on an invalid stored session, attempt a device reissue when the tablet has any device marker.
- Stop writing the full credential into one cookie; store only `deviceId` + `deviceSecret` there (small, durable) and keep the disposable session in localStorage only.
- `reissueOnce` should install the new session **before** dropping the old one, so a mid-failure never lands signed out.

## Not doing

No code, no migration, no publish, no revoke of device `1689ee2a` — that row is healthy and reusable.
