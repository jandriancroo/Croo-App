# Pack 2: One labor number (plan only; nothing built until Jordan approves)

## In plain English
Right now, labor hours, labor $, labor %, cut savings and scheduled labor are worked out in several different places, and those places don't always agree. After this pack, the database works each number out once, the same way everywhere, and every screen just shows it. Breaks are handled by a simple length rule each store can set. Labor $ is straight wages, with no overtime. Virginia St stays exactly as it is today.

**Recommended split** (it's too big for one safe run):
- **2A:** the server side (steps 1–3, business date, the one labor calculation, the one store labor lookup) plus a backfill. It changes no kiosk code, because the kiosk picks up the fix through the functions it already calls.
- **2B:** switching the screens over (step 3's screen list), scheduled labor (step 4), and cleanup (step 5).

## Checked against the live system today
- **Existing functions:** get_live_labor_totals(uuid, date), get_labor_totals_for_dates(uuid, date[]), get_cut_savings_total(uuid, jsonb), _labor_totals_for_date(uuid, date, bool), _labor_totals_authorized(uuid) and _location_business_date(uuid) all exist and are SECURITY DEFINER. Every signature below is kept.
- **labor_rules:** there is no break-length column yet. It does already have meal_break_duration, but I leave that alone and add the new column you asked for.
- **Existing QU switch:** location_integrations has no pull_labor column. The existing "Pull Qu Labor %" switch lives inside that table's saved credentials/settings data. I'll read it from wherever the current code reads it; I haven't confirmed the exact spot yet.
- **Other files:** `_shared/punchLabor.ts` and `src/utils/kioskCutSavings.ts` exist, and so does `kioskCutSavings.test.ts`, which gets deleted along with it.

## Migration outline (2A)
1. **New setting and seed:**
   - `ALTER TABLE labor_rules ADD COLUMN unpaid_break_min_minutes integer NOT NULL DEFAULT 30`.
   - The default already sets every row to 30, including the CA rows (Hemet, Palm Desert, Palm Springs, Anaheim, [TEST] Sandbox). I'll also run an explicit UPDATE for rows where state_code='CA', for the record.
   - Stores with no labor_rules row fall back to 30 in code.
   - Hayward: flagged for Jordan, not changed.
2. **Business date:**
   - `business_date(_location_id, _at timestamptz default now())` and `business_day_window(_location_id, _date)`, both using the store's timezone.
   - Cutoff = (the previous day's close hour + 3) % 24, defaulting to 5 AM. The date rolls back to yesterday only when the cutoff is between 1 and 11 AND the local hour is before the cutoff.
   - `_location_business_date` becomes a thin wrapper around business_date.
3. **One labor calculation** (internal, backend-only):
   - `labor_day_user_totals(loc, date, live)` gives one row per person: paid_hours, unpaid_break_hours, wage, cost and wage_missing.
   - `labor_day_totals(loc, date, live)` adds those up for the store.
   - `_labor_totals_for_date` becomes a wrapper that returns (hours, cost).
4. **One store labor lookup:**
   - `labor_source_for(loc)` returns 'qubeyond' when the QU switch is on, and 'punch_clock' otherwise.
   - `_store_labor(loc, date, live)` returns source, hours, cost, net_sales, labor_pct (unrounded, null when net sales are 0), is_live and as_of.
   - Public `get_store_labor(_location_ids uuid[], _start, _end)`: checks each location with _labor_totals_authorized. A punch device is allowed only for its own location and only for business today. It returns store totals only, never per-person rows.
5. **Repoint existing functions on the server** (same signatures and return shapes):
   - get_live_labor_totals and get_labor_totals_for_dates now read from _store_labor.
   - get_cut_savings_total uses the same per-person wages inside the database, returns exact results for any group size including 1, and never returns a wage.
6. **Permissions:**
   - Every new function is SECURITY DEFINER with `SET search_path=public`.
   - `REVOKE ALL FROM PUBLIC, anon` on all of them.
   - Internal functions are granted to service_role only; get_store_labor goes to authenticated too.
   - No hidden column (hourly_wage, employee_pin, pin_pending_plaintext, employee_breakdown) is re-granted.

## Break and pairing logic (one commented block)
1. **Sorting:** take the person's punches for the business-day window. Sort by time; when times tie, the order is clock_in, then break_start, then break_end, then clock_out, then id.
2. **Shifts:** walk through the punches in order.
   - clock_in opens a shift. If a shift is already open, the extra clock_in is ignored, so the first one wins.
   - clock_out closes the open shift. A clock_out with no open shift is ignored.
   - A shift belongs to the business date of its clock_in, and a person can have several shifts in one day (split shifts).
3. **Breaks:**
   - break_start opens a break only if no break is open; the first one wins.
   - break_end closes the open break. A second break_end is ignored.
   - A break with no end finishes at the shift's clock_out.
4. **Break rule:** if a break lasts N minutes or longer (N = the store's setting, default 30, inclusive), it is unpaid and its full length is deducted. Shorter breaks stay paid.
5. **Live (business today):**
   - An open shift runs until now.
   - An open break counts as worked until it reaches N minutes. After that, its full elapsed length is deducted.
6. **Pay:**
   - paid_hours = shift length minus unpaid breaks.
   - The wage comes from wage_history (the latest effective on or before the date), then profiles.hourly_wage, then $15 with wage_missing marked.
   - cost = paid_hours × wage, straight time. overtime_hours and double_time_hours are written as 0.
7. **Rounding:** only the final sum is rounded, to 4 decimals for hours and 2 for dollars.

## How Virginia St is excluded
labor_source_for returns 'aloha_passthrough' for any store whose active integration is Aloha. _store_labor then passes through its existing aloha labor_cache row unchanged, exactly as today. Its rows are never written or recalculated. aloha-sync is untouched, and there is no aloha calculation branch. Every screen shows what it shows today. (I'll look up which store that is by its Aloha integration, not by its name.)

## Files that change
**2A (server)**
- a new migration (above)
- `supabase/functions/labor-service/index.ts`: delete the TypeScript labor engine (calculateDayHours, calculateLaborFromPunches, the cutoff cap and the latest-wage map), and upsert punch_clock rows from labor_day_totals, skipping business today. The 'backfill' and 'refresh-stale' actions and their payloads stay identical.
- `supabase/functions/maintenance-service/index.ts` (the maintenance queue processor, backfill_labor): two-day lookback with forceRefresh.
- `LOCKED_FEATURES.md`: replace "Live Labor: One Punch Path Everywhere" with "One Store Labor Number".
- Backfill: Hemet, Palm Desert, Palm Springs and Georgetown from 2026-07-28 to yesterday.

**2B (screens and scheduled labor)**
- Screens switched to get_store_labor:
  - SalesSummary.tsx: all labor_cache reads plus today's "always punch" overwrite become one get_store_labor call. WTD/MTD % = total cost / total net sales.
  - CompactDashboard.tsx.
  - usePrefetchDashboard.tsx: delete the labor prefetch.
  - useOrgDashboardData.ts: drop laborRank and the per-store live loop.
  - useReportData.ts.
  - LaborTotals.tsx and DayInsightsBar.tsx (actuals, plus getTodayPST replaced with the store business date).
  - ChecklistHeatmap.tsx.
- Scheduled labor (step 4): new `get_scheduled_labor_totals(loc, start, end)`.
  - SECURITY DEFINER, shift manager or above.
  - Real effective-dated wages, straight time, shifts over 5 hours minus 0.5 hour.
  - Repoints LaborTotals, DayInsightsBar, DayBreakdownDialog and MobileDayPreviewSheet. This removes the $15 mask and the OT/DT markup.
  - Per-person $ for manager and above only; below manager, hours only, including unsaved draft shifts. The schedule-stable prefetch reads wages only for manager and above.
- Backend: send_hourly_sales_pulse and send_day_part_pulse (the labor lookup only); labor-intelligence (re-run 9/19–9/25); watch-device-service (delete `_shared/punchLabor.ts`); fetch-qubeyond-sales (delete its punch labor math and fill the same response fields from _store_labor); support-email-service.
- Delete: `src/utils/kioskCutSavings.ts` and `kioskCutSavings.test.ts`.
- Not touched: payroll (usePayrollData, payrollCalculations, usePersonalPayData). Payroll stays its own path. Say if you want it included.

## Kiosk impact
KIOSK ITEM: **none**. PunchClock.tsx, ManagerDashboardOverlay.tsx, liveLabor.ts, getBusinessDateInTimezone, the punch triggers, pairing and punch-device-service stay unchanged. The kiosk gets the fix through get_live_labor_totals and get_cut_savings_total, whose signatures and return shapes stay the same. If 2A testing shows that liveLabor.ts does its own math on top of those results, I'll stop and raise it as a separate KIOSK ITEM.

## Order
1. **2A**, after close:
   - Apply the migration.
   - Deploy labor-service and maintenance-service.
   - Run the backfill.
   - Check acceptance on the server (cache = labor_day_totals = get_labor_totals_for_dates; the Hemet and Palm Desert figures; the new Hemet 9/24 dollar amount reported).
2. **Paired-tablet test.**
3. **2B**: switch the screens over, add scheduled labor, redeploy the backend functions, re-run labor-intelligence, do cleanup, then Jordan publishes.

## Rollback
- **2A:** the rollback SQL, kept open, restores the previous definitions of _labor_totals_for_date, get_live_labor_totals, get_labor_totals_for_dates, get_cut_savings_total and _location_business_date (captured with pg_get_functiondef before applying). It drops the new functions and the new column. Redeploy the previous labor-service.
- **labor_cache:** snapshot the punch_clock rows being backfilled into a backup table first, so they can be restored exactly.
- **2B:** revert the screen changes to the 2A version. The server functions stay compatible.

## Paired-tablet test (Hemet and Georgetown)
1. Clock in → 10-minute break → 30-minute break → clock out → clock in again (split shift) → clock out.
2. Every punch should succeed and the break notes should be unchanged.
3. The 10-minute break should stay paid and the 30-minute one should be deducted. Both shifts should count.
4. The manager overlay should show the same numbers as the web dashboard.
5. A one-person cut should show exact savings.
6. A shift manager should see store totals only, with no per-person rows and no wages.
7. At Georgetown after 12 PM CT, live labor should use today's punches.

## Open questions for Jordan
- Is the live rule for open breaks OK? (An open break counts as worked until it hits N minutes, then its full length is deducted.)
- Should payroll screens stay out of scope?
- Hayward is labelled Federal/US but uses the CA timezone. Leave it as is?
