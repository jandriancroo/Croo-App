# Next bundle (Stages 0–7): plan only, nothing gets applied until Jordan says "GO bundle"

Checked against the live code and database on Sun 9/27 at 06:00 UTC, and updated with Ryan's answers and fixes A–E (06:06 UTC). The build runs Monday 9/28 after close. Whatever auto clock-out state is live Monday (B-2 or not) is the baseline and is left untouched.

**Needed in the GO message:** Jordan writes "unlock please (Last Year cube value and label only)". Scope is the Last Year value (business date − 364) and its "SDLY" label only. No change to rotation, faces, layout or rendering.

## Safety rules and gates (every stage)
- If any hard check fails: stop, roll back THAT stage only, report, and do not continue.
- **Checksum** before Stage 1 and after every stage must be n=3702, md5 be1bd3380da920b25abdc827c2ad526c:
  `select count(*), md5(string_agg(concat_ws('|', location_id, labor_date, source, labor_hours, labor_cost, overtime_hours, double_time_hours, employee_breakdown::text), E'\n' order by location_id, labor_date, source)) from labor_cache where source='punch_clock' and labor_date < '2026-09-26';`
- **Kiosk parity:** get_labor_totals_for_dates, get_live_labor_totals and get_cut_savings_total keep the same signature, return shape and grants. Stage 0 records these and each stage compares against them.
- **Timing:** start after 10:30 PM PT; publish the frontend after 11 PM PT; nothing runs 3:45–4:15 AM PT.
- **New SQL functions:** SECURITY DEFINER, `SET search_path = public, pg_temp`, REVOKE ALL FROM PUBLIC, anon (and from authenticated unless a screen calls it). Grant only what's needed.
- Every CREATE OR REPLACE is rebuilt from the LIVE definition, which Stage 0 captures. All old line numbers get re-found in live code.
- **Do not touch:** the time_punches triggers (trg_resolve_shift_id, mark_labor_cache_stale_and_backfill, trigger_mark_labor_cache_stale), src/pages/PunchClock.tsx, src/components/punchclock/, src/utils/liveLabor.ts, src/utils/kioskCutSavings.ts, punch-device-service, the auto clock-out job (run_auto_clock_out, auto_clock_out_settings/log, cron 'auto-clock-out', job 240), and ManagerDashboardOverlay.tsx.
- Also: no new cron job, no DROP of an existing table, and every stage has a rollback.

## Live facts the plan relies on (verified 9/27)
- anon on profiles and labor_cache is `awdDxtm`. After Stage 1 the expected entry is `anon=m/postgres`, because MAINTAIN is intentionally left.
- There is no `seed-week-projections` function. The pre-open run goes into `sales-week-projections`, which is called by the crons at 11:20 and 11:25 UTC.
- `pace_calculated_at` already exists. `getYOYDate` today returns calendar year − 1.
- Job 26 is `5 11 * * *` / `SELECT public.queue_nightly_emails();`, and that function's md5 is 5b332e32…
- `idx_email_queue_dedup` is unique on dedup_key WHERE NOT NULL. labor_rules already has the OT and DT multiplier and threshold columns. `labor_ot_premium`, `resolve_goal` and `get_sales_comparisons` do not exist.
- **Labor call chain (live):**
```text
_labor_pair_shifts -> labor_day_user_totals -> labor_day_totals -> _labor_totals_for_date / _store_labor
_store_labor -> get_store_labor, get_live_labor_totals, get_labor_totals_for_dates
_labor_pair_shifts -> labor_shifts
labor_day_user_totals -> get_cut_savings_total   (!)
```

## Stage 0: capture (read-only plus 2 backup tables)
- The published frontend version and commit (the rollback target; HEAD today is e9a71e5c3) and the checksum.
- md5 plus definition of every function replaced below, stored in `pkgc_backup_functions` (RLS on, no anon or authenticated grants).
- `pkgc_backup_sales_cache` (location_id, sale_date, net_sales, hourly_data, yoy_sale_date, yoy_net_sales, yoy_hourly_data, pace_adjusted_projection) for the last 400 days (RLS on, no grants).
- relacl and column-ACL md5 for profiles and labor_cache, and the cron.job list.
- get_store_labor for Hemet, Palm Desert, Palm Springs, Georgetown and Virginia St for 9/20–9/27.
- get_labor_totals_for_dates for those stores, 9/20–9/25.
- get_cut_savings_total for a fixed sample. It denies callers with no user (42501 as postgres), so it is called inside a read-only, rolled-back transaction with `request.jwt.claims` set to a Hemet manager's id. Fallback: record labor_day_user_totals (user_id, wage, paid_hours) for the same sample. Stage 4 uses the same method.
- The EXECUTE grants and the has_function_privilege matrix (anon, authenticated, service_role) for every function Stage 4 rebuilds.
- Signatures and grants of the 3 kiosk functions.

