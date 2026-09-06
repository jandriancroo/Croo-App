# Punch clock failure logging (Palm Springs "can't clock in")

Goal: when a tablet refuses a punch, we should be able to look up exactly what failed, on which tablet, at which store, and when — without waiting for someone to describe it on the phone.

## 1. What gets recorded today

- **PIN entry:** every attempt (good or bad) is written to `punch_clock_attempts` — PIN typed, success flag, matched employee, guessed scheduled employees. `src/pages/PunchClock.tsx:875` (`logPunchAttempt`), called from `verifyPin` at `:889`. Rows are pruned after 7 days (`supabase/functions/maintenance-service/index.ts:334`). Insert is open to any visitor, so a dead session still records the attempt. This is why we can see "successful PINs through 19:36 PT" but nothing about the failure after.
- **Punch write:** nothing is recorded. `insertPunch` (`src/pages/PunchClock.tsx:338`) retries once after a session repair and then returns a friendly sentence to the screen. Timeouts, permission errors and network failures all vanish into the tablet's own console.
- **Session repair:** nothing is recorded. `repairDeviceSession` (`src/lib/punchDevicePairing.ts:542`) returns only true/false; `sendDeviceHeartbeat` (`:556`) swallows every error on purpose.
- **General debug table:** `client_debug_logs` exists with a helper (`src/utils/serverDebugLog.ts`) but nothing punch-related writes to it, and its insert rule requires a signed-in session — exactly what is missing during the failures we want to catch. So it is not usable as-is for this.

Net: the only punch-clock evidence we have today is PIN attempts. The failure Jordan is chasing produces zero records.

## 2. Proposed smallest durable ship

**One new table, `punch_clock_failures`**, written from the tablet on every failed punch path.

Captured per row: store, device id, device name, employee id, punch type (in / out / break), stage (`insert`, `repair`, `retry`, `pin_lookup`), reason bucket (`timeout`, `auth`, `permission`, `network`, `unknown`), the raw error text, whether a repair was attempted and whether it worked, plus timestamp and a short app-version / user-agent stamp. No wages, no names, no PINs — just the employee id when we have one.

Access: writes allowed without a session (same open-insert shape `punch_clock_attempts` already uses, so a broken session can still report itself); reads limited to manager-and-above. Pruned after 30 days alongside the existing nightly cleanup.

Where the writes go in:
- `src/pages/PunchClock.tsx` — inside `insertPunch`, one record on first-attempt failure, on repair failure, and on retry failure.
- `src/pages/PunchClock.tsx` — one record when the PIN lookup errors out (today it only logs a failed *match*, not a failed *query*).
- `src/lib/punchDevicePairing.ts` — one record when `repairDeviceSession` gives up, and one when a heartbeat fails repeatedly.

Then a plain read-only list under Punch Clock Devices (or a query we run for Jordan) showing the last failures per store, so the next Palm Springs call is answered in one look instead of a night of guessing.

## Notes

- Nothing in the pairing, PIN or punch logic changes behavior — these are additive records only.
- Existing `punch_clock_attempts` stays exactly as it is.
- If the failure turns out to be network/Wi-Fi at the store, these records will show it as `timeout`/`network` with healthy device rows — which is itself the answer.
