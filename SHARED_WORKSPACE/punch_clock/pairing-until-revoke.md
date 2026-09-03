# Punch Clock — Pairing Until Revoke (LOCKED)

Owner: Jordan · Librarian: Ryan · Locked ship: **2026-09-03**

This file is the lock. Read it before touching punch-clock pairing, kiosk restore,
version reload, or the punch write path.

---

## The floor loop we killed

1. Clock froze for employees (stale access token / hung refresh).
2. Staff force-quit the PWA.
3. Login screen said "Setting up a punch clock — click here" / asked for a code.
4. Manager minted a new code. Redeem created a NEW auth user + NEW device row.
5. Device list grew: `Front`, then `Front iPad 2`. The old row was never revoked.

The 60-minute unused-code expiry was never the cause and is unchanged.

## Root cause

Supabase rotates the refresh token on every refresh, and a rotated token is
single-use. The tablet kept its own copy in localStorage + a 400-day cookie. If
iOS killed the tab before the rotated value was written back, the stored copy was
spent, `setSession` failed, the old `markPairingBroken()` latched permanently, and
the only offered path was a new pairing code. The server had no recovery path
either, because the device password was discarded right after redeem.

## The model (do not change without Jordan)

- **Durable credential = device secret.** Minted at redeem, stored hashed on
  `punch_clock_devices.device_secret_hash`, held on the tablet in the same
  localStorage + cookie pair as the pairing. It never rotates.
- **Sessions are disposable.** `reissue` (deviceId + secret) rotates the device
  user's password and mints a fresh session for the SAME `auth_user_id` and SAME
  device row. No second GoTrue user. No second device row.
- **Reissue is the primary restore**, not a fallback. Stored-refresh-token restore
  is only the legacy path for tablets paired before this ship.
- **Only the server can declare a pairing dead** — device row missing or
  `revoked_at` set. Everything else is retryable.
- **Revoke is the only kill switch.** No TTL on a live device. `last_active_at` is
  telemetry only. Stolen tablet = manager revokes.

## Explicitly unchanged

- Unused pairing codes still expire in 60 minutes.
- Exit-kiosk stays a 30-minute UI flag.
- The 4:00–6:00 AM daily kiosk reload stays.
- The device session's data access was not widened. No human passwords, no Relay
  credentials on the tablet.

## One shared lock

`withPairingLock(task, fn)` in `src/lib/punchDevicePairing.ts` is the ONLY lock.
Tasks: `boot-restore`, `wake-repair`, `secret-backfill`, `punch-repair`,
`idle-reload`. Same task joins the in-flight run; a different task defers. Nothing
gets its own private lock — that race is what burned the single-use token.

## In-session repair (the freeze fix)

Every punch write goes through `insertPunch()` in `src/pages/PunchClock.tsx`:
bounded 12-second wait → on auth error or hang, `repairDeviceSession()` → retry
exactly once → otherwise a real, readable error. No unbounded spinner.

## Idle build reload

- `/version.json` is emitted at build time with the same `YY.MM.DD.HHMM` Pacific
  value as `__APP_VERSION__` (see `vite.config.ts`).
- The poll is a plain unauthenticated `fetch` with `no-store` and a hard timeout.
  It must NEVER ride the punch clock's Supabase session — a dying session hanging
  the version check would recreate the freeze.
- Reload only when: on the PIN screen, no touch for ~3 minutes, shared lock free,
  and server version differs. Then cache-busted `?v=` reload.
- Wired into the existing wake/visibility trigger (iOS suspends background timers).
- `index.html` carries no-store/no-cache headers so WKWebView can't re-serve the
  old shell.

## PIN version stamp

`src/components/punchclock/BuildVersionStamp.tsx` — bottom-left corner, low
contrast, `pointer-events-none`, no tap handler. Shows the running build and when
this iPad last loaded it. A stale stamp after a publish means idle-reload failed.

## Duplicate device name

`generate` returns `{ duplicate: true }` when the location already has an
unrevoked device with that exact name. The manager picks **Replace** (revokes the
old row and deletes its orphan GoTrue user) or **Add**. Never a silent merge.

## Migration path

Healthy paired tablets keep working and mint a secret in the background via
`backfill_secret`, authenticated by their existing device session — no new code.
Tablets already sitting on "needs a new pairing code" need one last code.

---

## Changelog

### 2026-09-03 — initial lock (shipped)
- Migration: `punch_clock_devices` + `device_secret_hash`,
  `device_secret_issued_at`, `last_reissue_at`, `reissue_window_start`,
  `reissue_count_in_window`. No rows dropped, nobody revoked.
- `punch-device-service`: added `reissue` (rate-limited 12/hour/device,
  constant-time hash compare, stamps `last_active_at`), added
  `backfill_secret`, `redeem` now mints + returns the secret, `generate` gained
  duplicate-name detection and the replace path, `revoke` clears the secret hash.
- `src/lib/punchDevicePairing.ts`: secret storage, reissue-first restore, one
  shared lock, `markPairingBroken` retired in favor of server-declared
  `isPairingDead`, `withTimeout` helper, `sendDeviceHeartbeat`.
- `KioskAutoRestore`: restores via reissue, no longer bails on a one-off failure,
  respects the shared lock in the 4–6 AM reload.
- `PunchClock`: heartbeat on wake, `insertPunch` repair-and-retry with timeout,
  idle version poll + cache-busted reload, build stamp on the PIN screen.
- `PunchDeviceEntry`: asks for a new code only when the server says revoked.
- `PunchDeviceManager`: replace-vs-add prompt at code generation.
- `vite.config.ts` / `index.html`: `/version.json` endpoint, no-store HTML.
