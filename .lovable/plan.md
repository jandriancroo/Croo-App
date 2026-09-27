# Package A — Labor server + migration (plus A-SEC)

Plan only. Nothing gets applied until Jordan says go, and it ships after close. Scope: database migrations, the data fixes, and four edge function redeploys (labor-service, maintenance-queue-processor, parse-vendor-invoice, parse-vendor-invoice-lite). No client files. No kiosk or punch files.

## Checked live (read-only, 9/27 02:30 UTC)

The Virginia St id `5ce2f74e-…0d8` appears in exactly the 10 functions in A1. These are the live signatures that will be replaced:

| Function | Args | Change |
|---|---|---|
| labor_source_for | (_location_id uuid) → text | CREATE OR REPLACE |
| _store_labor | (_location_id uuid, _date date, _live boolean) | CREATE OR REPLACE, same return |
| get_store_labor | (_location_ids uuid[], _start date, _end date) | CREATE OR REPLACE, same return |
| labor_day_totals | (_location_id, _date, _live) → hours, cost, wage_missing_count, open_shift_count, unclosed_break_count | CREATE OR REPLACE, same return |
| labor_day_user_totals | (_location_id, _date, _live) (already has wage_missing) | CREATE OR REPLACE, same return |
| _labor_pair_shifts | (_location_id, _date, _live, _new_rule) | DROP + CREATE, adds estimated_end timestamptz and estimated boolean |
| _labor_totals_for_date | (_location_id, _date, _show_live) → hours, cost | CREATE OR REPLACE |
| get_live_labor_totals | (_location_id, _date) → hours, cost | CREATE OR REPLACE, kiosk contract frozen |
| get_labor_totals_for_dates | (_location_id, _dates date[]) → date, hours, cost | CREATE OR REPLACE, kiosk contract frozen |
| get_cut_savings_total | (_location_id, _cuts jsonb) → total_minutes, est_savings | CREATE OR REPLACE, kiosk contract frozen |
| _pay_period_open_issues | (_start, _end) → 7 cols | DROP + CREATE as (_start, _end, _user uuid), adds kind text and blocking boolean |
| pay_period_open_issues | (_period_id uuid) → 7 cols | DROP + CREATE, same args, adds kind and blocking; EXECUTE authenticated only |
| pay_period_close_guard | trigger | CREATE OR REPLACE |
| labor_shifts | (_location_id, _start, _end) → 17 cols | DROP + CREATE, adds 6 cols (A5); EXECUTE authenticated only |

Pulses: send_hourly_sales_pulse() and send_day_part_pulse() are SQL functions in public. Both read labor_cache.labor_cost directly today, so there is no fifth edge deploy.

## Order (single maintenance window, after close)

```text
0  Snapshots: pg_get_functiondef of every function above + both pulses
   + labor_rules policies -> pkgA_backup_* tables (RLS on, no policies,
   REVOKE ALL from anon and authenticated; kept until Jordan signs off
   on A, dropped in a separate later step).
   Edge sources at f6bb3fe saved. Data-fix rows snapshotted. For the two
   location_integrations rows (Virginia aloha 004abcba-..., Rowlett
   qubeyond df005fd5-...) the snapshot stores ONLY id, integration_type,
   pull_labor key exists, its value, updated_at, md5(credentials::text),
   and md5((credentials - 'pull_labor')::text). Never the credentials JSON.
   Checksum baseline (n=3702, be1bd338...). V0 expected-change list and
   kiosk parity capture.
1  Migration A-schema: A9 columns, resolution column (A2), pending-timezone
   table, derive_store_region, labor_estimated_end.
2  Data fixes 1-6, one statement each (Virginia pull_labor first, so A1
   routes it as aloha from the start).
3  Migration A-logic: A1 + A3 + A4 + A5 + A8 functions, A2 issues/guard,
   A7 pulses.
4  Migration A-triggers: A6 cache triggers, A10 locations trigger + backfill
   (after the derived-vs-stored report is reviewed), A11 policy swap.
5  Deploy labor-service + maintenance-queue-processor (id constant ->
   labor_source_for check).
6  Kiosk parity re-check (V0). Any byte diff on a normal day -> rollback.
7  Recompute: labor-service backfill forceRefresh, punch_clock stores only,
   9/26 -> last closed business date. Checksum after.
8  Verification V1-V10.
9  A-SEC: apply Andy's diff to the two invoice functions, deploy, P1-P5.
```

