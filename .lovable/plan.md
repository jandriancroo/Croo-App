# Pack 2: One labor number (plan only; nothing built until Jordan approves)

## In plain English
The database will work out each labor number once, the same way everywhere, and every screen will show that one number. Breaks follow a length rule each store can set, and labor $ is straight wages. Virginia St is left completely alone.

It ships in two parts, each approved separately:
- **2A (this approval):** the database and backend jobs only. No screen changes and no kiosk changes.
- **2B (separate approval, after the paired-tablet test passes):** switching the screens over and scheduled labor.

---

# 2A: server side (self-contained)

## Checked against the live system
- **Existing functions:** these exist today and are SECURITY DEFINER. Each keeps its exact signature and return shape:
  - `get_live_labor_totals(_location_id uuid, _date date) -> TABLE(hours numeric, cost numeric)`
  - `get_labor_totals_for_dates(_location_id uuid, _dates date[]) -> TABLE(date date, hours numeric, cost numeric)`
  - `get_cut_savings_total(_location_id uuid, _cuts jsonb) -> TABLE(total_minutes integer, est_savings numeric)`
  - `_labor_totals_for_date(_location_id uuid, _date date, _show_live boolean) -> TABLE(hours numeric, cost numeric)`
  - `_labor_totals_authorized(_location_id uuid) -> boolean` (kept as is)
  - `_location_business_date(_location_id uuid) -> date`
- **labor_rules:** has no break-length column today, so this pack adds one.
- **QU switch:** `location_integrations.credentials->>'pull_labor'` on the active qubeyond integration. It is 'true' only at Rowlett today. **Confirmed by Ryan.**
- **Backfill job:** it lives in `supabase/functions/maintenance-queue-processor/index.ts`, case "backfill_labor" (line 140).

## Virginia St exclusion (location id 5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d)
- Every new function starts with a guard that returns nothing for this id, so it never returns or recomputes Virginia St.
- labor-service and the backfill skip this id.
- The repointed `get_live_labor_totals`, `get_labor_totals_for_dates` and `_labor_totals_for_date` hand this id to their current (pre-2A) logic, kept inside the migration as `_legacy_*` copies. Its output stays exactly as it is today.
- `get_cut_savings_total` gets the same treatment.
- There is no aloha source, no aloha passthrough, and nothing keyed on Aloha integrations. aloha-sync and its labor_cache rows are untouched.
- In 2B, every screen and job keeps today's code path for this id.

## Migration outline
1. **Setting and seed**
   - `ALTER TABLE public.labor_rules ADD COLUMN unpaid_break_min_minutes integer NOT NULL DEFAULT 30;`
   - `UPDATE public.labor_rules SET unpaid_break_min_minutes = 30 WHERE state_code = 'CA';` This covers Hemet, Palm Desert, Palm Springs, Anaheim and [TEST] Sandbox. It runs as a data step through the data tool, not inside the migration.
   - Stores with no labor_rules row (Reno - Diamond Pkwy, [TEST] Lite QA) use `coalesce(..., 30)`.
   - Hayward is left as is.
