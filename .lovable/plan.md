# Package B: auto clock-out job (plan only, nothing applied)

Checked against the live database on 9/26 at 8:20 PM PT: `labor_estimated_end` source, `time_punches` columns and triggers, cron job 240, grants and policies on `auto_punch_log` and `auto_punch_events`, `resolve_or_create_shift_id`, `labor_shift_resolutions` columns, and `locations.is_active`.

## What Jordan gets
- A new server job runs every 15 minutes. For the first night it only writes a list of "would clock out" rows. It changes no punches.
- After Jordan reviews that night, one switch turns it on and turns off the old hourly job in the same step. Only one job ever writes punches.
- Hours and pay don't move when an auto clock-out lands, because it lands at the same time the labor math already estimates. The only visible change is the "Auto" badge and the warning that doesn't block closing.
- No changes to tablet or punch screens, and no changes to any punch trigger.

## Corrections to Ryan's plan (from the live code)
1. **A shift with no schedule link can still get a phantom shift.** The trigger skips its lookup only when `shift_id` is NOT NULL. When the clock-in's own `shift_id` is NULL, passing it through explicitly is the same as passing nothing, so the trigger runs. Fix: if `ci.shift_id` is NULL, skip that person with `skipped_invalid` (detail `no_shift_id`) and leave them to v1 for now. V6 tests this case.
2. **The reason list is missing one value.** `labor_estimated_end` also applies `greatest(est, last punch)`. If a later break punch wins, the reason is none of the three listed. Add `'last_punch_floor'` to the reason CHECK. `'max_open_hours'` also covers stores with no hours set.
3. **Open break.** If the last punch is `break_start`, writing a clock_out would close a shift that is still on break. Add a skip `skipped_open_break` and include it in the status CHECK.
4. **What the log-only comparison can show.** Our time (close + 180, or scheduled end + 1h) always comes before v1's (close + 4h). So `would_write` rows appear first. v1 then writes its own clock_out at close + 4h, and those shifts count v1's time, as they do today. Tonight's `auto_punch_events` times will be later than our `planned_clock_out`. That's expected. Compare the shift lists, not the times.
5. **Cron runs as `postgres` (the owner).** Granting only `service_role` doesn't affect the cron call. Keep the grant as-is.
6. **B4 grants.** Record `labor_estimated_end`'s current EXECUTE grants before the change and put back exactly the same ones. The wrapper keeps the same name, arguments, STABLE, and SECURITY DEFINER.
7. **B7 confirmed.** Right now anon and authenticated both have INSERT/SELECT/DELETE on both tables. The `auto_punch_events` admin policy includes manager with no store scope, and the `auto_punch_log` policy has no store scope.
8. The `'0 * * * *'` schedule and the vault header for job 240 are confirmed. Save the full command into `pkgb_backup_cron` before the flip.