## Stage 1: Andy's security fix (its own migration, verbatim)
`REVOKE INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.profiles, public.labor_cache FROM anon;`
- **A1:** has_table_privilege('anon', t, p) is false for both tables × INSERT, UPDATE, DELETE, TRUNCATE.
- **A2:** authenticated UPDATE on profiles is still true, and the authenticated relacl entry plus column-ACL md5 equal Stage 0 (profiles 86dc2ece…, labor_cache 25b349ad…).
- The anon entry is `anon=m/postgres`, and the checksum holds.

Rollback: `GRANT INSERT, UPDATE, DELETE, TRUNCATE, TRIGGER, REFERENCES ON TABLE public.profiles, public.labor_cache TO anon;`

## Stage 2: Aloha business date (supabase/functions/aloha-sync/index.ts only)
- sync_today, sync_all_today and the today-only pace block use `rpc('business_date')` instead of `todayInTz`.
- `syncOneDay` gets an explicit mode (live or yesterday) and stops inferring "yesterday" from the calendar. sync_yesterday and sync_all_yesterday keep their current target date and the yesterday report. Live always uses the ticker path.

Checks:
- sync_today for Virginia St returns today's business date.
- The 9/26 and 9/27 rows are unchanged except fetched_at.
- The next 2-minute runs succeed.
- Tonight between 12:00 and 3:00 AM PT, Virginia's live updates land on the prior business day.
- The checksum holds.

Rollback: redeploy aloha-sync from the Stage 0 commit.

## Stage 3: Who's Out nightly on job 26
**Files:** a migration (queue_nightly_emails), `whos-out-email/index.ts`, and `_shared/whos-out.ts` (one-day layout helper).

**Host function:** rebuilt from its live definition plus one guarded block as the last statement before END: `net.http_post` to whos-out-email with `{"action":"run_nightly"}`, 5 s timeout, and `EXCEPTION WHEN OTHERS THEN RAISE WARNING`. Its definer setting, search_path and EXECUTE grants (postgres and service_role) stay exactly as they are.

**New `run_nightly` action:**
- Accepts only the service role or the CRON_SECRET header. It reads only `action` and an optional `dry_run`.
- For each active store not starting with "[TEST]":
  - target date = greatest(business_date, local date) + 1 day, which is tomorrow for that store
  - load who's out with loadWhosOut(target, target); skip the store if nobody is out
  - recipients = resolveWhosOutRecipients; skip the store if there are none
  - queue one email with subject "Who's out tomorrow, <Dow M/D> – <store>", source `whos_out_digest`, dedup key `whos_out_day_v1_<loc>_<date>`; error 23505 counts as already queued
- Each store has its own try/catch and logs its result. The existing sample actions are unchanged.

**Expected:** the first real send is the first 4:05 AM PT run after Stage 3 ships, and it covers only the next day. There is no backlog.

Checks:
- The host diff is only the added block.
- In a rolled-back DO block with a bad URL, queue_nightly_emails() returns normally and queues its usual rows.
- run_nightly called as anon or authenticated returns 401/403.
- A service-role dry run lists tomorrow's stores and people and queues nothing.
- cron.job is unchanged, and the checksum holds.

Rollback: restore queue_nightly_emails() from pkgc_backup_functions and revert whos-out-email.

## Stage 4: overtime premium in actual labor dollars
**Files:** a migration and `supabase/functions/labor-service/index.ts`. labor-service keeps its HTTP contract identical, because the punch triggers call it.

**New setting:** `labor_ot_premium(id bool pk, enabled bool default true)`, one row, RLS on, no grants (definer functions only).

