# Palm Springs PIN kick — third diagnosis (all inside one fresh PWA)

Plan only. No code written. Storage-split hypothesis dropped as instructed.

## Timeline from the database (not inference)

`punch_clock_devices` row `1689ee2a` (Punch Clock PS, Palm Springs):
- `paired_at` 14:44:59Z — code redeemed
- `last_reissue_at` 14:45:01Z, `reissue_count_in_window` 1 — `enterKioskMode` right after redeem
- `last_active_at` 14:47:41Z — last authenticated device call (heartbeat)
- `revoked_at` NULL, `device_secret_hash` present

`punch_clock_attempts`: 14:48:18Z wrong PIN (3688, no match), 14:48:28.838Z Dave `e856079b` success.

**The device session goes silent at 14:47:41 and never speaks again** — no heartbeat, no reissue after the PIN. The PIN itself proves nothing: `punch_clock_lookup_pin`, `punch_clock_get_role` and the `punch_clock_attempts` insert are all granted to `anon` (`supabase/migrations/20260730054636_*.sql:20–21`, `20260731035231_*.sql:155–156`, `20260517011643_*.sql:1–7`).

## 1. Is there an org_admin / manager PIN path? No.

`verifyPin` (`src/pages/PunchClock.tsx` ~895–960) reads the role only into `currentUserRole` state, consumed as a prop for shift/event lists (`PunchClock.tsx:1838`, `1869`). The single role branch in the whole flow is post-clock-out (`PunchClock.tsx:1461–1476`) — non-admin returns to the PIN screen, admin stays — and it did not run (no `time_punches` row). `ManagerDashboardOverlay` has no navigate/sign-out and only opens on a deliberate left swipe (`PunchClock.tsx:239–240`). Dave being org_admin is coincidence.

## 2. What can eject /punch-clock → /auth without tapping Exit

Exactly two call sites exist in the entire app:
- `src/pages/PunchClock.tsx:429–430` — `handleMasterExit`, needs the manager gesture. Not this.
- `src/lib/auth.tsx:174–181` — boot session validation: `getUser()` returns a definitive 401/403/400 → `signOut({ scope: 'local' })` + `navigate('/auth')`.

`AuthProvider` mounts once, so **auth.tsx:179 can only fire on a page load**. So a load happened at ~14:48:29. Candidates, in order:
- The build-check reload on the PIN screen (`PunchClock.tsx:266–282`) — guarded by `onPinScreenRef` and a 3-minute interaction window, so a reload fired *while he was tapping* is unlikely but the guard only reads `lastInteractionRef` at trigger time.
- `useForceReload` (`src/hooks/useForceReload.tsx:60`, `:84`) — the version check and the personal `force-reload` broadcast both call `window.location.reload()` with **no punch-clock guard**; only the universal-update channel is guarded (`useForceReload.tsx:69`). Whether it runs on `/punch-clock` depends on where the hook is mounted — worth confirming, because it is the one unguarded reload in the codebase.
- iOS itself reloading a freshly installed home-screen app on first foreground.

Then on that load: `getSession()` returns the device session, `getUser()` gets a definitive rejection, local sign-out, `/auth`. That is the eject.

## 3. Why would `getPairing()` be null in the same container?

`clearPairing()` (`src/lib/punchDevicePairing.ts:164`) has **zero callers**, and the server never said dead — `reissue` returns `dead` only for a missing row or `revoked_at` (`supabase/functions/punch-device-service/index.ts:313–314`), and the row is neither. `isPairingDead()` would render "Needs Re-Pairing", not "Setting Up". So "Setting Up" strictly requires `getPairing()` (`punchDevicePairing.ts:114–135`) to fail both reads:

- **localStorage write never landed.** Every `setItem` in that file is inside `try {} catch {}` (`punchDevicePairing.ts:139–141`). A quota/partition failure at `redeemPairingCode` (`:536`) is invisible to us and to the floor.
- **Cookie fallback too large.** `setCookie` (`punchDevicePairing.ts:85–90`) `encodeURIComponent`s the *whole* credential — access JWT + refresh token + location + names. Percent-encoding triples every `{ } " : ,`. Past the ~4KB per-cookie limit the browser silently drops or truncates it and `JSON.parse` throws. `updateStoredSession` rewrites that oversized cookie on **every** token event (`:141–147`, `269–271`, `KioskAutoRestore.tsx:90`). If localStorage was already failing, the cookie is the only copy and it is the fragile one.
- **`isUsablePairing` false** (`:107`) — needs `deviceSecret` *or* `session.refresh_token`; a partial write reads as "never paired", i.e. "Setting Up".

Not `auth.tsx` side effects: local `signOut` only removes `sb-*-auth-token`, and `clearActiveAuthSessionLocalOnly` (`punchDevicePairing.ts:59–63`) touches only those keys. `Layout.tsx:726` wipes storage but behind a `window.confirm`.

**Honest limit:** with `clearPairing` uncalled, silent-write-failure is inference, not proof. There is no client telemetry for it, which is itself the bug to fix.

## 4. Does `reissueOnce`'s signOut-before-setSession explain "Setting Up" vs "Open Punch Clock"?

It explains the **signed-out** half, not the label. `reissueOnce` (`punchDevicePairing.ts:288–305`) and the legacy branch of `enterKioskModeOnce` (`:404–415`) both `signOut({ scope: 'local' })` **before** `setSession`; a failed install leaves no session while the blob survives. In that state `PunchDeviceEntry.tsx:83–87` still reads **"Open Punch Clock (Paired Device)"**. So the teardown is real and worth fixing, but the observed label still points at a lost/unreadable blob.

## Leading hypothesis

A page load at ~14:48:29 (unguarded reload or iOS first-foreground) hit `auth.tsx:174–181`, which signed the device out locally and pushed `/auth`. In that same session the pairing blob was never durably readable — localStorage write silently failed and/or the oversized combined cookie was dropped — so `/auth` computed `isPaired() === false` and offered "Setting Up a Punch Clock". Both halves are the same root cause: **the tablet's identity is only as durable as one silently-failing browser write, and nothing can rebuild it from the server.**

## Smallest ship that stops this on a fresh PWA (when Jordan names it)

1. **Tiny durable key, separate from the session.** Write `{ deviceId, deviceSecret }` to its own localStorage key **and** its own cookie (a few hundred bytes, no JWTs). Keep the disposable session blob in localStorage only, out of the cookie. Kills the truncation class entirely.
2. **Verify the write and fail loudly.** After `redeemPairingCode`, read back the pairing; if it is not readable, show the manager an error instead of a green "Paired as …" toast.
3. **Server-backed rebuild instead of "Setting Up".** On boot, if the live auth user has `is_punch_device` but `getPairing()` is null, ask `punch-device-service` who this device is and rewrite the blob (new `whoami`, or reuse `backfill_secret`'s device lookup). Same row, same user, no new code.
4. **Don't eject a tablet.** In `auth.tsx:174–181`, when the stored session is a punch-device session, attempt `reissue`/rebuild before `navigate('/auth')`.
5. **Install the new session before dropping the old one** in `reissueOnce` / `enterKioskModeOnce`, so a mid-failure never lands signed out.
6. **One line of telemetry** at redeem / read-back / eject via `src/utils/serverDebugLog.ts`, so the next incident is answered by data instead of inference.

Also worth confirming in that ship: whether `useForceReload` is mounted anywhere reachable from `/punch-clock` — its two `window.location.reload()` calls (`useForceReload.tsx:60`, `:84`) are the only reloads without a punch-clock guard.

## Floor next step now

Have Dave open the home-screen icon and pair once more with the same name, choosing **Replace it** (`src/components/organization/PunchDeviceManager.tsx`) — that reuses row `1689ee2a` and mints a fresh secret. If it kicks him again immediately, that is confirmation of the write-failure branch rather than a stale-session branch.

## Not doing

No code, no migration, no publish, no revoke of `1689ee2a` — the row is healthy and reusable.