## Migration B-1 (log-only), outline
```sql
-- snapshots
CREATE TABLE backup.pkgb_backup_functions AS SELECT 'labor_estimated_end' fn, pg_get_functiondef('public.labor_estimated_end'::regproc) def;
CREATE TABLE backup.pkgb_backup_cron AS SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobid=240;
CREATE TABLE backup.pkgb_backup_policies AS SELECT * FROM pg_policies WHERE tablename IN ('auto_punch_log','auto_punch_events');
CREATE TABLE backup.pkgb_est_before AS SELECT id, public.labor_estimated_end(id) est FROM time_punches
  WHERE punch_type='clock_in' AND public.business_date(location_id,punch_time) >= labor_new_rule_start();

-- B1
CREATE TABLE public.auto_clock_out_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'log_only' CHECK (mode IN ('off','log_only','live')),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
INSERT INTO public.auto_clock_out_settings DEFAULT VALUES;
REVOKE ALL ON public.auto_clock_out_settings FROM PUBLIC, anon, authenticated;
GRANT ALL ON public.auto_clock_out_settings TO service_role;
ALTER TABLE ... ENABLE ROW LEVEL SECURITY;
CREATE POLICY acos_super_read ON ... FOR SELECT TO authenticated USING (has_role(auth.uid(),'super_admin'));
-- (read only through has_role; super_admin needs a SELECT grant: GRANT SELECT ... TO authenticated, policy limits it)

-- B2
CREATE TABLE public.auto_clock_out_log(
  id uuid PK DEFAULT gen_random_uuid(), first_seen timestamptz DEFAULT now(), last_seen timestamptz DEFAULT now(),
  mode text NOT NULL, location_id uuid NOT NULL, user_id uuid NOT NULL, clock_in_punch_id uuid NOT NULL,
  business_date date NOT NULL, planned_clock_out timestamptz,
  reason text CHECK (reason IN ('scheduled_end_1h','close_plus_setting','max_open_hours','last_punch_floor')),
  close_at timestamptz, scheduled_end timestamptz, time_punch_id uuid, detail jsonb,
  status text NOT NULL CHECK (status IN ('would_write','written','skipped_next_punch','skipped_resolved',
    'skipped_invalid','skipped_open_break','skipped_cap','error')),
  UNIQUE (clock_in_punch_id, mode));
CREATE UNIQUE INDEX ON public.auto_clock_out_log(clock_in_punch_id) WHERE status='written';
CREATE INDEX ON public.auto_clock_out_log(location_id, business_date);
GRANT SELECT ON ... TO authenticated; GRANT ALL ON ... TO service_role;   -- no anon
ALTER TABLE ... ENABLE RLS;
CREATE POLICY acol_mgr_read FOR SELECT TO authenticated
  USING (has_role_or_higher(auth.uid(),'manager') AND has_location_access(auth.uid(),location_id));

-- B4
CREATE FUNCTION public._labor_estimate_detail(_clock_in_punch_id uuid)
  RETURNS TABLE(uncapped_end timestamptz, floored_end timestamptz, reason text, close_at timestamptz,
                scheduled_end timestamptz, next_clock_in timestamptz, last_punch timestamptz, last_punch_type text)
  STABLE SECURITY DEFINER SET search_path = public, pg_temp
  -- body = current labor_estimated_end copied line for line up to v_est := least(...),
  -- plus reason = whichever term equals the least; floored_end = greatest(v_est, v_last)
REVOKE ALL ON FUNCTION _labor_estimate_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ... TO service_role;
CREATE OR REPLACE FUNCTION public.labor_estimated_end(_clock_in_punch_id uuid) RETURNS timestamptz
  STABLE SECURITY DEFINER SET search_path = public, pg_temp AS
  $$ SELECT least(d.floored_end, now()) FROM _labor_estimate_detail($1) d $$;  -- NULL when not a clock_in
-- re-apply the recorded grants for labor_estimated_end exactly

-- B3
CREATE FUNCTION public.run_auto_clock_out() RETURNS jsonb
  SECURITY DEFINER SET search_path = public, pg_temp  (plpgsql)
REVOKE ALL ... FROM PUBLIC, anon, authenticated; GRANT EXECUTE ... TO service_role;

-- B7
REVOKE ALL ON auto_punch_log, auto_punch_events FROM anon;
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON auto_punch_log, auto_punch_events FROM authenticated;
DROP POLICY "Admins can view auto punch log"; DROP POLICY "Admins can view auto punch events";
CREATE POLICY ... FOR SELECT TO authenticated USING (has_role_or_higher(auth.uid(),'manager')
  AND has_location_access(auth.uid(), location_id));   -- "own rows" events policy kept

-- B5
SELECT cron.schedule('auto-clock-out','*/15 * * * *','SELECT public.run_auto_clock_out();');
```

## run_auto_clock_out() body
1. If `pg_try_advisory_xact_lock(hashtext('auto_clock_out'))` fails, return `{skipped:'locked'}`. Read mode. If it is `off`, return.
2. Candidates: `ci` from `time_punches` joined to `locations l`, where:
   - `l.is_active`
   - `ci.punch_type='clock_in'` and `ci.punch_time > now() - interval '3 days'`
   - `business_date(ci.location_id, ci.punch_time) >= labor_new_rule_start()`
   - NOT EXISTS a clock_in by the same user and store in `[ci.punch_time - dup, ci.punch_time)` (not a second tap)
   - NOT EXISTS a clock_out by the same user and store in `(ci.punch_time, coalesce(next_clock_in, 'infinity'))`
3. For each candidate, inside `BEGIN ... EXCEPTION WHEN others` (on error, log `error` with SQLERRM and keep going), call `_labor_estimate_detail`. Checks run in this order:
   - `next_clock_in` is not null → `skipped_next_punch`
   - a `labor_shift_resolutions` row exists for this clock_in → `skipped_resolved`
   - `ci.shift_id` is null, or `uncapped_end <= ci.punch_time` → `skipped_invalid`
   - `last_punch_type = 'break_start'` → `skipped_open_break`
   - `uncapped_end >= now()` → not due, no log row
   - `log_only` → upsert `would_write`
   - `live` and fewer than 100 writes so far → re-check with `FOR UPDATE` on the clock_in row that no clock_out exists, then run the INSERT below and upsert `written`
   - otherwise → `skipped_cap`
4. The upsert is on `(clock_in_punch_id, mode)` and updates last_seen, status, planned time, reason, and detail. A `written` row is never downgraded.
5. Returns counts by status.