**Rule** (business date ≥ labor_new_rule_start() and enabled; per person, store and business day):
- paid hours above daily_overtime_threshold (when > 0) add (overtime_multiplier − 1) × wage
- paid hours above daily_double_time_threshold (when > 0) add (double_time_multiplier − 1) × wage
- the premium is allocated in time order to the shifts that hold those hours, so shift sums equal day sums
- weekly 40-hour OT is not included

**Conflict found: get_cut_savings_total reads labor_day_user_totals.** To keep kiosk cut savings at straight wage × minutes:
- labor_day_user_totals keeps its existing cost column straight
- it gains new trailing columns: `ot_hours`, `dt_hours`, `premium_cost`
- get_cut_savings_total is not touched

Stage 0 confirms which column cut savings reads. If it reads anything other than the straight cost or hours, stop and report before Stage 4.

**Functions rebuilt from live:**
- `labor_day_user_totals`: adds the trailing columns.
- `labor_day_totals`: cost = straight + premium, plus OT and DT hours.
- `labor_shifts`: per-shift premium columns added at the end.
- Picked up through `labor_day_totals` with no change to their shape: `_labor_totals_for_date`, `_store_labor`, get_store_labor, get_live_labor_totals and get_labor_totals_for_dates. The premium is inside cost, so these are not rebuilt.
- `_labor_pair_shifts` is not touched.

**Return-type changes:** CREATE OR REPLACE can't add OUT columns, so each function whose shape changes (labor_day_user_totals, labor_shifts, and labor_day_totals only if its shape changes) is rebuilt as DROP FUNCTION + CREATE in the same migration transaction. Right after:
- re-apply the exact EXECUTE grants recorded in Stage 0
- check that the has_function_privilege matrix (anon, authenticated, service_role) equals Stage 0 for every rebuilt function

**Cache:** labor-service writes overtime_hours, double_time_hours and cost on punch_clock rows with labor_date ≥ 2026-09-26 only; this bundle is the explicit protected-cache confirmation. For those rows, each person's employee_breakdown cost = cost + premium_cost, so the breakdown sums to labor_cost. Then it recomputes 9/26 through today with the service role.

Checks:
- The checksum holds.
- get_labor_totals_for_dates for any date before 9/26 equals the Stage 0 values exactly.
- For 9/26 to today, cost = straight + premium to the cent, and shift sums = day sums.
- A synthetic 9-hour CA shift in a rolled-back DO block adds 1h × 0.5 × wage. The same shift at a TX store adds 0.
- Stores with daily_overtime_threshold = 0 (TX, GA, IL, IN, AL, WI) are unchanged for 9/26 to today.
- Flipping the setting off in a rolled-back DO block returns the Stage 0 numbers.
- get_cut_savings_total equals the Stage 0 sample, captured the same way (Hemet manager claims in a rolled-back transaction, or the labor_day_user_totals fallback). The kiosk signatures and grants are unchanged.
- For 9/26 to today, per store-day: the sum of employee_breakdown costs = labor_cache.labor_cost = labor_day_totals.cost.
- The has_function_privilege matrix equals Stage 0 for every rebuilt function.

Rollback: set enabled=false and recompute 9/26 to today. If needed, DROP and re-CREATE the old definitions from pkgc_backup_functions, re-apply their Stage 0 grants and re-check the privilege matrix, then redeploy labor-service from the Stage 0 commit.

## Stage 5: Pack 3 server (sales, pace, last year)
**SQL:**
- `resolve_goal(_location_id, _date)`: override > living > initial > projected, each NULLIF 0; granted to authenticated and service_role. It is gated like get_sales_comparisons. Allowed callers: the service role; has_location_access(auth.uid(), loc), or brand access via that location; or a punch device at its own location. Anyone else gets 42501.
- `get_sales_comparisons(_location_id, _date)`: shift manager and up with access, or a punch device at its own store.
- ALTER sales_cache ADD pace_week_projection and pace_month_projection.
- Rebuild send_hourly_sales_pulse (drop the Pace line and emoji when pace_calculated_at is null or older than 15 minutes; goal from resolve_goal) and send_day_part_pulse (goal from resolve_goal).

