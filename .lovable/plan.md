# Pack 2: One labor number (plan only; nothing built until Jordan approves)

## In plain English
The database will work out each labor number once, the same way everywhere, and every screen will show that one number. Breaks follow a length rule each store can set. Labor $ is straight wages. Virginia St is left completely alone, and payroll is not touched.

This ships in two parts, each approved separately:
- **2A (this approval):** the database and backend jobs only. No screen changes and no kiosk changes.
- **2B:** switching the screens over and scheduled labor. This is a separate approval, after the paired-tablet test passes.

---

# 2A: server side (self-contained)

## Step 0: facts checked against the live system and code (Sep 26)
- **Who uses `_location_business_date`:** only `get_cut_savings_total` (searched the database and the codebase). **Confirmed.**
- **Function security settings today:**
  - All 6 functions are SECURITY DEFINER with `search_path=public`: `get_live_labor_totals`, `get_labor_totals_for_dates`, `get_cut_savings_total`, `_labor_totals_for_date`, `_labor_totals_authorized`, `_location_business_date`.
  - The three public functions can be run by authenticated and service_role.
  - `_labor_totals_for_date`, `_labor_totals_authorized` and `_location_business_date` can be run by service_role only.
  - A direct permission check shows anon cannot run any of the 6. **Confirmed.**
- **Kiosk:** `src/utils/liveLabor.ts:27` passes `getDateInTimezone()`, which is the store's local calendar date, not its business date. It uses the signed-in or paired session. **Confirmed.**
- **Who reads `hourly_breakdown`:** ai-assistant at line 2169 reads it (aloha-sync writes it). **Confirmed.**
- **Who reads `employee_breakdown`:**
  - labor-intelligence:199.
  - maintenance-service:154. Its validate-labor-cache step marks punch_clock rows stale when the breakdown hours don't add up to the total.
  - ai-assistant:841, 1919 and 2037.
  - **Confirmed.**
- **Punch triggers:** `mark_labor_cache_stale` and `mark_labor_cache_stale_and_backfill` both use `(punch_time AT TIME ZONE tz)::date`, which is the calendar date. So a 00:30 punch queues a backfill for the next calendar day. **Confirmed.** labor-service will also recompute the previous business date (see below).
- **auto-punch-out:** inserts a clock_out with `is_auto_punched_out=true`, with an 18-hour sanity limit (MAX_SHIFT_HOURS=18). I'm relying on your finding that it fires at close+4h or scheduled end+1h and has happened once in 60 days; I didn't re-count.
- **changelog_entries:**
  - The only reader is `src/pages/Changelog.tsx` (select, insert, delete), and that screen is super-admin only.
  - It has 3 policies: "Admins can manage changelog" (ALL), "Super admins can manage changelog" (ALL) and "Super admins can view changelog" (SELECT).
  - There is no customer-facing reader. **Confirmed.**
- **Punches with the same timestamp (60 days):** 5 groups: clock_out×2, clock_out×3, clock_out×4, clock_in+clock_out, and break_start+clock_out. **Confirmed.**
- **Labor jobs on a timer:**
  - job 22 "queue-nightly-maintenance" at 11:00 UTC.
  - job 24 "nightly-labor-maintenance" at 11:01 UTC.
  - job 239 "process-maintenance-queue" every minute.
  - **Confirmed.**
- **QU switch:** `location_integrations.credentials->>'pull_labor'` on the active qubeyond integration. It is 'true' only at Rowlett. **Confirmed by Ryan.**
- **Backfill job location:** `supabase/functions/maintenance-queue-processor/index.ts`, case "backfill_labor" (line 140).

## Virginia St exclusion (5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d)
- **New functions:** every new function returns nothing for this id.
- **Backend jobs:** labor-service and backfill_labor skip it.
- **Repointed functions** (`get_live_labor_totals`, `get_labor_totals_for_dates`, `get_cut_savings_total`, `_labor_totals_for_date`): for this id, they call `_legacy_*` copies of today's logic. Those copies still call the unchanged `_location_business_date`.
- **No aloha source:** there is no aloha source, no aloha passthrough, and nothing keyed on Aloha. aloha-sync and its rows are untouched.

## Migration outline
1. **Setting:** `ALTER TABLE public.labor_rules ADD COLUMN unpaid_break_min_minutes integer NOT NULL DEFAULT 30;`
   - The CA rows (Hemet, Palm Desert, Palm Springs, Anaheim, [TEST] Sandbox) are set to 30 as a separate data step.
   - Stores with no labor_rules row use `coalesce(..., 30)`.
   - Hayward is left as is.
