# Palm Springs punch clock — why the "house key" is missing (diagnosis, plan only)

Short version: the Palm Springs tablet was paired about 90 minutes BEFORE the
pairing-until-revoke ship went live, and it has never reloaded since. So it is
still running the old app code and never got a house key. Nothing on it can
self-heal until somebody reloads that one tablet.

## 1. Where the house key is supposed to be minted

Two places only:

- `supabase/functions/punch-device-service/index.ts` → `redeem`
  (lines ~252–266): mints `deviceSecret`, stores `device_secret_hash` +
  `device_secret_issued_at` on the new `punch_clock_devices` row, returns the
  raw secret to the tablet.
- Same file → `backfill_secret` (lines ~363–387): for a tablet that already
  has a working device session but no key. Called from
  `src/lib/punchDevicePairing.ts` → `backfillSecretOnce()` (~line 334) /
  `ensureDeviceSecret()` (~line 353), which fire from:
  - `src/components/KioskAutoRestore.tsx` line 70 (boot restore),
  - `refreshDeviceSession()` in `punchDevicePairing.ts` (wake / visibility),
  - the legacy stored-token restore branch (~line 389).

Why a Sep 3 morning pair still has NULL:

- Device `ed449595` paired 2026-09-03 09:13 PT. The ship's build stamp is
  `26.09.03.1041` — i.e. published 10:41 PT, ~88 minutes AFTER that pairing.
  The `redeem` that created this row ran on the pre-ship edge function, which
  did not mint a key.
- `last_active_at` equals `paired_at`, and heartbeat lives in the NEW bundle
  (`src/pages/PunchClock.tsx` line 283, `sendDeviceHeartbeat`). No heartbeat
  ever = that tablet has never loaded the new bundle, so no boot/wake backfill
  has ever had a chance to run either. Both facts point at the same thing: old
  code, old row, no key.
- Georgetown (2) and one Hemet tablet are the same shape. Palm Desert has a key
  because it reloaded and backfilled.

## 2. If iOS drops the session overnight and there is no key

Yes — that is the old failure, not a new one.

- `reissueOnce()` (`punchDevicePairing.ts` ~line 279) bails immediately when
  `deviceSecret` is missing, so the primary recovery path is unavailable.
- Recovery then falls back to the stored refresh token. Supabase rotates that
  token on every refresh and a rotated token is single-use, so if iOS killed
  the tab mid-rotation the stored copy is already spent and `setSession` fails.
- On the OLD bundle that latched the "needs a new pairing code" screen. That is
  exactly what Dave is looking at. (On the new bundle it would not latch, but it
  still could not recover without a key.)
- Consistent with zero `punch_clock_attempts` after 2026-09-03 18:00 PT: the
  clock never came back after the evening, so nobody could punch overnight or
  this morning.

## 3. What Dave should do right now (no "Punch Clock PS 2")

In order, stop at the first one that works:

1. On the tablet, force the app to fetch fresh code: swipe the CrooHQ PWA fully
   closed, then reopen it (if it opens to a browser tab instead, pull down to
   refresh). This loads build `26.09.03.1041` or newer.
2. If the punch screen comes up, he is done — `KioskAutoRestore` will mint the
   house key in the background within seconds, and the version stamp in the
   bottom-left corner of the PIN screen should read the new build.
3. If it still lands on the "pair a punch clock" screen after the reload, the
   session really is gone and there is no key to recover with. Then one final
   pairing code is unavoidable — and he must generate it with the SAME device
   name "Punch Clock PS" and choose **Replace**, not Add
   (`PunchDeviceManager` duplicate-name prompt), so the dead row is revoked and
   the list does not grow.

Do not revoke anything before step 1; revoking makes the server declare the
pairing dead and guarantees a new code is needed.

## 4. Is idle-reload / the version stamp enough?

No — chicken and egg. The idle version poll (`PunchClock.tsx` ~lines 247–283),
the Universal Update listener (~line 308) and the 4–6 AM reload
(`KioskAutoRestore.tsx` ~line 109) all live INSIDE the new bundle. A tablet
still running the old bundle listens to none of them, so it will never pull
itself forward. Every live device without a key needs one manual reload:
Palm Springs (1), Georgetown (2), Hemet (1 of 2).

## Candidate follow-up ship (not doing now, needs Jordan to name it)

- Show a "no house key / last seen" health column in the device manager so a
  pre-ship tablet is visible before it fails overnight, instead of us finding it
  by SQL after the floor goes down.
- Consider a service-worker-level version check so a stale shell can update
  itself without depending on new-bundle JS.