**Edge functions:**
- `_shared/projections.ts`: computeAndSavePace (curve normalized so the projected hours sum to the goal; day, week and month pace).
- `sales-service`: sync-live calls it; sync-yesterday now writes tips; getYOYDate becomes −364.
- `clover-sync` calls it. `aloha-sync` calls it on top of Stage 2 and scales hourly sales so the hours add up to NetSales.
- `sales-week-projections` runs the pre-open pace.
- `fetch-qubeyond-sales`: reads stored pace and uses −364. Its today sales_cache and daily_tips upserts are removed. Its response keys and shape stay the same.
- `watch-device-service` (plus metricConfigs label).
- Goal order = resolve_goal in `ai-assistant`, `labor-intelligence`, `_shared/whos-out.ts` and `genius-usage-engine`.

Checks:
- During the next open hours, every active POS store has today's row with a projected value for each open hour.
- The projected hours add up to resolve_goal ± $1, pace_calculated_at is under 2 minutes old, and pace ≥ net.
- A diff of the fetch-qubeyond-sales response shows the same keys.
- A sample push has no "Ahead" without fresh pace.
- resolve_goal called by a user with no access to that store returns 42501.
- The checksum holds.

Rollback: redeploy every touched edge function from the Stage 0 commit, restore the two pulse functions, and drop resolve_goal and get_sales_comparisons. The new columns can stay.

## Stage 6: Pack 3 backfills (only if Stages 1–5 are clean; may wait a night)
- yoy: UPDATE sales_cache so yoy_sale_date = sale_date − 364, and yoy_net_sales / yoy_hourly_data come from that row (NULL if missing).
- QU: sales-service sync-dates, batched, for every store-day in the last 60 days where |net − hourly total| > $1.
- Aloha: re-sync the last 60 days.

Checks:
- The invariant query (net_sales = the sum of 24 hourly entries; Clover within $0.05) returns 0 rows for the last 60 days.
- Hemet 9/25 yoy_net_sales = its 2025-09-26 net.
- A list of every store-day whose net changed by more than $5, for Ryan to read.
- The checksum holds.

Rollback: restore those columns from pkgc_backup_sales_cache.

## Stage 7: one frontend publish
**Piece C:**
- **C1** new `src/hooks/useStoreLabor.ts`: get_store_labor, refreshed every 60 s only while the tab is visible and the range includes business today. On error it shows "—" with a retry, never 0.
- **C2** Dashboard, dock (CompactDashboard, data only), org dashboard (useOrgDashboardData), reports and heatmap move onto C1. Delete the client labor math, the labor_cache reads, the liveLabor overwrite and the weekly repair. Dashboard uses canSeeSales.
- **C3** Schedule shows actual (server) labor next to scheduled, and "wage missing" instead of ?? 15.
- **C4** Time Tracking becomes a review screen fed by labor_shifts: refetchInterval false, refetchOnWindowFocus false, the same labels (Open, Auto Out, No Break), and server business-date bucketing.
- **C5** an "old rule" label for 9/21–9/25.
- **C6** Resolve as 0h, Add clock-out pre-filled from estimated_end, the pay_period_open_issues list, and a non-blocking warning dialog for unreviewed auto clock-outs at post.
- **C7** pay-period cards read get_store_labor.
- **C8** team members see labor when canSeeSales is true; per-person dollars are manager and up only.
- **C9** delete `src/pages/TimeTrackingPreview.tsx` and its `/time-preview` route in `App.tsx`.
- **C10** a "Use register labor" switch on the QU, Aloha and Clover cards:
  - it merges only the pull_labor key and never rewrites credentials
  - tablet stores get a confirm prompt
  - it is blocked if that register has no labor rows in the last 7 days
  - only super admins and org admins can use it

**Pack 3 client:**
- SalesSummary: week and month pace and last year from stored values and get_sales_comparisons.
- CompactDashboard and useOrgDashboardData use stored pace.
- WeekTemplateBuilder uses −364.
- Last Year cube = the business date − 364, labeled "SDLY", in DataCube.tsx, DataCube3D.tsx, watchMetrics.ts, and the label text in DashboardWidget.tsx. Value and label only; needs the GO-time unlock line.
- Cache key `['dashboard-sales-enriched', locationId, businessDate]` in SalesSummary, Dashboard and CompactDashboard.

**Build check:** `git diff --stat <Stage 0 commit>..HEAD` must list none of the do-not-touch files, or the build stops.