## Migration SQL outline

**A-schema**
- `ALTER TABLE labor_rules ADD max_open_shift_hours numeric NOT NULL DEFAULT 16, duplicate_tap_minutes int NOT NULL DEFAULT 5, auto_clock_out_after_close_min int NOT NULL DEFAULT 180`. auto_punch_out_time stays in place and is no longer read.
- `ALTER TABLE labor_shift_resolutions ADD resolution text NOT NULL DEFAULT 'zero' CHECK (resolution IN ('zero','auto_reviewed'))`. RLS and grants stay as they are.
- `CREATE TABLE location_timezone_pending(id, location_id, current_tz, proposed_tz, derived_state, created_at, resolved_by, resolved_at, status)`. GRANT SELECT, UPDATE to authenticated; GRANT ALL to service_role; enable RLS; SELECT/UPDATE policies use `is_super_admin(auth.uid())`. No anon access.
- `derive_store_region(address text) RETURNS TABLE(state_code text, timezone text)`: normalize the address (newlines, 'CA.92802'), match the 2-letter code or full state name, map state to timezone, apply ZIP-prefix overrides for split states, and use America/Phoenix for AZ. Returns null when parsing fails.
- `labor_estimated_end(_clock_in_punch_id uuid) RETURNS timestamptz`: least(next punch at the store, covering scheduled end + 1h, store close + auto_clock_out_after_close_min, clock_in + max_open_shift_hours). The result is then clamped: never before the last punch in the shift, never after now(). The covering shift is the nearest-start scheduled_shifts row joined through schedules.location_id, with is_time_off false. Store close comes from location_hours for that weekday in the store timezone; a close before open means next day.
- Every new function is SECURITY DEFINER with `search_path = public, pg_temp`. REVOKE from public, anon and authenticated; GRANT to service_role.

**A-logic**
- labor_source_for: returns the integration_type of the active POS integration where `credentials->>'pull_labor' = 'true'`. If more than one matches, the oldest created_at wins and it raises a WARNING. Otherwise it returns 'punch_clock'.
- _store_labor: any non-punch source reads `labor_cache WHERE source = labor_source_for(loc)`.
- The other 8 functions: the id literal becomes `labor_source_for(loc) <> 'punch_clock'` wherever a store has to be skipped. Pure sums get no check.
- _labor_pair_shifts:
  - Double-tap merge (A4): hours change only when _new_rule is true; open-issue flags apply the merge on all dates.
  - Both missing-clock-out branches use labor_estimated_end and keep missing_clock_out = true until a real clock_out or a 'zero' resolution exists.
  - Today's open shift keeps accruing to least(now(), estimate cap).
  - This applies only to dates >= labor_new_rule_start().
- Missing wage (A8): cost stays null and wage_missing = true; totals add known costs only. This applies to labor_day_user_totals, labor_shifts and get_cut_savings_total. No `_legacy_*` function is touched.
- _pay_period_open_issues(_start, _end, _user):
  - Filtered by `has_location_access(_user, loc)`.
  - Returns missing_clock_out rows (blocking) plus auto_clock_out_unreviewed rows (non-blocking): the paired clock_out has is_auto_punched_out = true and no 'auto_reviewed' resolution exists.
  - Only 'zero' resolutions clear missing-clock-out rows.
