# Palm Springs: healthy on the server, "unpaired" on the tablet

Plan only. Nothing written to app code.

## What the trace actually shows

The PIN itself is innocent. `verifyPin` in `src/pages/PunchClock.tsx` (~line 895–960) does exactly three things: an RPC `punch_clock_lookup_pin`, an RPC `punch_clock_get_role`, and `setCurrentUser`. There is no `signInWithPassword`, no `setSession`, no `signOut` anywhere on that path. A successful PIN cannot log the device out.

`clearPairing()` exists at `src/lib/punchDevicePairing.ts:164` and has **zero call sites** in the repo. No code path un-pairs a tablet. `markPairingDead()` is only set when the server answers `dead: true` (`punchDevicePairing.ts:277`, `348`).

That last point is the tell. `src/components/punchclock/PunchDeviceEntry.tsx:83–87` picks its label in this order:

- paired and not dead -> "Open Punch Clock (Paired Device)"
- dead -> "Punch Clock Needs Re-Pairing"
- otherwise -> "Setting Up a Punch Clock"

Dave saw the third one. So the client did not decide the pairing was broken. `getPairing()` returned **null** — meaning both the localStorage key `croohq_punch_device_v1` **and** the 400-day cookie fallback were unreadable from whatever container that screen was running in (`punchDevicePairing.ts:112–135`).

## Sequence that produces the exact symptom

1. Code redeemed, device row healthy, secret minted, session installed via `reissue` (~2s after redeem — matches `last_reissue_at`).
2. PIN works. Still no auth change.
3. Something reloads the page — the kiosk reloads itself on wake/new build (`PunchClock.tsx:263–298`) and on Universal Update (`PunchClock.tsx:301–330`).
4. On that fresh boot, `AuthProvider` (`src/lib/auth.tsx:150–180`) validates the stored session. A definitive 401/403 triggers a local sign-out and `navigate('/auth')`.
5. `/punch-clock` is not a protected route, so nothing else ejects — but `KioskAutoRestore` (`src/components/KioskAutoRestore.tsx:38`) bails immediately because `isPaired()` is false, so nothing restores the device.
6. Login screen, pairing storage empty -> "Setting Up a Punch Clock".

## Leading hypothesis (needs one confirmation on the tablet)

The pairing blob is in a **different storage container than the screen Dave ended up on**. Two variants, both consistent with the DB:

- **A. Container / origin split.** The pairing was redeemed in Safari (or on `croohq.com`) and the home-screen PWA is a separate WebKit data store — and `kiosk.croohq.com` is a genuinely separate origin (documented in the kiosk-subdomain memory). Storage does not cross either boundary, so the PWA is legitimately blank.
- **B. Blob written but rejected on read.** `isUsablePairing` (`punchDevicePairing.ts:107`) requires `deviceId` plus either `deviceSecret` or `session.refresh_token`. A partial write would read back as "not paired" rather than "dead".

Confirmation before any code: on the tablet, in the *same* context Dave uses, check whether `croohq_punch_device_v1` exists in localStorage and in cookies, and note the exact host shown in the address bar / which icon was tapped. That single check separates A from B.

## The one fix I would make

Stop treating client storage as the only proof of pairing. Today a tablet that still holds a valid **device auth session** but has an empty pairing blob looks completely unpaired, and every self-heal path (`enterKioskMode`, `refreshDeviceSession`, `KioskAutoRestore`) is gated behind `isPaired()` — so it can never recover itself.

Fix: add a server-backed rebuild. On boot, if the live auth user has `user_metadata.is_punch_device === true` but `getPairing()` is null, ask `punch-device-service` who this device is, write the pairing record back (including a freshly issued secret via the existing `backfill_secret`/`reissue` actions), and continue into kiosk mode instead of falling through to the login screen. Same device row, same auth user, no new pairing code, no duplicate "Punch Clock PS 2".

Secondary guard in the same change: while a device session is expected, the boot invalid-session branch in `auth.tsx` should attempt device reissue before it navigates to `/auth`.

Neither of those helps variant A (separate origin = separate everything). If the check shows A, the fix is operational instead: pair inside the exact icon/host the floor uses, and we standardise on one kiosk entry point.

## What Dave should do right now

1. Force-quit and reopen the punch clock icon once. If the screen says "Open Punch Clock (Paired Device)", tap it — no code needed.
2. If it still says "Setting Up a Punch Clock", note the host in the address bar first (that is the evidence), then use one final pairing code and choose **Replace it**, never "Add a new device", so we do not grow the device list.

## Not doing

No code, no migration, no publish. No revoking the live Palm Springs device — the server row is healthy and reusable.