## Final checks (after publish)
1. **Parity:** for Hemet, Palm Desert and Palm Springs on 9/26 and 9/27, every screen = get_store_labor = the Time Tracking store-day sum, Σ(shift cost + shift premium), to the cent.
2. **Live:** today's labor on the dashboard and Schedule moves within 60 s of an open shift without a reload. Time Tracking does not move until reopened.
3. **Jaysen, Hemet 9/25:** shows "old rule" hours, and the 18:01 shift shows Auto Out.
4. **Roles:**
   - a team member with view_sales on sees totals
   - with it off, there is no tile and no RPC call
   - a shift manager sees no per-person dollars
   - a brand-only user sees totals
5. A forced RPC error shows "—", not 0.
6. **C10:** Virginia St's Aloha card shows ON. Flipping a QU store's switch keeps its username, password and store id. Rowlett, Hemet, Palm Desert and Palm Springs are unchanged after publish.
7. **Pace:** at the same minute, Hemet's store widget, dock, org card, watch, tablet (QU) and hourly push all show sales_cache.pace_adjusted_projection. Hemet's Last Year cube = the net at date − 364, labeled SDLY.
8. **A3:** a real kiosk punch after publish saves (shift_id set, no error), and get_live_labor_totals updates for that store. A labor-service refresh for 9/27 succeeds.
9. **A4:** a manager edits and saves a profile field (for example display order or phone) with no error.
10. **No drift:**
    - the checksum is unchanged
    - the auto clock-out state (settings mode, the auto-clock-out cron, and job 240 present or absent) equals the Monday baseline
    - no new cron job
    - job 26 is unchanged
    - queue_nightly_emails() differs from the backup only by the Who's Out block

## Rollback summary
- **Stage 1:** the GRANT line.
- **Stages 2, 3, 5:** redeploy those edge functions from the Stage 0 commit. Stage 3 also restores queue_nightly_emails(). Stage 5 also restores the pulse functions and drops the two new functions.
- **Stage 4:** flip the setting off and recompute 9/26 to today; restore the functions and redeploy labor-service if needed.
- **Stage 6:** restore from pkgc_backup_sales_cache.
- **Stage 7:** redeploy the Stage 0 published version, then revert the commit.

## Amendments (9/27, 8:35 PM PT): these override anything above
- **Stage 2:** every business_date call passes the store: `rpc('business_date', { _location_id: <store id> })`. There is no calendar-date fallback.
- **Stage 3:**
  - The queue_nightly_emails block uses `headers := public.cron_edge_headers()`.
  - run_nightly accepts that same rotating internal key, validated the same way the other cron-called functions validate it.
  - Added check: a dry run sent through the exact header path the host function uses returns 200 and lists tomorrow's stores (not 401).
- **Stage 4, OT/DT math** (per person, store and business day):
  - `ot_hours = greatest(0, least(paid, CASE WHEN dt_thr > 0 THEN dt_thr ELSE paid END) - ot_thr)`, only when ot_thr > 0
  - `dt_hours = greatest(0, paid - dt_thr)`, only when dt_thr > 0
  - `premium = ot_hours*(ot_mult-1)*wage + dt_hours*(dt_mult-1)*wage`
  - Hours past the DT threshold never also earn the OT premium.
  - Added check: a synthetic 13-hour CA shift in a rolled-back DO block adds exactly 4h × 0.5 × wage + 1h × 1.0 × wage.
- **Stage 4, grants:**
  - After each DROP + CREATE: `REVOKE ALL ON FUNCTION ... FROM PUBLIC, anon, authenticated`, then re-grant exactly the Stage 0 grant list, including sandbox_exec_lmodeiyrpwvgyqcvjkjr.
  - The check compares proacl::text to Stage 0 exactly, in addition to the has_function_privilege matrix.
  - labor_day_user_totals is created before labor_day_totals.
- **Stage 5 / Stage 0:**
  - Stage 0 confirms that sales-service sync-live (cron job 33, every minute) writes today's sales_cache and daily_tips rows for every QU store. If it does not, stop before removing those upserts from fetch-qubeyond-sales.
  - get_sales_comparisons: REVOKE from PUBLIC and anon; GRANT to authenticated and service_role.
- **Stage 6:** the last-year UPDATE is limited to `sale_date >= current_date - 400`, the same window as pkgc_backup_sales_cache. Older rows are not touched.
- **Stage 7, C2:** "delete the liveLabor overwrite" means removing the call sites in the dashboard files only. src/utils/liveLabor.ts itself is not edited or deleted.