- pay_period_close_guard: passes `coalesce(auth.uid(), NEW.closed_by)` and raises only on blocking rows. The error text is built from that filtered set, so it only names the closer's stores and people.
  - pay_periods has no location or org column, so a period is shared by every org. When both auth.uid() and NEW.closed_by are null (a service-role or cron close), the guard uses the unscoped list across all stores (today's behavior) and still raises only on blocking rows. This is a null `_user` branch in _pay_period_open_issues, so a close with no user is never left unguarded.
- labor_shifts: same manager+ and has_location_access gate, same 45-day cap. Adds clock_out_punch_id, auto_clock_out, auto_reviewed, meal_break_missing, estimated_end and estimated.
- Pulses (A7): send_hourly_sales_pulse() and send_day_part_pulse() get CREATE OR REPLACE. Their direct labor_cache.labor_cost read becomes `_store_labor(loc, business_date(loc), true)`. The D3 per-org settings read is kept verbatim.
- Grants are re-applied after every DROP + CREATE: EXECUTE authenticated only, revoked from public and anon. _labor_pair_shifts and _pay_period_open_issues stay internal, as in step 1.

**A-triggers**
- `trg_lsr_cache_stale`: AFTER INSERT OR DELETE on labor_shift_resolutions.
- `trg_labor_rules_cache_stale`: AFTER UPDATE on labor_rules, WHEN any of the 4 fields is DISTINCT.
- Both set is_stale on punch_clock labor_cache rows with labor_date >= labor_new_rule_start() and queue the backfill through the same path the time_punches trigger uses.
- `trg_locations_region`: AFTER INSERT OR UPDATE OF address.
  - Writes labor_rules.state_code (only if a row exists) and location_settings.timezone.
  - A timezone change at a store with a paired device goes to the pending table and is not applied.
  - If parsing fails, nothing changes and the store is flagged.
  - CA preset: fills only blank meal fields with 5 h / 30 min.
- Backfill: state_code only where blank or 'US', and only after the derived-vs-stored report. The expected only mismatch is Hayward, which data fix 4 handles.
- Trigger functions: SECURITY DEFINER, search_path set, EXECUTE revoked from public, anon and authenticated.
- A11: drop "Admins can manage labor rules" and create a scoped ALL policy (USING and WITH CHECK): `is_super_admin(uid) OR is_org_admin(uid, org) OR (has_role(uid,'admin') AND is_org_member(uid, org))`, where the org comes from the location. The two read policies are not touched.

## Data fixes (one statement each, row snapshot first)
1. Virginia St aloha: `credentials = credentials || '{"pull_labor":true}'`.
2. Rowlett qubeyond: `credentials = credentials || '{"pull_labor":false}'`.
   After fixes 1 and 2: confirm md5((credentials - 'pull_labor')::text) equals the snapshot value for each row, so nothing else in the JSON moved.
3. Reno – Diamond Pkwy: insert a Nevada labor_rules row copied from Sparks (values as listed), plus the A9 defaults.
4. Hayward: state_code 'WI', rule_name 'Wisconsin'; timezone America/Chicago.
5. Palm Desert: meal_break_hours 5, meal_break_duration 30.
6. Hemet and Palm Springs: auto_clock_out_after_close_min 180, auto_punch_out_time NULL.

## Punch clock and kiosk
- No file changes under src/pages/PunchClock.tsx, src/components/punchclock/, src/utils/liveLabor.ts or src/utils/kioskCutSavings.ts.
- time_punches triggers are not modified, and nothing in A writes, edits or deletes a punch.
- get_live_labor_totals, get_labor_totals_for_dates and get_cut_savings_total keep identical signatures and grants.
- After apply, kiosk numbers change only on days with a forgotten clock-out, a double tap, or a person with no wage.

## Verification queries
- **V0 kiosk parity:** decided up front.
  - Before apply, pick 3 past dates per store (Georgetown, Hemet, Palm Desert, Palm Springs) and record them in the plan.
  - Also before apply, list every expected-change day on those dates and today: a forgotten clock-out, a double tap, or a person with no wage. The list comes from `_labor_pair_shifts` flags plus wage-missing people.
  - Before and after the logic migration, run the three kiosk functions for today and those 3 dates, then md5 of `to_jsonb(result)`.
  - Any diff on a date not on the expected-change list: stop and roll back.
- **Checksum:** run exactly this, before and after:
  `select count(*), md5(string_agg(concat_ws('|', location_id, labor_date, source, labor_hours, labor_cost, overtime_hours, double_time_hours, employee_breakdown::text), E'\n' order by location_id, labor_date, source)) from labor_cache where source='punch_clock' and labor_date < '2026-09-26';`
  It must equal n=3702, md5 be1bd3380da920b25abdc827c2ad526c. Run before, after each step, and after the recompute.
- **V1:** post-9/26 per-person diff of old vs new labor_day_user_totals, within 0.0001h and $0.01, excluding forgotten or double-tap person-days. Changed person-days are listed.
- **V2:** `select id, name, labor_source_for(id) from locations`. Virginia must be 'aloha' and every other store 'punch_clock'. Virginia get_store_labor must equal labor_cache aloha.
- **V3:** rolled-back transactions with `set_config('request.jwt.claims', …)`:
  - Palm Desert 9/15 and 9/24 are absent from open issues.
  - A Hemet manager's close is not blocked by another org's issue, and the error names no other org's store or person.
  - A close with only auto_clock_out_unreviewed rows succeeds.
  - A close with a missing_clock_out row is blocked.
  - No user (claims empty, closed_by null) with a blocking row anywhere: blocked, using the unscoped all-stores list. The same case with only non-blocking rows goes through.
- **V4:** synthetic tests at [TEST] Sandbox in BEGIN…ROLLBACK. Sandbox has 0 location_hours rows, so the same transaction first inserts temporary location_hours for it.
  - A forgotten shift estimates non-zero and blocks.
  - Close cap wins: a forgotten shift with no next punch and a late or absent scheduled end, where store close + auto_clock_out_after_close_min is the earliest term, so estimated_end equals exactly that.
  - A double tap merges.
  - A split shift with the second shift forgotten ends at its own scheduled end.
  - Overnight 22:00→02:30 gets one business date.
  - DST 11/1 00:30 PDT→01:30 PST = 2h on 10/31.
- **V5:** the next hourly pulse's Labor for Hemet, Palm Desert and Palm Springs equals get_store_labor.
- **V6:** checked with has_function_privilege and policy tests:
  - anon has no EXECUTE on any labor function.
  - labor_estimated_end, derive_store_region and the trigger functions are service_role only.
  - labor_shifts and pay_period_open_issues are authenticated only.
  - Org A admin cannot UPDATE org B labor_rules (0 rows).
  - anon SELECT on labor_rules still works.
  - The pending table is super_admin only.
- **V7:** derived vs stored state and timezone match for every active store. business_date is unchanged for Hemet, Palm Desert, Palm Springs and Georgetown.
- **V8:** paired Hemet tablet test (both devices), with Jordan on site.
- **V9:** a real punch lands after apply.
- **V10:** final checksum.

## A-SEC (separate item)
Apply Andy's diff verbatim to parse-vendor-invoice and parse-vendor-invoice-lite:
- canAccess via `has_location_access`.
- 403 `{"error":"Forbidden"}` when the caller has no access to locationId.
- storagePath must start with `${locationId}/` (Brand) or `lite/${locationId}/` (Lite) and contain no '..'.
- After loading by invoiceId: access check on invoice.location_id, and the stored path must be inside that store's folder.

Deploy both, then run P1–P5. Rollback: revert both index.ts files and redeploy.

## Rollback script
1. From the pkgA_backup_* tables, run the saved live definitions. Drop and re-create _pay_period_open_issues(_start, _end), pay_period_open_issues(_period_id) and _labor_pair_shifts, labor_shifts with their old signatures, then re-apply the old grants. Restore the old labor_rules policy.
2. Redeploy labor-service and maintenance-queue-processor from the f6bb3fe source.
3. Drop:
   - labor_estimated_end, derive_store_region
   - trg_locations_region and its function, location_timezone_pending
   - the 2 cache triggers and their functions
   - labor_shift_resolutions.resolution
   - the 3 new labor_rules columns
4. Restore the data-fix rows from the snapshot:
   - Virginia: `credentials = credentials - 'pull_labor'` (key-only)
   - Rowlett: `credentials = credentials || '{"pull_labor":true}'` (key-only)
   - After each restore: md5((credentials - 'pull_labor')::text) matches the snapshot
   - Delete Reno's labor_rules row
   - Hayward: 'US' / 'Federal Default' / America/Los_Angeles
   - Palm Desert: meal fields back to null
   - Hemet / Palm Springs: auto_punch_out_time 01:00 / 02:00
5. Re-run the recompute (9/26 onward), then the checksum.
6. pkgA_backup_* tables stay until Jordan signs off on A. Dropping them is a separate, later step.

## Open points
- A10 backfill runs only after Jordan or Ryan sees the derived-vs-stored report.