2. **Business date**
   - `public.business_date(_location_id uuid, _at timestamptz DEFAULT now()) -> date`
   - `public.business_day_window(_location_id uuid, _date date) -> TABLE(start_at timestamptz, end_at timestamptz)`
   - Both use the store's timezone.
   - The cutoff is (previous day's close hour + 3) % 24, defaulting to 5.
   - The date rolls back one day only when the cutoff is between 1 and 11 AND the local hour is before the cutoff.
   - `_location_business_date(_location_id)` becomes `SELECT business_date(_location_id, now())`.
   - Test vectors, checked with SELECTs after apply:
     - Georgetown 9/26 13:31 CT -> 9/26
     - Reno 11:31 PT -> 9/26
     - Hemet 9/27 00:30 -> 9/26, and 01:00 -> 9/27
     - Palm Desert 9/27 01:30 -> 9/26
     - Rowlett 9/27 00:45 CT -> 9/26
3. **One labor calculation** (internal)
   - `public.labor_day_user_totals(_location_id uuid, _date date, _live boolean) -> TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric, cost numeric, wage_missing boolean)`
   - `public.labor_day_totals(_location_id uuid, _date date, _live boolean) -> TABLE(hours numeric, cost numeric, wage_missing_count integer)`
   - `_labor_totals_for_date` becomes a wrapper that returns `(hours, cost)` from labor_day_totals, except for Virginia St.
4. **One store labor lookup**
   - `public.labor_source_for(_location_id uuid) -> text`: Virginia St is excluded first. Then it returns 'qubeyond' if the active qubeyond integration has `credentials->>'pull_labor' = 'true'`, otherwise 'punch_clock'.
   - `public._store_labor(_location_id uuid, _date date, _live boolean) -> TABLE(source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - 'qubeyond' stores read their qubeyond labor_cache row.
     - 'punch_clock' stores use labor_day_totals: live when the date is business today, otherwise the cached punch_clock row.
     - net_sales comes from sales_cache (read only).
     - `labor_pct = cost / net * 100` unrounded, and null when net sales are 0.
   - `public.get_store_labor(_location_ids uuid[], _start date, _end date) -> TABLE(location_id uuid, date date, source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - Checks `_labor_totals_authorized` for each location.
     - A punch device gets only its own location, and only for business today.
     - Returns store totals only, with Virginia St skipped.
5. **Repoint existing functions** (same signatures and shapes, logic inside the database)
   - `get_live_labor_totals` and `get_labor_totals_for_dates` read from _store_labor (Virginia St goes to its legacy copy).
   - `get_cut_savings_total` uses the per-person wages from labor_day_user_totals. It returns exact results for any group size, including 1, and never returns a wage.
6. **Grants**
   - Every new function is `SECURITY DEFINER SET search_path = public`, with `REVOKE ALL ... FROM PUBLIC, anon`.
   - `business_date`, `business_day_window` and `get_store_labor`: EXECUTE for authenticated and service_role.
   - `labor_day_user_totals`, `labor_day_totals`, `labor_source_for`, `_store_labor` and the `_legacy_*` copies: service_role only, also revoked from authenticated.
   - The repointed functions keep their current grants.
   - No hidden column is re-granted.

## Break and pairing block (one commented section)
1. **Punches:** for each person, take their punches in the business-day window, ordered by time. When times tie, the order is clock_in, then break_start, then break_end, then clock_out, then id.
2. **Shifts:**
   - clock_in opens a shift. If a shift is already open, the extra clock_in is ignored.
   - clock_out closes the open shift. A clock_out with no open shift is ignored, so the first one wins.
   - A person can have several shifts per day (split shifts). A shift belongs to the business date of its clock_in.
3. **Breaks within a shift:**
   - break_start opens a break only if none is open; the first one wins.
   - break_end closes the open break. A duplicate break_end is ignored.
   - A break with no end finishes at the clock_out.
4. **Break rule:** a break is unpaid when it lasts at least N minutes, where N = `coalesce(labor_rules.unpaid_break_min_minutes, 30)`. Its full length is deducted. Shorter breaks stay paid. `break_type` and notes are ignored.
5. **Live (business today):**
   - An open shift runs until now().
   - An open break counts as worked until it reaches N, then its whole elapsed length is deducted. **Approved.**
6. **Pay:**
   - paid_hours = shift time minus unpaid breaks.
   - The wage comes from wage_history (the latest effective on or before the date), then profiles.hourly_wage, then 15 with `wage_missing` marked.
   - cost = paid_hours × wage, straight time.
   - overtime_hours and double_time_hours are written as 0.
7. **Rounding:** only the final totals are rounded, to 4 decimals for hours and 2 for dollars.

## Backend changes
- `supabase/functions/labor-service/index.ts`:
  - Delete calculateDayHours, calculateLaborFromPunches, the cutoff cap and the latest-wage map.
  - Upsert labor_cache rows from `labor_day_totals` with source='punch_clock', unique on (location_id, labor_date, source), and overtime/double-time set to 0.
  - Skip business today and Virginia St.
  - The 'backfill' and 'refresh-stale' actions and their payloads stay identical.
- `supabase/functions/maintenance-queue-processor/index.ts`, case "backfill_labor": two-day lookback with forceRefresh, and skip Virginia St.
- `LOCKED_FEATURES.md`: replace "Live Labor: One Punch Path Everywhere" with "One Store Labor Number" (the QU switch is honored, there is no labor math in the app, and the app never reads labor_cache).

## Backfill
1. **Snapshot first.** Create `labor_cache_backup_pack2` from the punch_clock rows being rewritten:
   - Stores: Hemet, Palm Desert, Palm Springs and Georgetown.
   - Dates: 2026-07-28 to yesterday.
   - Access: service_role only, with no client grants.
2. **Recompute** those rows through labor-service 'backfill'. The QU rows (Rowlett) and Virginia St are untouched.

## Acceptance checks for 2A
- **Cache matches the function:** at the punch stores for 9/19–9/25, the labor_cache punch_clock row, labor_day_totals and get_labor_totals_for_dates must agree to the cent and to 0.0001h.
- **Hemet:**
  - 9/24: about 38.334h (the 30:01 break is now deducted). I'll report the new dollar amount.
  - 9/22: $807.11 / 37.486h.
  - 9/23: $752.28 / 34.715h.
  - 9/25: $846.97 / 40.530h.
- **Palm Desert:** 9/23 $561.35 / 26.877h, and 9/24 $609.55 / 28.539h.
- **Split shifts:** a person with two shifts in one day gets both shifts and both shifts' breaks counted.
- **Per-store setting:** changing one store's N and recomputing changes only that store.
- **Rowlett 9/22–9/25:** get_store_labor returns source 'qubeyond':
  - Labor $: $341.67 / $374.41 / $348.78 / $406.22.
  - Labor %: 40.36 / 24.31 / 24.45 / 15.97.
- **Virginia St:** every existing function returns exactly what it returned before (compared before and after apply).
- **Same minute at Hemet:** a shift manager, a manager and the paired tablet get identical totals. Shift managers and the kiosk get no per-person rows and no wages.
- **Georgetown after 12 PM CT:** live labor and cut savings use today's punches.

## Kiosk impact
KIOSK ITEM: **none.** No kiosk file changes. The kiosk gets the fix through get_live_labor_totals and get_cut_savings_total, which keep their signatures and return shapes.

## Order (after close, on Jordan's go)
1. Save the current function definitions with pg_get_functiondef, so the rollback is exact.
2. Apply the migration.
3. Seed the setting (the CA update).
4. Run the business-date test vectors.
5. Deploy labor-service and maintenance-queue-processor.
6. Take the labor_cache snapshot.
7. Run the backfill.
8. Run the acceptance checks.
9. Do the paired-tablet test.

## Rollback (kept open during apply)
- Restore the saved definitions of `_labor_totals_for_date`, `get_live_labor_totals`, `get_labor_totals_for_dates`, `get_cut_savings_total` and `_location_business_date`.
- Drop the new functions and the `_legacy_*` copies.
- `ALTER TABLE labor_rules DROP COLUMN unpaid_break_min_minutes`.
- Restore the punch_clock labor_cache rows from `labor_cache_backup_pack2`.
- Redeploy the previous labor-service and maintenance-queue-processor.

## Paired-tablet test (Hemet and Georgetown)
1. Clock in → 10-minute break → 30-minute break → clock out → clock in again → clock out.
2. Every punch should succeed and the break notes should be unchanged.
3. The 10-minute break should stay paid and the 30-minute one should be deducted. Both shifts should count.
4. The manager overlay should match the web dashboard.
5. A one-person cut should show exact savings.

## Follow-up (not in this pack)
- **Payroll:** stays out of scope. The Hemet 9/24 30:01 "10 minute paid break" is deducted by the new rule but not by payroll's note check, so payroll and labor will differ by about 0.5h that day.

---

# 2B: screens and scheduled labor (separate approval, after the paired-tablet test)
- **Switch to get_store_labor:**
  - SalesSummary.tsx (WTD/MTD % = total cost / total net sales)
  - CompactDashboard.tsx
  - usePrefetchDashboard (delete the labor prefetch)
  - useOrgDashboardData (drop laborRank and the per-store live loop)
  - useReportData
  - LaborTotals and DayInsightsBar actuals (replace getTodayPST with the store business date)
  - ChecklistHeatmap
- **Backend jobs to switch:** send_hourly_sales_pulse and send_day_part_pulse (the labor lookup only), labor-intelligence (re-run 9/19–9/25), watch-device-service (delete `_shared/punchLabor.ts`), fetch-qubeyond-sales (same response shape), support-email-service.
- **Virginia St:** every one of these keeps today's code path for its id.
- **Scheduled labor:**
  - New `get_scheduled_labor_totals(loc, start, end)`: SECURITY DEFINER, shift manager or above, effective-dated wages, straight time, shifts over 5 hours minus 0.5h.
  - Repoints LaborTotals, DayInsightsBar, DayBreakdownDialog and MobileDayPreviewSheet.
  - Per-person $ for manager and above only; below manager, hours only, never $15.
- **Cleanup:** delete `src/utils/kioskCutSavings.ts` and `kioskCutSavings.test.ts`.