2. **Business date** (new):
   - `business_date(_location_id uuid, _at timestamptz DEFAULT now()) -> date`
   - `business_day_window(_location_id uuid, _date date) -> TABLE(start_at timestamptz, end_at timestamptz)`
   - The window is built as `(date + cutoff)::timestamp AT TIME ZONE tz`.
   - Cutoff = (previous day's close hour + 3) % 24, defaulting to 5. The date rolls back one day only when the cutoff is between 1 and 11 and the local hour is before the cutoff.
   - **`_location_business_date` stays unchanged.** New code calls `business_date` directly.
3. **One labor calculation** (internal):
   - `labor_day_user_totals(_location_id uuid, _date date, _live boolean) -> TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric, cost numeric, wage_missing boolean, open_shift boolean, unclosed_break_count integer)`
   - `labor_day_totals(_location_id uuid, _date date, _live boolean) -> TABLE(hours numeric, cost numeric, wage_missing_count integer, open_shift_count integer, unclosed_break_count integer)`
   - `_labor_totals_for_date(uuid,date,boolean)` is changed with CREATE OR REPLACE:
     - Virginia St, and any date before the cutoff, go to `_legacy_labor_totals_for_date`.
     - Every other store and date goes to `labor_day_totals`, returning (hours, cost).
4. **One store labor lookup:**
   - `labor_source_for(_location_id uuid) -> text`: Virginia St is excluded first. Then it returns 'qubeyond' if `pull_labor = 'true'`, otherwise 'punch_clock'.
   - `_store_labor(_location_id uuid, _date date, _live boolean) -> TABLE(source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - qubeyond stores read their qubeyond cache row.
     - punch_clock stores, business today: calculated live.
     - punch_clock stores, dates on or after the cutoff: use the cached row; if it is missing or stale, run `labor_day_totals(_live => false)` without saving anything.
     - punch_clock stores, **dates before the cutoff:** return the cached row as is, even if it is stale. If no row exists, return what today's code returns for that day: `_legacy_labor_totals_for_date` (I checked the live source: today's function recalculates the day from punches, the old way, rather than returning zero). This makes get_store_labor, get_labor_totals_for_dates and _labor_totals_for_date agree for old dates.
     - net_sales comes from sales_cache. `labor_pct = cost/net*100`, unrounded, and null when net = 0.
   - `get_store_labor(_location_ids uuid[], _start date, _end date) -> TABLE(location_id uuid, date date, source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - Checks `_labor_totals_authorized` for each location.
     - A punch device gets only its own location, and only for business today.
     - Capped at 93 days per call. Store totals only, and Virginia St is skipped.
5. **Repointed public functions** (CREATE OR REPLACE, same signatures and shapes):
   - **Each function keeps its current access check character for character** in its CREATE OR REPLACE body:
     - `get_live_labor_totals(uuid,date)`: `_labor_totals_authorized(loc) OR (auth.uid() IS NOT NULL AND punch_device_location(auth.uid()) = loc)`, then reads `_store_labor`.
     - `get_labor_totals_for_dates(uuid,date[])`: `_labor_totals_authorized(loc)` only, then reads `_store_labor`.
     - `get_cut_savings_total(uuid,jsonb)`: the same OR check as get_live_labor_totals, run first, before any input check.
   - **Kiosk date:** if `_date = business_date(loc) + 1` and that is the store's local calendar date (after midnight, before the cutoff), the call is treated as a live business-today call.
   - **`get_cut_savings_total(uuid,jsonb)` lockdown** (after its unchanged access check above):
     - It prices only people who have a shift at that location on that business date. Anyone else is dropped silently.
     - Minutes are clamped to 0–480.
     - Error messages are generic, never specific to a person.
     - It uses the wages from `labor_day_user_totals`, returns exact results even for one person, and never returns a wage.
6. **Security:** every new or replaced function that reads wages is `SECURITY DEFINER SET search_path = public, pg_temp`. The grants are:
   ```sql
   REVOKE ALL ON FUNCTION public._store_labor(uuid,date,boolean), public.labor_source_for(uuid), public.labor_day_totals(uuid,date,boolean), public.labor_day_user_totals(uuid,date,boolean) FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public._store_labor(uuid,date,boolean), public.labor_source_for(uuid), public.labor_day_totals(uuid,date,boolean), public.labor_day_user_totals(uuid,date,boolean) TO service_role;
   REVOKE ALL ON FUNCTION public._legacy_labor_totals_for_date(uuid,date,boolean), public._legacy_get_live_labor_totals(uuid,date), public._legacy_get_labor_totals_for_dates(uuid,date[]), public._legacy_get_cut_savings_total(uuid,jsonb) FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public._legacy_labor_totals_for_date(uuid,date,boolean), public._legacy_get_live_labor_totals(uuid,date), public._legacy_get_labor_totals_for_dates(uuid,date[]), public._legacy_get_cut_savings_total(uuid,jsonb) TO service_role;
   REVOKE ALL ON FUNCTION public.get_store_labor(uuid[],date,date), public.business_date(uuid,timestamptz), public.business_day_window(uuid,date) FROM PUBLIC, anon;
   GRANT EXECUTE ON FUNCTION public.get_store_labor(uuid[],date,date), public.business_date(uuid,timestamptz), public.business_day_window(uuid,date) TO authenticated, service_role;
   ```
   - The three public functions and `_labor_totals_for_date` are CREATE OR REPLACE only, so their current permissions stay as they are.
   - No hidden column is re-granted.
7. **Piggyback:** `DROP POLICY "Admins can manage changelog" ON public.changelog_entries;` The two super-admin policies stay. Removing signed-out visitors' add/change/delete rights on profiles and labor_cache is out of scope.

## Break and pairing block (one commented section)
1. **Window:** read the person's punches from 24 hours before the business-day window to 24 hours after it. Keep only shifts where `business_date(clock_in) = _date`. This way a weekend closer's clock-out after the cutoff is no longer dropped.
2. **Same timestamps:**
   - First, cancel out same-kind duplicates at the same moment. Only one of each kind is kept, which handles the clock_out ×2, ×3 and ×4 groups.
   - **Zero-length pairs:** a clock_in and a clock_out at the same moment for the same person, when no shift is open just before it, is a zero-length shift. Both punches are dropped, so a live call never opens a phantom shift that runs to now(). The same goes for a break_start and break_end at the same moment with no break open.
   - When a shift is already open, the tie order below (clock_out before clock_in) treats the pair as a back-to-back boundary, and the shift stays continuous. The one live case (9/16 17:37 UTC: the previous punch was a clock_in, the next a break_start) is a boundary.
   - Then sort ties as break_end, then clock_out, then clock_in, then break_start, then by id.
3. **Shifts:**
   - clock_in opens a shift; if one is already open, the extra clock_in is ignored.
   - clock_out closes the open shift; with no open shift it is ignored (the first clock-out wins).
   - Split shifts count, and each shift has its own breaks.
4. **Breaks:**
   - break_start opens a break only inside an open shift, and only if no break is open.
   - break_end closes the open break. An unmatched or duplicate break_end is ignored, and so are breaks outside a shift.
   - An open break is closed at the clock_out and counted in `unclosed_break_count`.
5. **Orphans:** a past shift with no clock_out counts as zero and is counted in `open_shift_count`.
6. **Live (business today):**
   - An open shift runs until now().
   - An open break counts as worked until it reaches N, then its whole elapsed length is deducted. **Approved.**
7. **Break rule:** a break is unpaid when `(break_end - break_start) >= make_interval(mins => N)`, where N = `coalesce(labor_rules.unpaid_break_min_minutes, 30)`. Its full length is deducted.
   - The math is exact time intervals only: no date_trunc, no float or epoch math.
   - break_type and notes are ignored.
8. **Wage:**
   - Take wage_history where `effective_date <= _date`, ordered by effective_date DESC, then created_at DESC, then id DESC.
   - If there is none, use profiles.hourly_wage. If that is missing too, use $15 and mark `wage_missing`.
   - **Pending Jordan decision:** replace the $15 fallback with the store's minimum wage.
9. **Totals:**
   - cost = paid_hours × wage, straight time. overtime_hours and double_time_hours are written as 0.
   - Unrounded per-person values are added up, and only the final totals are rounded (4 decimals for hours, 2 for dollars).

## Backend changes
- **`supabase/functions/labor-service/index.ts`:**
  - Delete the TypeScript labor engine: calculateDayHours, calculateLaborFromPunches, the cutoff cap and the latest-wage map.
  - Upsert punch_clock rows from `labor_day_totals`, unique on (location_id, labor_date, source), with OT/DT = 0.
  - Keep writing `employee_breakdown` from `labor_day_user_totals` (user_id, hours, wage, cost), with the breakdown hours adding up to labor_hours so maintenance-service doesn't flag the rows. This stays backend-only.
  - Leave `hourly_breakdown` untouched in the upsert.
  - Recompute the previous business date too (startDate −1 day), because the triggers send calendar dates.
  - Skip business today, Virginia St, and **any labor_date before `labor_new_rule_start()`**. This applies to 'backfill' (including the −1 day recompute) and to 'refresh-stale'.
  - The 'backfill' and 'refresh-stale' actions and their payloads stay identical.
- **`supabase/functions/maintenance-queue-processor/index.ts`,** backfill_labor: a **7-day** lookback with forceRefresh. It skips Virginia St and clamps its start date to the cutoff.
- **`LOCKED_FEATURES.md`:** "Live Labor: One Punch Path Everywhere" is replaced by "One Store Labor Number".

## No historical backfill (Jordan, Sep 26 3:25 PM PT)
- **Cutoff:** a single function `public.labor_new_rule_start() RETURNS date` returns a constant set to the build day's date. It is IMMUTABLE, SECURITY DEFINER, `search_path = public, pg_temp`, service_role only.
- **The build day itself is included:** the new math applies when `labor_date >= labor_new_rule_start()`.
- Existing labor_cache rows keep their current (old-math) numbers.
- **What each automatic path does after build:**
  - **Job 22** (queue-nightly-maintenance → backfill_labor, 7-day lookback): rewrites only days on or after the cutoff. **Without the cutoff, yes: the first nightly run would rewrite up to 7 pre-build days.** With it, those days are skipped.
  - **Job 24** (nightly-labor-maintenance → refresh-stale): today this picks up stale punch_clock rows of any age. After build, it refreshes only stale rows on or after the cutoff.
  - **Punch triggers:** they still mark a row stale and queue backfill_labor for any date, since triggers are untouched. labor-service skips any date before the cutoff, including its extra "startDate −1 day" recompute.
  - **maintenance-service validate-labor-cache:** it may still mark old rows stale (it isn't changed). Nothing rewrites them.
- **A stale row before the cutoff:** left exactly as it is: frozen, old math. It stays marked stale and is never recomputed.
  - **Jordan decision (not chosen):** if a punch correction on a pre-build day should still update its number, the smallest option is for labor-service to route dates before the cutoff to `_legacy_labor_totals_for_date` (today's old math) instead of skipping them.

## Acceptance checks for 2A
- **Cache matches the function (post-build days):** for the first 1–2 business days after build at the punch stores, the labor_cache row, `labor_day_totals` and `get_labor_totals_for_dates` agree to the cent and to 0.0001h.
- **Warning counts:** `wage_missing_count`, `open_shift_count` and `unclosed_break_count` are reported for each store-day.
- **New-rule targets, checked read-only by calling `labor_day_totals` directly (nothing saved):**
  - Hemet: 9/22 $807.11 / 37.486h; 9/23 $752.28 / 34.715h; 9/24 about 38.334h (I'll report the $); 9/25 $846.97 / 40.530h.
  - Palm Desert: 9/23 $561.35 / 26.877h, and 9/24 $609.55 / 28.539h.
- **Old numbers still returned:** for those same pre-build dates, `get_labor_totals_for_dates` and `get_store_labor` still return the existing cached (old) numbers unchanged.
- **Split shifts:** both shifts and both shifts' breaks count. Same-timestamp and orphan cases behave as described above.
- **Per-store setting:** changing one store's N changes only that store.
- **Rowlett 9/22–9/25:** source qubeyond; $341.67 / $374.41 / $348.78 / $406.22; labor % 40.36 / 24.31 / 24.45 / 15.97.
- **Virginia St:** before and after are identical, including a call after midnight (before the cutoff).
- **Business-date test vectors:**
  - Georgetown 13:31 CT on 9/26 → 9/26.
  - Reno 11:31 PT → 9/26.
  - Hemet 9/27 00:30 → 9/26, and 01:00 → 9/27.
  - Palm Desert 9/27 01:30 → 9/26.
  - Rowlett 9/27 00:45 CT → 9/26.
  - Daylight-saving windows: Hemet 2026-11-01 (the repeated hour) and 2027-03-08.
- **Kiosk date:** the calendar date after midnight is treated as live business today.
- **Cut savings:** a person with no shift that day is priced at $0, minutes over 480 are clamped, and errors are generic.
- **Paired device access:** a paired-device session calls get_live_labor_totals and get_cut_savings_total for its own location without an error, and gets permission denied for another location.
- **Same minute at Hemet:** a shift manager, a manager and the paired tablet get identical totals, and shift managers get no per-person rows.
- **Georgetown after 12 PM CT:** uses today's punches.
- **Standing permissions check** (run after every migration), using `has_function_privilege('anon'|'authenticated', oid, 'execute')` on every function above:
  - No anon anywhere.
  - authenticated only on get_store_labor, business_date, business_day_window and the three public functions.
- **Pre-build rows unchanged:** before the build, take a read-only count and checksum of punch_clock labor_cache rows with labor_date before the cutoff (md5 of location_id, labor_date, labor_cost, labor_hours and updated_at, ordered). Take it again after the first nightly run. The two must be identical.
- `labor_new_rule_start()` can be run by service_role only.
- **Changelog:**
  - C1: an admin who isn't a super admin is denied reading, adding, changing and deleting (0 rows).
  - C2: the super admin can still list, add and delete.

## Kiosk impact
KIOSK ITEM: **none.** The kiosk's calendar-date call is handled on the server, and signatures and return shapes are unchanged.

## Order (after close, on Jordan's go; no labor job pauses needed)
1. Save the definitions of the 4 replaced functions and the changelog policies with pg_get_functiondef and pg_policies.
2. Take the read-only count and checksum of pre-cutoff punch_clock rows.
3. Apply the migration. It sets `labor_new_rule_start()` to the build day's date.
4. Seed the CA rows.
5. Run the permissions check and the business-date test vectors.
6. Deploy labor-service and maintenance-queue-processor.
7. Run the read-only acceptance checks.
8. After the first nightly run, re-check the checksum and the post-build cache match.
9. Do the paired-tablet test.

**Why no pauses:** the nightly jobs run at 11:00 and 11:01 UTC (4 AM PT). Applying after close is hours away from them. Pre-build rows are protected by the cutoff, not by timing.

## Rollback (kept open during apply)
1. Redeploy the previous labor-service and maintenance-queue-processor.
2. Restore `_labor_totals_for_date`, `get_live_labor_totals`, `get_labor_totals_for_dates` and `get_cut_savings_total` with CREATE OR REPLACE from the saved definitions.
3. Drop the new functions, the `_legacy_*` copies and `labor_new_rule_start()`, then `ALTER TABLE labor_rules DROP COLUMN unpaid_break_min_minutes`.
4. **Rows written by the new code (labor_date on or after the cutoff):** recompute from the cutoff to yesterday with the old labor-service 'backfill' and forceRefresh. This is punch stores only, not Virginia St or Rowlett's QU rows, and only a few days at most. Pre-build rows never changed, so they need nothing.
5. Recreate "Admins can manage changelog" from the saved pg_policies definition.

No job pause is needed for the rollback either. If a rollback had to happen near 11:00 UTC, the one option is to hold the nightly jobs for those minutes.

## Paired-tablet test (Hemet and Georgetown)
1. Clock in → 10-minute break → 30-minute break → clock out → clock in again → clock out.
2. Every punch should succeed, and the break notes should be unchanged.
3. The 10-minute break should stay paid and the 30-minute one should be deducted. Both shifts should count.
4. The overlay should match the web dashboard.
5. A one-person cut should show exact savings.

## Follow-ups (not in this pack)
- **Payroll:** stays out of scope. On Hemet 9/24, the 30:01 "10 minute paid break" is deducted by the new rule but not by payroll's note check, so payroll and labor will differ by about 0.5h that day.
- **$15 wage fallback:** a pending decision for Jordan (switch to the store's minimum wage).

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
- **Backend jobs to switch:** send_hourly_sales_pulse and send_day_part_pulse, labor-intelligence (re-run 9/19–9/25), watch-device-service (delete `_shared/punchLabor.ts`), fetch-qubeyond-sales (same response shape), support-email-service.
- **Virginia St:** every one of these keeps today's code path for its id.
- **Scheduled labor:**
  - New `get_scheduled_labor_totals(loc, start, end)`: SECURITY DEFINER, shift manager or above, effective-dated wages, straight time, shifts over 5 hours minus 0.5h.
  - Repoints LaborTotals, DayInsightsBar, DayBreakdownDialog and MobileDayPreviewSheet.
  - Per-person $ for manager and above only; below manager, hours only, never $15.
- **Cleanup:** delete `src/utils/kioskCutSavings.ts` and `kioskCutSavings.test.ts`.
