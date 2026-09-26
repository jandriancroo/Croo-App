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
     - Virginia St, and any date before the cutoff, go to `_legacy_labor_totals_for_date` (exactly today's result).
     - Every other store and date goes to `labor_day_totals`, returning (hours, cost).
4. **One store labor lookup:**
   - `labor_source_for(_location_id uuid) -> text`: Virginia St is excluded first. Then it returns 'qubeyond' if `pull_labor = 'true'`, otherwise 'punch_clock'.
   - `_store_labor(_location_id uuid, _date date, _live boolean) -> TABLE(source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - qubeyond stores read their qubeyond cache row.
     - punch_clock stores, business today: calculated live.
     - punch_clock stores, dates on or after the cutoff: use the cached row; if it is missing or stale, run `labor_day_totals(_live => false)` without saving anything.
     - punch_clock stores, **dates before the cutoff:** return the cached row if it exists, is not stale, and is not a 0-hour placeholder. Otherwise return `_legacy_labor_totals_for_date` (read-only, never saved). Either way it's old math, never the new rule.
     - net_sales comes from sales_cache. `labor_pct = cost/net*100`, unrounded, and null when net = 0.
   - `get_store_labor(_location_ids uuid[], _start date, _end date) -> TABLE(location_id uuid, date date, source text, hours numeric, cost numeric, net_sales numeric, labor_pct numeric, is_live boolean, as_of timestamptz)`
     - Checks `_labor_totals_authorized` for each location.
     - A punch device gets only its own location, and only for business today.
     - Capped at 93 days per call. Store totals only, and Virginia St is skipped.
5. **Repointed public functions** (CREATE OR REPLACE, same signatures and shapes):
   - **Each function keeps its current access check character for character** in its CREATE OR REPLACE body:
     - `get_live_labor_totals(uuid,date)`: `_labor_totals_authorized(loc) OR (auth.uid() IS NOT NULL AND punch_device_location(auth.uid()) = loc)`. Then, for dates before the cutoff, it goes to `_legacy_get_live_labor_totals` (exactly today's result); for other dates it reads `_store_labor`.
     - `get_labor_totals_for_dates(uuid,date[])`: `_labor_totals_authorized(loc)` only. Then, for each date before the cutoff, it goes to `_legacy_get_labor_totals_for_dates`, so today's recalculation that fills 0-hour placeholders still works; other dates read `_store_labor`.
     - **get_cut_savings_total never uses the legacy path**, for any date, so an old date can't get around the shift check or the 0–480 clamp.
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
   REVOKE ALL ON FUNCTION public.labor_new_rule_start() FROM PUBLIC, anon, authenticated;
   GRANT EXECUTE ON FUNCTION public.labor_new_rule_start() TO service_role;
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
- **Cutoff:** a single function `public.labor_new_rule_start() RETURNS date` returns a constant set to the build day's date. It is STABLE, SECURITY DEFINER, `search_path = public, pg_temp`, service_role only.
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
- **Old numbers still returned:** for those same pre-build dates, `get_labor_totals_for_dates` returns exactly what it returns today (the legacy path), and `get_store_labor` returns old-math numbers (the cached row, or the legacy calculation).
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
  - `labor_new_rule_start()`: no anon and no authenticated.
- **Pre-build rows unchanged:** before the build, take a read-only count and checksum of punch_clock labor_cache rows with labor_date before the cutoff: md5 of location_id, labor_date, source, labor_hours, labor_cost, overtime_hours, double_time_hours and employee_breakdown, ordered. updated_at and is_stale are left out, because marking a row stale changes them. Take it again after the first nightly run. The two must be identical.
- **Old-date function calls unchanged:** for a pre-build date, get_live_labor_totals and get_labor_totals_for_dates return the same result before and after the build.
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

# 2B: every screen reads the one server labor number, plus Time Tracking fixes (plan only)

## Plain English
Right now some screens do their own labor math on the phone. After 2B, the server computes labor once and every screen shows that result. Time Tracking will count breaks by length, show an open shift's hours live today, flag and block pay-period close for a forgotten clock-out, and stop merging split shifts.

## Step 0: live 2A re-check (read-only, Sep 26 ~23:30 UTC)
- These functions exist: `labor_day_totals(uuid,date,boolean)`, `labor_day_user_totals(uuid,date,boolean)`, `get_store_labor(uuid[],date,date)`, `business_date(uuid,timestamptz)`, `business_day_window(uuid,date)`, `labor_new_rule_start()`, `get_live_labor_totals(uuid,date)`, `get_labor_totals_for_dates(uuid,date[])`, `get_cut_savings_total(uuid,jsonb)`, `has_role_or_higher(uuid,text)`, `has_location_access(uuid,uuid)`.
- `labor_day_user_totals` is SECURITY DEFINER, search_path public, pg_temp, and excludes Virginia St by id. Same-time sort order is break_end < clock_out < clock_in < break_start. Zero-length pairs are dropped.
- **Confirmed split-shift gap:** when a clock_in arrives while a shift is still open, the server ignores it (`IF v_shift_start IS NULL` is the only branch). So clock_in, clock_in, clock_out becomes one long shift from the first clock_in to the clock_out. A clock_in during an open break is ignored the same way, so the break keeps running until break_end or clock_out.
- Jaysen, Hemet, 9/25 (PT): clock-in 08:59, break 13:21–13:51, clock-out 15:06, then clock-in 18:01, break 19:29–19:59, clock-out 00:00. That is a proper split shift with a clock-out in between, so the server gives it two shifts. Each break is 30 minutes, so it's unpaid under N=30. Expected paid hours: 5.62 + 5.48 = **11.10h**. The old and new Time Tracking hours get computed at build from the live client code and recorded in E. 9/25 is before the cutoff, so the server reports it through the legacy path.

## A) One number on every screen
Line numbers are approximate and get confirmed at build. Role visibility: store totals (hours, $, %) for shift manager and above, as today. Per-person $ for manager and above only.

| Surface | File (approx lines) | Current source | New source |
|---|---|---|---|
| Dashboard widgets, WTD/MTD, the "LOCKED always punch" overwrite, weekly repair | components/dashboard/SalesSummary.tsx | labor_cache read + liveLabor.ts overwrite + fetchActualLaborForDates gap fill | get_store_labor(range) for closed days + get_live_labor_totals for today. Remove the overwrite and repair. WTD/MTD % = total $ / total net sales |
| Dock dashboard | components/dock/CompactDashboard.tsx | labor_cache + liveLabor.ts | get_store_labor / get_live_labor_totals |
| Prefetch | hooks/usePrefetchDashboard.tsx | labor_cache prefetch | delete the labor prefetch, share the query key with SalesSummary |
| Org dashboard (laborRank, labor_cache read, per-store live loop) | hooks/useOrgDashboardData.ts | labor_cache + a live RPC per store | one get_store_labor(all ids, range) call + live for today. laborRank uses its numbers |
| Reports | hooks/useReportData.ts | labor_cache | get_store_labor |
| Schedule actuals | components/schedule/LaborTotals.tsx, DayInsightsBar.tsx | labor_cache + liveLabor, getTodayPST | get_store_labor / get_live_labor_totals, using the store's business date |
| Checklist heatmap | components/history/ChecklistHeatmap.tsx | labor_cache | get_store_labor |
| Pay-period cards | usePayrollData.tsx, utils/payrollCalculations.ts, payrollDayBucketing.ts | client punch math | get_store_labor(period) + live today |
| Labor intelligence | functions/labor-intelligence | labor_cache (service) | labor_day_totals (internal) |
| Watch | functions/watch-device-service + _shared/punchLabor.ts | punchLabor.ts TS math | labor_day_totals / get_live_labor_totals logic. Delete punchLabor.ts |
| QU sales fn labor branch | functions/fetch-qubeyond-sales (calculateLaborFromPunches, ...ForDates, getCachedLaborData) | own TS math + cache | labor_day_totals via service. The response shape stays the same |
| Support email | functions/support-email-service | labor_cache | labor_day_totals |
| Hourly/day-part pulse | SQL send_hourly_sales_pulse / send_day_part_pulse | labor_cache / own math | labor_day_totals(loc, today, true) |
| Also found in the code | functions/ai-assistant, auto-punch-out, maintenance-service, aloha-sync, _shared/quLabor.ts, _shared/weekProjections.ts | labor_cache | ai-assistant/weekProjections: read via labor_day_totals for dates on or after the cutoff. auto-punch-out: timing only, no labor $, unchanged. maintenance/aloha/quLabor: writers (QU source / Virginia), unchanged |
| Kiosk | utils/liveLabor.ts, punchclock/ManagerDashboardOverlay.tsx, utils/kioskCutSavings.ts | RPCs already | **not touched** (see C) |

- **Edge functions that change:** watch-device-service, fetch-qubeyond-sales, support-email-service, labor-intelligence, ai-assistant (read path only). Pulse SQL functions are replaced in the migration.
- **Browser code stops reading labor_cache directly:** grants are left for a later cleanup pack so nothing breaks mid-rollout.
- **QU-labor stores (pull_labor true):** get_store_labor already returns the qubeyond row when it's present, which keeps today's rule.
- **Virginia St:** screens call the same RPCs, which route it to legacy. No client branch is needed.

## B) Time Tracking
**New server function:** `labor_shifts(_location_id uuid, _start date, _end date)`
- SECURITY DEFINER, search_path = public, pg_temp, STABLE. EXECUTE is revoked from PUBLIC and anon and granted to authenticated.
- Gate: `has_role_or_higher(auth.uid(),'manager') AND has_location_access(auth.uid(), _location_id)`, otherwise raise 42501. `has_role_or_higher` puts shift_manager below manager, so shift managers are denied.
- Returns one row per shift: user_id, business_date, clock_in, clock_out, paid_hours, paid_break_min, unpaid_break_min, wage, cost, and flags open_shift_live, missing_clock_out, unclosed_break, ignored_duplicates, and resolved_zero (with resolved_by and resolved_at).

**One source of truth:** move the pairing loop into an internal `_labor_pair_shifts(loc, window, live)` that emits shift rows. `labor_day_user_totals` then sums those rows, `labor_day_totals` sums the users, and `labor_shifts` returns the rows. So for dates on or after the cutoff, the Time Tracking store-day sum equals labor_day_totals **exactly**.

1. **Break rule:** a break at least N minutes long (unpaid_break_min_minutes) is unpaid; shorter breaks are paid. Note text is never used. The client calculateDayHours (~L545-644) and the note checks at L609/665/720/980/1209/1369, DayByDayView L155 and DesktopTimeTrackingTable L120 all switch to the server rows. The 30m/10m label becomes the actual minutes.
2. **Open shift today:** the server returns live-to-now hours. The dead showLive switch is removed.
3. **Past open shift:** 0h and flagged "Missing clock-out" in By Employee and By Day. Close Pay Period is blocked while any unresolved row exists. It can be fixed with a clock-out in EditShiftForm, or with "Resolve as 0h".
   - Recording "resolved" **needs a small schema change:** a new table `labor_shift_resolutions(id, location_id, user_id, clock_in_punch_id unique, resolved_by, resolved_at, note)`. It gets manager+ RLS and GRANTs to authenticated/service_role. No existing punch rows change.
4. **Open break then clock_out:** the break closes at clock-out. This is already the server behavior (the unclosed_break flag).
5. **Split shifts / forgotten clock-out:** a server change for dates on or after the cutoff only.
   - A clock_in while a shift is open closes the earlier shift as a missing clock-out (0h if the day is past, flagged) and starts a new shift.
   - A clock_in during a break closes the break at that time; the shift continues and is flagged `unclosed_break`.
   - Same-time sort order and zero-length drops are unchanged. Kiosk RPC signatures are unchanged.
   - Before and after numbers are run read-only at build for every person-day on or after 9/26 where a double clock_in exists. The count and $ difference per store get reported before the apply.
   - Approve and Approve All (L1207-1218, L1367-1377, ~L1425) check meal-break warnings on **every** shift, using the length rule.
   - Day bucketing uses the server's business_date per shift. This removes the clockInsByDay.set last-wins code in usePayrollData ~L886 and payrollDayBucketing L50; that helper gets deleted or kept only for pre-cutoff days.
6. **Hide-approved totals:** both views sum the same filtered server rows.
7. **Pay-period Labor $:** get_store_labor for past days + get_live_labor_totals for today.

**Pre-cutoff days in the current period (Jordan decision):**
- Option 1 (recommended): days before 9/26 keep the legacy client math shown today, labelled "old rule". The server hours and $ for those days stay the frozen cache.
- Option 2: apply the new rule to those days on the Time Tracking screen only. Payroll hours would then differ from the frozen dashboard numbers.
- The $ and hour difference for Hemet, Palm Desert and Georgetown is computed at build for each option and shown before Jordan chooses.

Out of scope: OT premium, payroll export math, kiosk punch code, Virginia St.

## C) Kiosk
No kiosk file changes. `src/utils/liveLabor.ts` and `components/punchclock/ManagerDashboardOverlay.tsx` are **not touched**. They already call get_live_labor_totals / get_cut_savings_total, whose signatures don't change. SalesSummary and the other screens call the RPCs directly rather than editing liveLabor.ts.

## D) Rollback
- **Frontend:** one revert commit of the 2B files (the table above plus the Time Tracking files).
- **Edge functions:** redeploy watch-device-service, fetch-qubeyond-sales, support-email-service, labor-intelligence and ai-assistant from 3e0570c.
- **SQL:** before apply, save pg_get_functiondef for labor_day_user_totals, labor_day_totals, send_hourly_sales_pulse and send_day_part_pulse. Rollback restores those definitions and drops labor_shifts, _labor_pair_shifts and labor_shift_resolutions.

## E) Acceptance
- Hemet and Palm Desert 9/26 (and 9/27 if it's there at build): every screen = get_store_labor = labor_day_totals = Time Tracking store-day sum, to the cent. Before and after numbers are shown.
- Jaysen, Hemet 9/25: punches listed above, old client hours vs new; 11.10h expected under the new rule.
- A synthetic double clock_in on or after the cutoff gets flagged and is not merged.
- A past open shift blocks Close Pay Period. Resolving it as 0h records who and when, and unblocks.
- Shift manager login: no per-person $ in Time Tracking, schedule or dashboards. labor_shifts returns 42501.
- Paired-tablet smoke test unchanged. Standing has_function_privilege check: anon has no EXECUTE on any labor function.

## Order and shipping
1. B server (migration: pairing refactor + split-shift rule + labor_shifts + resolutions table). Can ship alone.
2. Time Tracking frontend.
3. Screen repoints (A frontend).
4. Edge functions and the pulse SQL.
Each step ships and rolls back on its own.

**Open questions**
- Pre-cutoff rule for Time Tracking (Option 1 or 2).
- Does the new split-shift rule apply from 9/26, or from the 2B apply date?
- Should "Resolve as 0h" be manager+ or admin only?

---

## 2B review revisions (Ryan, 23:33 UTC). Where these conflict with A–E above, these win.
Facts re-checked (read-only):
- `_store_labor(uuid,date,boolean)`: only service_role can run it.
- `get_store_labor`: authenticated can run it. It is gated by `_labor_totals_authorized` or the paired device (today only). It caps at 92 days and 100 stores, and one bad store id raises 42501 for the whole call.
- **get_store_labor returns no rows for Virginia St** (it skips that id).
- labor_cache read access: has_location_access OR has_brand_access_via_location, plus the paired device.
- pay_periods columns: id, start_date, end_date, status, closed_at, closed_by, created_at. There is no location column.
- Virginia St: 0 punches in the last 30 days.

**R1. Server consumers use `_store_labor(loc, date, live)`, not labor_day_totals.**
- This covers labor-intelligence, watch-device-service, fetch-qubeyond-sales, support-email-service, both pulse SQL functions, ai-assistant and `_shared/weekProjections`.
- That way the QU switch (Rowlett), pre-cutoff routing and the frozen cache all apply.
- Virginia St: consumers keep their current legacy code for that id, because `_store_labor`/get_store_labor return nothing for it.
- The A table's "New source" column for these rows now reads `_store_labor`.

**R2. Cross-day forgotten clock-out.**
- Confirmed with 2A live: yesterday's open shift + today's clock_in (ignored) + today's clock_out pairs into one long shift dated yesterday, and today shows 0.
- New rule (dates on or after the cutoff): a clock_in while a shift is open ends the earlier shift as missing_clock_out with 0h, whether it's today or a past day, then starts a new shift. A clock_in during an open break closes the break at that clock_in and flags unclosed_break.
- The ±24h punch window covers case (b), because the pairing loop sees the prior day's clock_in and the next day's punches.
- Acceptance:
  - (a) Same-day double clock_in.
  - (b) 9/26 open, then a 9/27 clock_in/out: 9/26 = 0h flagged, 9/27 = its own shift.
  - (c) Clock_in during an open break.

**R3. Refactor parity.**
- labor_day_user_totals and labor_day_totals keep their exact signatures and return columns: CREATE OR REPLACE, SECURITY DEFINER, search_path = public, pg_temp, grants unchanged.
- Acceptance:
  - For every post-cutoff store-day at the punch stores, each user without a double clock_in gets identical output before and after (to 0.0001h and the cent).
  - The pre-cutoff punch_clock checksum (609207d36c6764d245343595add7c66b, n=3702) is unchanged.
  - Old-date get_live_labor_totals and get_labor_totals_for_dates outputs are unchanged.
  - get_cut_savings_total and the paired-device own-store OK / other-store 42501 test get re-run.

**R4. Cache recompute.** After the pairing change, run labor-service 'backfill' forceRefresh from the cutoff to yesterday, for the punch stores only (not Virginia St, and not Rowlett's QU rows). That makes the cache equal the function. The rollback repeats this after restoring the old definitions.

**R5. Store-total gate (Jordan confirm).**
- **Who loses labor visibility:** team members (below shift manager) could read store labor on every labor_cache screen: dashboard, dock, reports, heatmap, schedule actuals and the org dashboard. After 2B the labor tile is hidden for them. The RPC is not called, so they see no error.
- **Brand-level users:** brand_admin/fbc with brand access only add the brand-access path to the store-totals gate (`has_brand_access_via_location`), used by get_store_labor only. It is never added to labor_shifts or anything per-person.
- **Callers pass only accessible ids:** the org dashboard passes only the ids it already lists for that user.

**R6. Limits.**
- get_store_labor: 93 days / 100 stores. Reports (custom ranges) and the heatmap (year view) chunk by 90 days. The org dashboard chunks by 100 stores; month-to-date fits.
- labor_shifts: cap at 45 days (a pay period plus slack), otherwise 22023.
- Virginia St Time Tracking is unaffected: it has 0 recent punches and stays excluded.

**R7. Close Pay Period.**
- Blocked on unresolved missing clock-outs across **all** locations the org period covers. This is enforced server-side by a new `pay_period_open_issues(_period_id)`, manager+ with a has_location_access-scoped listing, plus a BEFORE UPDATE trigger on pay_periods that raises when status → closed with open issues. The UI shows the list.
- The flags and the block cover every day in the period, including pre-cutoff days. labor_shifts can pair any date for flags; the hours rule for pre-cutoff days is still Jordan's call.

**R8. labor_shift_resolutions.**
- RLS on; GRANT SELECT, INSERT to authenticated and ALL to service_role; no anon.
- SELECT and INSERT for manager+ with has_location_access. No client UPDATE or DELETE.
- clock_in_punch_id is a foreign key to time_punches, ON DELETE CASCADE.
- A resolution is ignored once a real clock_out exists for that shift.
- Who can resolve: manager+ (the same people who close periods).

**R9. Standing permission-check additions:**
- labor_shifts: authenticated only.
- _labor_pair_shifts: service_role only.
- pay_period_open_issues: authenticated only.
- labor_shift_resolutions: no anon privileges.
- Vendor-invoices: the two new policies exist and the old two are gone.

**R10. One call per range.** SalesSummary, the dock and the org dashboard make one get_store_labor call per range. Today comes back live with is_live, and labor % uses the server's net_sales. No mixing with get_live_labor_totals or client-side net sales.

**R11. Deferred, not touched in 2B:**
- Scheduled labor (get_scheduled_labor_totals)
- kioskCutSavings.ts cleanup
- usePersonalPayData / payrollCalculations: the employee's own pay view still uses note-based breaks.
- Note: pay-period cards read get_store_labor and no longer call payrollCalculations for labor $.

**R12. Rollback per step:**
1. **Server step:** restore the saved pg_get_functiondef for labor_day_user_totals and labor_day_totals. Drop labor_shifts, _labor_pair_shifts, pay_period_open_issues, the pay_periods trigger and labor_shift_resolutions. Then run the R4 cache recompute.
2. **Time Tracking frontend:** revert that commit.
3. **Screen repoints:** revert that commit. Drop the brand-path gate change (restore the saved get_store_labor definition).
4. **Edge functions:** redeploy watch-device-service, fetch-qubeyond-sales, support-email-service, labor-intelligence and ai-assistant from 3e0570c. Restore the saved pulse function definitions.
5. **Andy's policies:** drop the new two and rebuild the old two from the captured pg_policies.

**R13. Jaysen, Hemet 9/25, exact:** 5.6130h + 5.4768h = **11.0898h** (breaks 30:15 and 30:11, both unpaid). This replaces the rounded 11.10h in Step 0 and E.

## Final review round (Ryan, 23:37 UTC). Where these conflict with R1–R13, these win.

**R14. Checksum (replaces the 609207d3… value in R3).**
- Formula: `md5(string_agg(concat_ws('|', location_id, labor_date, source, labor_hours, labor_cost, overtime_hours, double_time_hours, employee_breakdown::text), E'\n' ORDER BY location_id, labor_date, source))`
- Rows: source = 'punch_clock' AND labor_date < '2026-09-26'.
- Baseline: n = 3702, md5 **be1bd3380da920b25abdc827c2ad526c**. Checked before and after each server step and after the R4 recompute.

**R15. Close trigger (replaces the R7 trigger wording).**
- Close Pay Period is an upsert (usePayrollData ~L1513, status 'closed'), so the first close is an INSERT.
- `trg_pay_period_close_guard`: BEFORE INSERT OR UPDATE ON pay_periods, fires only when NEW.status = 'closed'. The function is SECURITY DEFINER with search_path = public, pg_temp.
- Reopening (~L1543, status 'open') doesn't trigger it.
- Locations checked: every location with at least one time_punches row inside the period's business-day windows, excluding Virginia St.
- Blocks when any unresolved missing clock-out exists on any business date in the period. A real clock_out or a labor_shift_resolutions row counts as fixed.
- The error message and the UI list show location, person and business date. `pay_period_open_issues` returns the same list.
- Who can close today, unchanged: pay_periods policy "Admins and managers can manage pay periods" (ALL, has_role admin OR has_role manager).

**R16. Clock_in rules (replaces the R2 break wording).**
- Clock_in with a shift open and a break open: the break closes at that clock_in and the shift continues, flagged unclosed_break (wrong button on return from break).
- Clock_in with a shift open and no break open: the earlier shift ends as missing_clock_out with 0h (whether it's today or a past day), and a new shift starts.

**R17. Brand path (replaces R5 gate wording).**
- The get_store_labor store-totals gate becomes `has_role_or_higher(uid,'shift_manager') AND (has_location_access(uid,loc) OR has_brand_access_via_location(uid,loc))`. The paired-device branch is unchanged.
- Only get_store_labor changes. `_labor_totals_authorized` is not touched, because kiosk-reachable functions use it.
- Its pg_get_functiondef is saved before the change and restored in rollback.
- Tests: a brand-only user gets totals OK, and 42501 on labor_shifts and pay_period_open_issues.

**R18. Virginia St on client screens (corrects A).**
- get_store_labor skips Virginia St, so "no client branch needed" in A is wrong.
- Every client surface keeps its current code path for the Virginia St id, and the org dashboard gets Virginia St's numbers from its current path.
- Acceptance: Virginia St screens are identical before and after.

**R19. Kiosk note (adds to C).**
- The pairing change is server-only, with no kiosk file change. But it changes the tablet's live labor and cut-savings numbers on person-days with a double clock_in, which is intended and matches the dashboards.
- The paired-tablet test is re-run after the server step (own store OK, other store 42501, numbers = get_store_labor).

**R20. DST vector.**
- labor_shifts and pay_period_open_issues use business_day_window.
- Acceptance: a Hemet shift spanning 01:00–02:00 on 2026-11-01 lands on exactly one business date, with nothing dropped or double-counted.
- Still open from 2A: the fall-back day window counts 24h, not 25h.

---

# Separate section: Andy's security piggyback (vendor-invoices storage)
Not part of the labor work.

**Verified read-only**
- Current policies:
  - "Authenticated users can view invoices" — SELECT TO authenticated USING (bucket_id = 'vendor-invoices')
  - "Authenticated users can upload invoices" — INSERT TO authenticated WITH CHECK (bucket_id = 'vendor-invoices')
- `has_location_access(uuid, uuid)` exists.
- Clients that use this bucket: InvoiceUploadDialog, LiteInvoiceUploadDialog, LiteInvoicesList, parse-vendor-invoice(-lite). No kiosk file uses it.
- The upload paths, the no-upsert check and the LiteInvoicesList ~L462 own-path signed URL get a code read confirmation at build.
- First folder segments of the existing files (all UUIDs, so each store keeps access to its own):
  - 01a87b8b… (8 files)
  - d667741f… (10 files)
  - lite/5ce2f74e… (17 files)
  - lite/9a5c1e00-0000-4000-8000-000000000002 (1 file; this location exists)

**SQL:** Ryan's text, applied verbatim (the BEGIN/COMMIT is dropped because the runner wraps it in a transaction).

**Rollback:** rebuild the two policies from the capture above (which matches the fallback text).

**Tests:** V1–V5 as specified.

**Follow-up (not this ship):** parse-vendor-invoice(-lite) accepts a storagePath + locationId from the client and signs it with service role, without a has_location_access check on the caller.
