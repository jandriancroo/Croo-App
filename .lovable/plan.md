# Labor % after manual hour entry (Palm Springs 2026-09-05)

## Short answer

Palm Springs 9/5 now reads **$1,093.78 labor on $5,478.20 sales = 20%**, and the labor row was refreshed today at 09:22 PT. The 11% Jordan saw was a labor number computed *before* the manually entered hours finished landing — the figure has since corrected itself. Labor % is not a stored number; it is labor dollars divided by that day's sales, recomputed from punches.

## How it works today

1. **Where the number comes from.** Labor dollars/hours per store per day live in `labor_cache` (one row per store + date + source, `punch_clock` or `qubeyond`). Sales come from `sales_cache`. Every screen divides one by the other:
   - Dashboard: `src/components/dashboard/SalesSummary.tsx:188-297`
   - Multi-store dashboard: `src/hooks/useOrgDashboardData.ts:204-396`
   - Payroll periods: `src/hooks/usePayrollData.tsx:226-363`
   - Watch tiles: `src/utils/watchMetrics.ts:89-117`
   - Today only (never cached): `src/utils/liveLabor.ts` computes today's hours straight from punches.
2. **Who fills `labor_cache`.** The `labor-service` function walks punches, applies overtime and unpaid-break rules, and upserts the day (`supabase/functions/labor-service/index.ts:399-528`), with a `refresh-stale` action at `:564-606`.
3. **Nightly recalculation.** Two scheduled jobs: `queue-nightly-maintenance` at 4:00 AM PT and `nightly-labor-maintenance` at 4:01 AM PT, which calls `labor-service?action=refresh-stale` and rebuilds every day flagged stale. A queue processor runs each minute.
4. **Prior-day punch edits.** Editing, adding or deleting a punch fires two database triggers on `time_punches`: one flags that store/day stale, the other immediately posts a rebuild request for exactly that store and date. So a manual entry should refresh within seconds — with the nightly sweep as the safety net. Note the punch date is resolved using the store's own timezone, so a late-night punch buckets to the right business day.
5. **Manager-entered vs tablet punches.** The recompute path does not care who created the punch — same triggers, same math. The real gaps are:
   - **Timing:** if a manager enters hours one punch at a time, each save triggers a rebuild, and the dashboard keeps showing whatever was last written until the rebuild lands and the screen is refetched. Mid-entry a day can legitimately read 11%.
   - **Incomplete pairs:** a clock-in typed without a matching clock-out contributes little or nothing until the pair exists.
   - **Screen caching:** the browser holds the earlier value until the query refetches, so labor can look wrong after it is already fixed in the backend.
   - Today's date is never read from cache, so this only affects past days.

## Smallest fix worth shipping (if he wants one)

Nothing is broken in the recompute chain, so the useful change is about *seeing* the corrected number, not producing it:

- After a manager saves punch edits, refetch the labor and sales queries for that store/day so the labor pill updates on the spot rather than at the next page load.
- Show a small "recalculating" state on the labor pill while a day is flagged stale, so a mid-entry number is never mistaken for the final one.
- Optional backstop: a light hourly sweep of stale days, so a rebuild request that fails to reach the service corrects within the hour instead of waiting for 4 AM.

## Notes

- No change to `labor_cache` structure, the `source` column, or the sales/labor separation rules.
- No change to how hours or overtime are computed.
