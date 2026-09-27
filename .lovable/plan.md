# Next bundle (Stages 0–7): plan only, nothing gets applied until Jordan says "GO bundle"

Checked against the live code and database on Sun 9/27, 06:00 UTC. The build runs Monday 9/28 after 10:30 PM PT, with the frontend published after 11 PM PT and nothing run between 3:45 and 4:15 AM PT. Whatever auto clock-out state is live on Monday (B-2 or not) is the baseline and is not touched.

## Conflicts found in the live code (need a decision before GO)
1. **Locked 3D Data Cubes.** Stage 7 edits `DataCube.tsx`, `DataCube3D.tsx` and `watchMetrics.ts` to change the Last Year cube to −364 and relabel it "SDLY". The cubes are a locked feature. I need Jordan's "unlock please" for the Last Year value and label only (no change to rotation, faces or rendering). Without it, those three files are skipped and the cube keeps showing calendar last year (`subYears(now,1)` in DataCube3D today).
2. **Locked fluid dock.** Stage 7 edits `CompactDashboard.tsx` (the dock) for stored pace and the cache key, and that is data only. Please confirm that counts as "not touching the dock animation". It also imports `ManagerDashboardOverlay`, which stays unedited (K4).
3. **Stage 1 leaves one permission.** Live ACL: `anon=awdDxtm` on both tables. The REVOKE clears a, w, d, D, x and t but leaves **m (MAINTAIN, Postgres 17)**. Anon has no SELECT (no `r`) today. Proposal: add `MAINTAIN` to the same single statement and to its rollback GRANT. If that's not approved, A1 still passes as written.
4. **No `seed-week-projections` function exists.** The crons are `seed-week-projections-all-pos` (11:20 UTC) and `seed-next-week-projections-all-pos` (11:25 UTC), and both call `sales-week-projections`. The pre-open pace run goes into `sales-week-projections`, with no new cron job. Both run after the 4:15 AM PT quiet window.
5. **`pace_calculated_at` already exists** on sales_cache, so Stage 5 adds only `pace_week_projection` and `pace_month_projection`.
6. **Last year today is calendar −1 year**, not −364: `getYOYDate` in sales-service returns year−1 with the same month and day. So the Stage 6 yoy backfill changes `yoy_*` on essentially every row in the 400-day window. That is intended, and `pkgc_backup_sales_cache` covers it.
7. **Protected labor_cache rule.** Stage 4 writes `overtime_hours` / `double_time_hours` to punch_clock rows dated 9/26 or later. `source` and the unique key are kept, and pre-9/26 rows are never written. I'm treating this bundle as the explicit confirmation the project rule asks for. Say so if it isn't.
8. `labor_ot_premium` does not exist yet. labor_rules already has `overtime_multiplier`, `double_time_multiplier`, `daily_overtime_threshold` and `daily_double_time_threshold`. Confirmed facts: job 26 = `5 11 * * *`, `SELECT public.queue_nightly_emails();`, md5 5b332e3213d02aee99961233a01d909d; `idx_email_queue_dedup` is unique on dedup_key WHERE NOT NULL; the maintenance task "whos-out-next-week" exists in maintenance-service and is left as is. `resolve_goal` and `get_sales_comparisons` do not exist.

## Stage 0: capture (read-only plus two backup tables)
- Published version and commit (current HEAD e9a71e5c3; the published commit gets confirmed on the day). Checksum. md5 of every function replaced in Stages 3–5.
- `pkgc_backup_functions` (name, md5, def, exec_roles) and `pkgc_backup_sales_cache` (the listed columns, last 400 days). Both have RLS on and REVOKE ALL FROM PUBLIC, anon, authenticated.
- relacl and column-ACL md5 for profiles and labor_cache, the cron.job list, and get_store_labor for the 5 stores for 9/20–9/27.

## Stage 1: migration with the one REVOKE statement (plus MAINTAIN if approved)
Checks A1 and A2 as specified. Rollback: the GRANT line.

