# Second opinion: punch-clock pairing that lasts until a manager revokes it

Read: `src/lib/punchDevicePairing.ts`, `src/components/KioskAutoRestore.tsx`, `src/pages/PunchClock.tsx`, `supabase/functions/punch-device-service/index.ts`, plus the live `punch_clock_devices` columns.

## Verdict on the diagnosis

Right root cause. The 60-minute code window is a decoy, and "keep it paired until a manager revokes" is a real, safe option — the database already works that way (`revoked_at` is the only kill switch; there is no TTL on a live device row).

The break is refresh-token handling on the tablet, and the code confirms three separate ways it can fail:

1. **Single-use refresh token, two copies.** The tablet keeps its own copy of the refresh token in localStorage and a 400-day cookie. Supabase rotates the token on every refresh. If the rotated value isn't written back before iOS kills the tab, the stored copy is spent, `setSession` fails, `markPairingBroken()` latches, and the only path the UI offers is a new code.
2. **Two restore paths race for the same token.** `enterKioskMode` is called both from auto-restore and from the login-screen button. There is a guard for "already the device session", but a cold launch where two callers arrive before a session exists can still burn one token and fail the other.
3. **No server recovery.** Redeem creates a fresh GoTrue user *and* a fresh device row every time, and the device password is thrown away after minting the session. So once the tablet's token copy is stale there is literally nothing on the server to fall back to — hence "Front" then "Front iPad 2", and a growing pile of orphan device users.

The heartbeat observation is also right: `last_active_at` equals `paired_at` on every row because nothing calls the `heartbeat` action except a single unrelated refresh call in `PunchClock.tsx`. That's missing telemetry, not the drop.

## On the proposed ship (Option 3)

Broadly correct. Reissue-by-device-secret is the right auth model — it's a proof-of-possession bearer credential that, unlike a refresh token, is **not single-use and not rotated**, which is exactly the property the current design lacks. Keep it.

What I'd change before any ship:

- **The device secret must be the durable credential, and the session becomes disposable.** Don't treat reissue as an edge-case fallback bolted onto the current flow. On any restore failure — and on any "session missing/expired" at launch — go straight to `reissue`. Store the secret in the same localStorage + cookie pair; it never rotates, so a stale copy is impossible.
- **Delete `markPairingBroken` as a terminal state.** Today it latches forever on a single failure. It should only be set when the server explicitly says the device row is gone or revoked. Everything else is retryable.
- **Server-side reissue mechanism:** the admin API can't "sign in as" a user, so reissue should rotate that device user's password to a new random value and immediately mint a session with it. Same `auth_user_id`, same device row, no second user. Worth confirming this before ship since it's the one implementation unknown.
- **Rate-limit and log reissue.** It's a permanent credential; cap it (e.g. a handful per device per hour) and stamp `last_active_at` on every call, so reissue doubles as the heartbeat.
- **Migration for existing tablets.** The six live devices have no secret. Add a one-time path: a tablet still holding a *working* session can call `reissue` authenticated by that session and receive a secret going forward. The ones already broken will need one final code — say so out loud rather than promising zero re-pairs.
- **Fix the race, not just the recovery.** Serialize restore behind the existing single-flight promise across *both* entry points, and write the rotated token back synchronously before any navigation.
- **Point 6 (revive on same location + name) — I'd narrow it.** Reviving by name is fuzzy and can hand a second physical tablet the first one's identity. Better: reissue makes new codes rare in the first place; when a code *is* redeemed at a location that already has an unrevoked device with that exact name, surface it to the manager ("replace Front, or add a new device?") rather than silently merging. Separately, add a cleanup pass that deletes orphaned GoTrue users for revoked rows.

## What we explicitly should not do

- **No TTL on live devices.** Not 30 days, not 400. A tablet that sat quiet through a holiday closure must wake up paired. Theft is a revoke, not a timer.
- **Don't touch the 60-minute unused-code window.** Neither shortening nor lengthening it changes the floor symptom.
- **Don't fold in exit-kiosk (30-minute UI flag) or the 4–6am reload.** Different mechanisms, different purposes; leave both alone.
- **Don't expire on stale `last_active_at`** even after the heartbeat starts reporting.
- **No human passwords, no Relay credentials on the device.** Device-scoped secret only.
- **Don't widen what the device session can read.** Reissue must return the same identity with the same access, nothing more.

## Files / edge actions in scope (high level)

- `punch_clock_devices`: add a hashed device-secret column (migration).
- `supabase/functions/punch-device-service`: new `reissue` action; `redeem` also mints and returns the secret; duplicate-name handling on redeem; orphan-user cleanup.
- `src/lib/punchDevicePairing.ts`: store the secret, reissue-first recovery, retire the latching broken flag, tighten single-flight.
- `src/components/KioskAutoRestore.tsx`: stop bailing on the broken flag; route failures into reissue.
- `src/pages/PunchClock.tsx`: call heartbeat on visible/wake.
- `src/components/punchclock/PunchDeviceEntry.tsx` and `src/components/organization/PunchDeviceManager.tsx`: only ask for a code when the device is genuinely gone or revoked; manager-facing duplicate-name prompt.

No code written. Name the ship and I'll build it.