## The only write to time_punches (live mode only)
```sql
INSERT INTO public.time_punches (user_id, location_id, shift_id, punch_type, punch_time, is_auto_punched_out, notes, created_by)
VALUES (ci.user_id, ci.location_id, ci.shift_id, 'clock_out', least(d.floored_end, now()), true,
  format('auto_clock_out: %s (close %s +%sm)', d.reason,
         coalesce(to_char(d.close_at AT TIME ZONE tz,'HH24:MI'),'none'), close_min),
  NULL)
RETURNING id;
```
`has_break_violation`, `has_overtime`, and `has_extended_break` keep their default of false. No UPDATE or DELETE on any punch. The existing triggers run unchanged, and a non-null `shift_id` means no phantom shift.

## Migration B-2 (after Jordan reviews the log-only night; separate, one transaction)
```sql
UPDATE public.auto_clock_out_settings SET mode='live', updated_at=now(), updated_by=<jordan uuid>;
SELECT cron.unschedule('auto-punch-out-early');
```

## Verification
- **V1:** the frozen checksum query for `labor_date < 2026-09-26` must give n=3702 / be1bd3380da920b25abdc827c2ad526c, before and after B-1 and before and after B-2.
- **V2:** `SELECT count(*) FROM backup.pkgb_est_before b WHERE b.est IS DISTINCT FROM labor_estimated_end(b.id)` must be 0. Run it right after B4 in the same migration; if it isn't 0, RAISE, which rolls back the whole migration. Values sitting at the `now()` cap move with time, so compare `least(est, snapshot_ts)` on both sides.
- **V3:** `get_live_labor_totals`, `get_labor_totals_for_dates` (9/23–9/26), and `get_cut_savings_total` for Georgetown, Hemet, Palm Desert, and Palm Springs. Capture them just before the migration and just after, all inside one statement window, and they must match.
- **V4:**
  - `has_function_privilege('anon'|'authenticated', f, 'EXECUTE')` is false for `run_auto_clock_out` and `_labor_estimate_detail`. `labor_estimated_end` equals its recorded pre-change grants; its anon grant is already false from Package A.
  - As anon, `SET ROLE anon; SELECT` on both new tables is denied.
  - As a Hemet manager (JWT claims inside a rolled-back test), the log shows Hemet rows only, and `auto_punch_log` and `auto_punch_events` show only Hemet or own rows.
- **V5 (morning after):**
  - `SELECT count(*) FROM time_punches WHERE notes LIKE 'auto_clock_out:%'` = 0.
  - `would_write` rows exist.
  - Their shift list is compared with `auto_punch_events` from the same night.
- **V6:** in a BEGIN ... ROLLBACK at [TEST] Sandbox, with mode set to live inside the transaction, using made-up punches:
  - one clock_out is written with the parent's `shift_id`, and there's no new `is_phantom` shift
  - a second run writes 0
  - a later clock_in gives `skipped_next_punch`
  - a `zero` resolution gives `skipped_resolved`
  - a NULL `shift_id` gives `skipped_invalid`
  - an open `break_start` gives `skipped_open_break`
  - a 1:30 AM close lands on the right date
  - an 8/25 clock_in is ignored
  - 101 due shifts give 100 `written` and 1 `skipped_cap`
- **V7:** `SELECT jobid, jobname, schedule FROM cron.job WHERE jobname IN ('auto-clock-out','auto-punch-out-early')` shows both jobs until B-2 and only `auto-clock-out` after it.

## Rollback
```sql
-- fast (under 1 min)
UPDATE public.auto_clock_out_settings SET mode='off';
-- only after B-2: SELECT cron.schedule('auto-punch-out-early','0 * * * *',(SELECT command FROM backup.pkgb_backup_cron));
DELETE FROM public.time_punches WHERE id IN (SELECT time_punch_id FROM auto_clock_out_log WHERE status='written')
  AND is_auto_punched_out AND edited_at IS NULL;
-- full removal
SELECT cron.unschedule('auto-clock-out');
DROP FUNCTION public.run_auto_clock_out();
-- restore labor_estimated_end from backup.pkgb_backup_functions.def (EXECUTE), then:
DROP FUNCTION public._labor_estimate_detail(uuid);
DROP TABLE public.auto_clock_out_log, public.auto_clock_out_settings;
-- restore the 3 dropped/created policies from backup.pkgb_backup_policies and re-grant the prior table privileges
```

## Explicitly not touched
- Punch triggers, `time_punches` structure, and any tablet or punch-screen files.
- Every file under `src/`, so there's nothing to publish.
- The v1 `auto-punch-out` edge function stays deployed and is never scheduled again after B-2.
- `labor_cache` data before 9/26.
- The `EditShiftForm` write that marks an auto clock-out as reviewed, which belongs to Package C.