## Stage 2: aloha-sync only
- `sync_today`, `sync_all_today` and the today-only pace block use `rpc('business_date', {_location_id})` instead of `todayInTz`.
- `syncOneDay(date, mode)` gets an explicit `mode: 'live' | 'yesterday'`. It no longer compares against `addDays(todayInTz,-1)` (live lines ~365/399/407). `sync_yesterday` and `sync_all_yesterday` keep their current target date and pass 'yesterday'. Live always uses the ticker path.
- Checks as specified. Rollback: redeploy from the Stage 0 commit.

## Stage 3: Who's Out nightly on job 26
- The migration rebuilds `queue_nightly_emails()` from the live def, adding only the guarded `net.http_post` block before END. SECURITY DEFINER, search_path and EXECUTE (postgres, service_role) stay the same.
- `whos-out-email` gets action `run_nightly`: service role or CRON_SECRET only; reads `action` and `dry_run` only. Per active non-[TEST] store: target = greatest(business_date, local date) + 1. It uses `loadWhosOut(start=end=target)` and `resolveWhosOutRecipients`. Each store gets one email with subject "Who's out tomorrow, <Dow M/D> – <store>", source `whos_out_digest`, dedup `whos_out_day_v1_<loc>_<date>`. Error 23505 means already queued. Each store is wrapped in its own try/catch and logged. Existing actions are unchanged. `_shared/whos-out.ts` gets a one-day layout helper.
- Checks as specified (diff = the block only; a bad-URL rolled-back DO returns normally; 401/403; dry run; cron.job unchanged). Rollback: restore from backup and revert the function.

## Stage 4: overtime premium
- The migration creates `labor_ot_premium(id bool pk, enabled bool default true)`: RLS on, no grants except to the owner.
- Rebuild `labor_day_user_totals` and `labor_shifts` (plus `_labor_pair_shifts` consumers only if the live defs require it) from the live defs. For business dates on or after `labor_new_rule_start()` and enabled: each person/store/day's paid hours above the daily OT and DT thresholds (when > 0) add (mult−1)×wage. The premium is allocated chronologically to shifts. Signatures stay the same; new columns go only at the end.
- labor-service writes OT/DT hours on punch_clock rows dated 9/26 or later, then recomputes 9/26..today with the service role.
- Checks as specified. Rollback: flip it off and recompute, or restore the functions.

## Stage 5: Pack 3 server
- SQL: `resolve_goal`, `get_sales_comparisons`, and ALTER sales_cache to add the 2 columns. Rebuild `send_hourly_sales_pulse` and `send_day_part_pulse` from the live defs.
- Edge: `_shared/projections.ts` (computeAndSavePace), sales-service (sync-live, sync-yesterday tips, getYOYDate −364), clover-sync, aloha-sync (hourly scaling, on top of Stage 2), sales-week-projections (pre-open pace), fetch-qubeyond-sales (stored pace, −364, remove the today sales_cache and daily_tips upserts at ~3145/3176, same response keys), watch-device-service, ai-assistant, labor-intelligence, `_shared/whos-out.ts`, genius-usage-engine.
- Frontend file: `WeekTemplateBuilder` (−364) is held for the Stage 7 publish.
- Checks and rollback as specified.

## Stage 6: backfills (same approval, can wait a night)
yoy UPDATE via run_sql; QU sync-dates batched; Aloha 60-day re-sync. Checks and rollback as specified.

## Stage 7: one publish
Files: new `src/hooks/useStoreLabor.ts`; the dashboard, dock (CompactDashboard), org dashboard (useOrgDashboardData), reports, heatmap, Schedule, Time Tracking and pay-period components; the POS integration cards (QU / Aloha / Clover); SalesSummary; Dashboard; WeekTemplateBuilder; DataCube, DataCube3D and watchMetrics (only if unlocked); `useTeamSalesVisibility` is reused. Delete `src/pages/TimeTrackingPreview.tsx` and its route in `App.tsx`. Build check: `git diff --stat <stage0>..HEAD` must list no kiosk or punch files, or the build stops. Final checks 1–10 as specified.

## Confirmed not touched
The punch triggers, PunchClock.tsx, src/components/punchclock/, liveLabor.ts, kioskCutSavings.ts, punch-device-service, the auto clock-out job, settings, log and crons, and ManagerDashboardOverlay.tsx. No new cron job, and no DROP of any existing table.
