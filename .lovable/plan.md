# Labor: live open-shift hours + instant refresh at 50–300 stores

## Q&A first: why today was excluded

`supabase/functions/labor-service/index.ts:392` —
`getDateRange(...).filter(d => d !== todayStr)`

Reasons B **and** C, confirmed in code:
- **B)** `src/utils/liveLabor.ts:8-12` states the contract: "labor_cache only holds
  CLOSED days ... anything that needs today's hours/cost has to compute it from
  time_punches." Dashboard/pay-period surfaces already merge live today over cache.
- **C)** Open shifts make a cached today premature — and worse, the current math
  understates them (see finding below). Auto-punch-out only closes forgotten shifts
  at 3 AM (`PUNCH_CLOCK_SYSTEM.md`), so a day isn't final until after that.

Not (A): the trigger path is per-date and cheap; load was not the reason.

## Confirmed accuracy bug (both client and edge)

Open shift (clock_in, no clock_out) is ended at the **last punch in the window**, not now:
- edge `labor-service/index.ts:134-148` — `endTime = clockOut ?? lastPunchInWindow`
- client `src/utils/payrollCalculations.ts:129-144` — identical logic
- `calculateDayHours(dayPunches, showLive = true)` at `payrollCalculations.ts:62`:
  `showLive` is **declared and never used** in the body (grep: only the signature).
  So "live" hours have never been live — someone clocked in at 4pm with no other
  punches contributes 0, and someone who took a break at 6pm freezes at 6pm.

That is exactly the under-reporting behind low labor % during an active shift.

## Smallest ship (3 parts, then nightly unchanged)

### 1. Open-shift hours = now − clock_in − unpaid breaks
Make `showLive` real, one change mirrored in two files.

`src/utils/payrollCalculations.ts:141-144`:
```
const endTime = clockOut
  ? new Date(clockOut.punch_time)
  : (showLive && isOpenShift ? new Date() : (lastPunchInWindow ? new Date(lastPunchInWindow.punch_time) : null));
```
where `isOpenShift` = no clockOut for this window AND this is the last shift window.
Guard: cap the elapsed value (skip/clamp if > 16h) to match the auto-punch sanity
rule so a forgotten punch cannot balloon a day.

Unpaid-break subtraction already runs against `clockOutTime` (`:150-156`); with
`endTime = now` an in-progress 30-min break gets counted as unpaid up to now,
which is what operators expect.

Edge mirror: `supabase/functions/labor-service/index.ts:134-148`, same shape,
enabled only when the date being computed is today in the location timezone.

### 2. Include today on the punch-triggered path only
In `handleBackfill`, replace the blanket filter at `:392` with:
```
const includeToday = forceRefresh === true;
const allDates = getDateRange(startDateStr, endDateStr)
  .filter(d => includeToday || d !== todayStr);
```
Rationale: the 90-day catch-up and nightly runs keep excluding today (no change in
behavior or cost); only the trigger's `forceRefresh` write refreshes today. Today's
row is written with `is_stale = true` so nightly still finalizes it after auto-punch-out.

### 3. Debounce / coalesce so 300 stores don't stampede
Keep the DB write synchronous, make the HTTP call debounced. In
`mark_labor_cache_stale_and_backfill()`:
- Always mark `labor_cache` stale for the affected dates (cheap, in-transaction) —
  unchanged.
- Replace the immediate unconditional `pg_net` post with **single-flight per
  location+date**: only post if no post has been made for that key in the last
  20 seconds (small `labor_backfill_debounce` table keyed
  `(location_id, labor_date)` with `last_posted_at`, upsert + condition). A
  clock-in burst at open collapses into one call per store per 20s.
- Worst case at 300 stores: 3 calls/min/store ceiling instead of one per punch.

Alternative if you'd rather add no table: rely on stale-marking only and have a
1-minute cron sweep `labor_cache where is_stale` — cheaper still, but up to 60s
behind. The 20s debounce is the closer fit to "freshest numbers."

### 4. Nightly fallback: unchanged
The 4 AM refresh-stale run and the 3 AM auto-punch-out stay exactly as-is; today's
row remains stale until that run finalizes it.

## Not in this ship
No UI changes, no edge redeploys beyond `labor-service`, no change to
`liveLabor.ts`'s role (it keeps serving today on the dashboard and will now agree
with the cache because both use the same end-time rule).
