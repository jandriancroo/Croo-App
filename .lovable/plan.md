# Palm Springs PIN kick — revised diagnosis (same host, new build)

Plan only. No code written.

## Role question first: no, org_admin takes no special path

There is no role branch on the PIN path. `verifyPin` (`src/pages/PunchClock.tsx` ~895–960) calls `punch_clock_lookup_pin`, then `punch_clock_get_role` purely to set `currentUserRole` state for event filtering — the value is only consumed as a prop for shift/event lists (`PunchClock.tsx:1838`, `1869`) and never branches to navigation, sign-out or kiosk exit. The only role check anywhere in the flow is *after a clock-out* (`PunchClock.tsx:1461–1476`), where a non-admin returns to the PIN screen after 2s and an admin simply stays — and that path did not run, since there is no `time_punches` row. `ManagerDashboardOverlay` has no navigate/sign-out at all, and it only opens on a deliberate left-swipe (`PunchClock.tsx:239–240`). So Dave being org_admin is a coincidence, not the cause.

## The constraint changes one thing, not everything

Jordan's sequence rules out the *subdomain* split (`kiosk.croohq.com` vs `croohq.com`). It does **not** rule out a storage-container split, because on iOS an "Add to Home Screen" web app gets its own website data store, separate from the Safari tab it was created from. Same host, different jar.

## 1. What runs after `verifyPin` sets the user

`verifyPin` is auth-inert: two RPCs, `setCurrentUser`, `setCurrentUserRole`. No sign-in, no `setSession`, no `signOut`. Then, in order:
- `logPunchAttempt` inserts into `punch_clock_attempts` (`PunchClock.tsx` ~845–890).
- Data effect at `PunchClock.tsx:699–708`: today's shift, last punch, certifications, meeting event.
- Location self-heal at `PunchClock.tsx:712–719`.
- `onPinScreenRef.current` flips to false (`PunchClock.tsx:243–245`), which *disables* the idle and Universal-Update reload paths.

No navigation, no `exitKioskMode`, no repair call. Nothing in `src/components/punchclock/*` navigates except `PunchDeviceEntry.tsx:33,66`, which only goes **to** `/punch-clock`.

**Important discovery:** both PIN RPCs are granted to `anon` (`supabase/migrations/20260730054636_...sql:20–21`, `20260731035231_...sql:155–156`) and `punch_clock_attempts` INSERT is `TO public WITH CHECK (true)` (`20260517011643_...sql:1–7`). A successful PIN and a logged attempt therefore prove **nothing** about the device session being alive. That is why the DB looks healthy.

## 2. Why zero `time_punches`

Nothing auto-punches. A punch only happens on an explicit tap through `insertPunch` (`PunchClock.tsx:334–390`), which would have toasted a real error on failure. No row and no reported error means he never got to tap — the screen changed under him first.

## 3. What can navigate to `/auth` with the punch clock open

Only two things, without a manual tap:
- `src/lib/auth.tsx:174–181` — boot session validation. A definitive 401/403/400 from `getUser()` triggers `signOut({ scope: 'local' })` + `navigate('/auth')`. It is wrapped in a 15s timeout (`auth.tsx:162–166`), so it can resolve **seconds after** the PIN screen already painted. Exact match for "stamp visible, typed PIN, immediately at login".
- `src/components/ProtectedRoute.tsx:11` — irrelevant, `/punch-clock` is unprotected (`src/App.tsx:218`).

`handleMasterExit` (`PunchClock.tsx:415–437`) also lands on `/auth` but needs the manager gesture.

## 4. Every way `getPairing()` becomes null

`clearPairing()` (`src/lib/punchDevicePairing.ts:164`) has **zero callers**. `getPairing()` returns null only when the read fails (`punchDevicePairing.ts:112–135`):

1. **Different storage container** — redeem in the Safari tab, login screen in the home-screen app (own data store, `start_url: "/"` per `public/manifest.webmanifest`).
2. **`isUsablePairing` false** (`punchDevicePairing.ts:107`) — `deviceId` present but no `deviceSecret` and no `refresh_token`. Reads as "never paired", not "dead".
3. **Cookie fallback truncated** — `setCookie` (`punchDevicePairing.ts:85–90`) writes the whole credential (access JWT + refresh token + location) as one cookie; past ~4KB browsers drop or truncate it and `JSON.parse` fails silently. Every `updateStoredSession` rewrite (`punchDevicePairing.ts:141–147`, `269–271`) re-writes that oversized cookie.
4. **localStorage write silently swallowed** — every `setItem` there is in `try {} catch {}`.
5. **Deleting the old home-screen app** clears that app's store; the new install starts empty.

## 5. Can `repairDeviceSession` / `reissueOnce` strand it at `/auth`?

Mechanically yes: `reissueOnce` (`punchDevicePairing.ts:265–290`) calls `signOut({ scope: 'local' })` **before** `setSession`; a failed install leaves no session while the blob survives. But in that state `PunchDeviceEntry.tsx:83–87` would say **"Open Punch Clock (Paired Device)"**. Dave saw the third branch, so the blob itself was unreadable where that screen rendered.

## Leading hypothesis

Two things, and only together do they give these symptoms:
1. The pairing blob and the login screen were in **different iOS storage containers** — pairing/PIN in one, the "Setting Up a Punch Clock" screen in the other. That is the only explanation for the third label with `clearPairing` uncalled and `dead` unset.
2. The eject to `/auth` is the async boot validation in `auth.tsx:174–181` — no reload needed, DB stays healthy.

Underneath both: a tablet's paired identity lives **only** in browser storage, and every recovery path (`enterKioskMode`, `refreshDeviceSession`, `KioskAutoRestore.tsx:38`) is gated on `isPaired()`. The moment the blob is unreadable the tablet cannot self-heal even though the server row, secret and auth user are fine.

## Floor next step (does not mint "Punch Clock PS 2")

From the **home-screen icon only**, never a Safari tab:
1. Open the icon and read the button on the login screen: "Open Punch Clock (Paired Device)", "Needs Re-Pairing", or "Setting Up a Punch Clock". That word is the whole diagnosis.
2. "Open Punch Clock" → tap it, done, no code.
3. "Setting Up a Punch Clock" → pair once from inside the icon app and choose **Replace it** in the duplicate-name dialog (`src/components/organization/PunchDeviceManager.tsx`), never "Add a new device". Then force-quit and reopen to confirm it returns straight to the punch clock.

## Fix I would propose (only when Jordan names a ship)

- Server-backed pairing rebuild: on boot, if the live auth user is a punch device but `getPairing()` is null, ask `punch-device-service` who this device is and rewrite the blob (reusing `reissue` / `backfill_secret`). Same row, same user, no new code.
- Before `auth.tsx` navigates to `/auth`, attempt a device reissue when the tablet has any device marker.
- Put only `deviceId` + `deviceSecret` in the cookie; keep the disposable session in localStorage.
- `reissueOnce` should install the new session **before** dropping the old one.

## Not doing

No code, no migration, no publish, no revoke of device `1689ee2a` — that row is healthy and reusable.
