# Why labor-service excludes today (and is forceRefresh-with-today safe?)

## The answer: B + C together

The exclusion at `supabase/functions/labor-service/index.ts:392`
(`getDateRange(...).filter(d => d !== todayStr)`) is by design, for two linked reasons:

**B) Today is computed live elsewhere — labor_cache is for closed days only.**
- `src/utils/liveLabor.ts` header states it outright: "labor_cache only holds CLOSED
  days (written by the nightly labor service), so anything that needs today's
  hours/cost ... has to compute it from time_punches."
- Every surface that shows today (Dashboard `SalesSummary.tsx`,
  `useOrgDashboardData.ts`, pay-period cards) already merges
  `fetchLiveLaborForToday()` over the cache. If the cache also wrote today, you'd
  get two sources of truth for the same day and they would disagree mid-shift.

**C) Open shifts make a cached "today" premature.**
- During the day, many employees are clocked in with no clock_out yet. The
  bucketing math (`payrollDayBucketing.ts` / `payrollCalculations.ts`) can only
  count completed pairs, so a cache row written at 2pm freezes a partial,
  wrong-looking number that downstream readers treat as authoritative.
- Related: the auto-punch-out system (PUNCH_CLOCK_SYSTEM.md) deliberately closes
  forgotten shifts at 3 AM PST via nightly maintenance — so "yesterday" isn't even
  final until after that run. Today is excluded; the day becomes eligible the
  moment it flips to yesterday.

It is NOT primarily about load (A) — the trigger-based backfill is per-date and
cheap. The exclusion is a correctness boundary: cache = closed days, live = today.

## Is it safe to include today when forceRefresh=true from the punch trigger?

**No — not recommended, and not needed.**
- The punch trigger (`mark_labor_cache_stale_and_backfill`) fires on edits to
  *prior-day* punches (manager fixes like Dave's). Those dates are never today in
  practice, so the filter costs nothing for the actual use case.
- If a punch IS edited for today, the live surfaces already recompute from
  `time_punches` in real time (`liveLabor.ts`), so nothing is stale on screen.
- Writing today into labor_cache would create a frozen partial-day row that
  readers treat as final, and it would fight the live calculation — the exact
  split the architecture was built to avoid.

The 4 AM refresh-stale fallback stays exactly as-is and is unaffected.

## Sources
- `supabase/functions/labor-service/index.ts:332-405` (exclusion + backfill flow)
- `src/utils/liveLabor.ts:1-13` (closed-days-only contract)
- `PUNCH_CLOCK_SYSTEM.md` auto punch-out (3 AM close of open shifts)
- Memory: Labor Calculation Strategy — "Dual calc for actual vs scheduled ... historical cache rules"
- `SHARED_WORKSPACE/dashboard/README.md` 2026-09-07 entry: "labor-service still excludes today from backfill by design — unchanged."

## Action
None. Plan-only question — no code change proposed or recommended.
