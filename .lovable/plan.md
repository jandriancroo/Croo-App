# Package B: auto clock-out job (plan only, nothing applied)

Checked against the live database on 9/26 at 8:20 PM PT: `labor_estimated_end` source, `time_punches` columns and triggers, cron job 240, grants and policies on `auto_punch_log` and `auto_punch_events`, `resolve_or_create_shift_id`, `labor_shift_resolutions` columns, and `locations.is_active`. Revised with Ryan's C1–C9 (9/26, 8:21 PM PT).

## What Jordan gets
- A new server job runs every 15 minutes. It only acts on shifts that are still open at store close + X minutes (default 180). If the store has no close time that day, it acts at clock-in + 16h.
- For the first night it only writes a "would clock out" list and changes no punches. People who are still working or on break never show up in that list.
- After Jordan reviews that night, one switch turns it on and turns off the old hourly job in the same step. Only one job ever writes punches.
- Hours and pay don't move when an auto clock-out lands. The only visible change is the "Auto" badge and the warning that doesn't block closing.
- No changes to tablet or punch screens, no changes to any punch trigger, no files under `src/`, and no publish.

## Corrections to Ryan's original plan (kept as approved)
1. **Null schedule link.** A clock-in with a NULL `shift_id` would fire the phantom-shift lookup, so it is skipped as `skipped_invalid` (`no_shift_id`). Live today: 0 of 600 recent clock-ins have one.
2. **Reason list.** The reason CHECK gains `'last_punch_floor'`. `'max_open_hours'` also covers stores with no hours set.
4. **Log-only comparison.** Our planned times come before v1's close + 4h, so compare the shift lists, not the times.
5. **Cron runs as the owner (`postgres`).** Granting EXECUTE only to `service_role` is fine.
6. **B4 grants.** Record `labor_estimated_end`'s EXECUTE grants before the change and put back exactly the same ones.
7. **B7 confirmed.** Right now anon and authenticated both have full write access to both tables, and the SELECT policies have no store scope.
8. Job 240's schedule and command are confirmed and get saved before the flip.

(Old correction 3, skipping an open break, is removed per C2.)

## C8 check (accepted by Ryan)
Under C1 the write time can be earlier than close + setting (for example, scheduled end + 1h). So V5 checks `first_seen >= due_at` and `planned_clock_out <= first_seen`. `due_at` is close + setting, or clock-in + max open hours when the store has no close time that day.

## Migration B-1 (log-only, SQL only), outline
```sql
-- C4 backups (Package A pattern: public.pkgb_*, RLS on, no API access)
CREATE TABLE public.pkgb_backup_functions AS
  SELECT 'labor_estimated_end'::text fn, pg_get_functiondef('public.labor_estimated_end'::regproc) def,
         (SELECT array_agg(r) FROM unnest(array['anon','authenticated','service_role']) r
           WHERE has_function_privilege(r,'public.labor_estimated_end(uuid)','EXECUTE')) exec_roles;
CREATE TABLE public.pkgb_backup_cron     AS SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobid = 240;
CREATE TABLE public.pkgb_backup_policies AS SELECT * FROM pg_policies WHERE tablename IN ('auto_punch_log','auto_punch_events');
CREATE TABLE public.pkgb_backup_grants   AS SELECT t, r, p FROM unnest(array['auto_punch_log','auto_punch_events']) t,
  unnest(array['anon','authenticated','service_role']) r,
  unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
  WHERE has_table_privilege(r, 'public.'||t, p);
CREATE TABLE public.pkgb_est_before AS SELECT id, public.labor_estimated_end(id) est FROM public.time_punches
  WHERE punch_type='clock_in' AND public.business_date(location_id, punch_time) >= public.labor_new_rule_start();
-- for each pkgb_* table: ENABLE ROW LEVEL SECURITY; REVOKE ALL ... FROM PUBLIC, anon, authenticated;

-- B1 settings (C3: mode changes only by migration)
CREATE TABLE public.auto_clock_out_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'log_only' CHECK (mode IN ('off','log_only','live')),
  updated_at timestamptz NOT NULL DEFAULT now(), updated_by uuid);
INSERT INTO public.auto_clock_out_settings DEFAULT VALUES;
REVOKE ALL ON public.auto_clock_out_settings FROM PUBLIC, anon, authenticated, service_role;   -- R2
GRANT SELECT ON public.auto_clock_out_settings TO service_role;
ALTER TABLE public.auto_clock_out_settings ENABLE ROW LEVEL SECURITY;   -- no policies

-- B2 log (C3: written only by the function owner)
CREATE TABLE public.auto_clock_out_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_seen timestamptz NOT NULL DEFAULT now(), last_seen timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL, location_id uuid NOT NULL, user_id uuid NOT NULL, clock_in_punch_id uuid NOT NULL,
  business_date date NOT NULL, planned_clock_out timestamptz, due_at timestamptz,
  reason text CHECK (reason IN ('scheduled_end_1h','close_plus_setting','max_open_hours','last_punch_floor')),
  close_at timestamptz, scheduled_end timestamptz, time_punch_id uuid, detail jsonb,
  status text NOT NULL CHECK (status IN ('would_write','written','skipped_next_punch','skipped_resolved',
    'skipped_invalid','skipped_cap','error')),
  UNIQUE (clock_in_punch_id, mode));
CREATE UNIQUE INDEX ON public.auto_clock_out_log(clock_in_punch_id) WHERE status = 'written';
CREATE INDEX ON public.auto_clock_out_log(location_id, business_date);
REVOKE ALL ON public.auto_clock_out_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.auto_clock_out_log TO authenticated, service_role;
ALTER TABLE public.auto_clock_out_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY acol_mgr_read ON public.auto_clock_out_log FOR SELECT TO authenticated
  USING (has_role_or_higher(auth.uid(),'manager') AND has_location_access(auth.uid(), location_id));

-- B4 detail + wrapper (C6)
CREATE FUNCTION public._labor_estimate_detail(_clock_in_punch_id uuid)
  RETURNS TABLE(uncapped_end timestamptz, floored_end timestamptz, reason text, close_at timestamptz,
                close_min int, max_open_hours numeric, scheduled_end timestamptz, next_clock_in timestamptz,
                last_punch timestamptz, last_punch_type text, tz text)
  LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  -- body = current labor_estimated_end line for line up to v_est := least(...);
  -- 0 rows if not a clock_in; exactly 1 row otherwise (RETURN NEXT once)
REVOKE ALL ON FUNCTION public._labor_estimate_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_estimate_detail(uuid) TO service_role;
CREATE OR REPLACE FUNCTION public.labor_estimated_end(_clock_in_punch_id uuid) RETURNS timestamptz
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
  AS $$ SELECT least(d.floored_end, now()) FROM public._labor_estimate_detail($1) d $$;
-- R1: Andy's rule 1 applies to the replaced function too (stays SECURITY DEFINER, search_path public, pg_temp)
REVOKE ALL ON FUNCTION public.labor_estimated_end(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_estimated_end(uuid) TO service_role;
-- then re-apply exec_roles from pkgb_backup_functions exactly
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM public.pkgb_est_before b
             WHERE b.est IS DISTINCT FROM public.labor_estimated_end(b.id)) THEN
    RAISE EXCEPTION 'V2 failed: labor_estimated_end changed';
  END IF; END $$;   -- now() is fixed inside the transaction, so this is an exact compare

-- B3
CREATE FUNCTION public.run_auto_clock_out() RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp;
REVOKE ALL ON FUNCTION public.run_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_auto_clock_out() TO service_role;

-- B7 (C5)
REVOKE ALL ON public.auto_punch_log, public.auto_punch_events FROM anon;
REVOKE ALL ON public.auto_punch_log, public.auto_punch_events FROM authenticated;
GRANT SELECT ON public.auto_punch_log, public.auto_punch_events TO authenticated;
DROP POLICY "Admins can view auto punch log" ON public.auto_punch_log;
DROP POLICY "Admins can view auto punch events" ON public.auto_punch_events;
CREATE POLICY "Managers view auto punch log for their stores" ON public.auto_punch_log FOR SELECT TO authenticated
  USING (has_role_or_higher(auth.uid(),'manager') AND has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers view auto punch events for their stores" ON public.auto_punch_events FOR SELECT TO authenticated
  USING (has_role_or_higher(auth.uid(),'manager') AND has_location_access(auth.uid(), location_id));
-- "Users can view their own auto punch events" is kept unchanged

-- B5
SELECT cron.schedule('auto-clock-out', '*/15 * * * *', 'SELECT public.run_auto_clock_out();');
```

## run_auto_clock_out() body
1. If `pg_try_advisory_xact_lock(hashtext('auto_clock_out'))` fails, return `{skipped:'locked'}`. Read mode. If it is `off`, return.
2. Candidates: `ci` joined to `locations l`, where:
   - `l.is_active`
   - `ci.punch_type = 'clock_in'` and `ci.punch_time > now() - interval '3 days'`
   - `business_date(ci.location_id, ci.punch_time) >= labor_new_rule_start()`
   - not a second tap (no clock_in by the same user and store in `[ci - dup, ci)`)
   - no clock_out by the same user and store in `(ci, coalesce(next_clock_in, 'infinity'))`
3. For each candidate, inside `BEGIN ... EXCEPTION WHEN others` (on error, log `error` with SQLERRM and keep going), read `d := _labor_estimate_detail(ci.id)`.
4. **Due gate first (C1).** Set `due_at := CASE WHEN d.close_at IS NOT NULL THEN d.close_at + make_interval(mins => d.close_min) ELSE ci.punch_time + make_interval(secs => d.max_open_hours*3600) END`. If `now() < due_at`, continue: no log row and no write.
5. Then these checks, in order:
   - `d.next_clock_in` is not null → `skipped_next_punch`
   - a `labor_shift_resolutions` row exists for this clock_in → `skipped_resolved`
   - `ci.shift_id` is null, or `d.floored_end <= ci.punch_time` → `skipped_invalid`
   - `log_only` → upsert `would_write`
   - `live` and fewer than 100 writes so far → lock the clock_in row with `FOR UPDATE`, re-check that no clock_out exists, then INSERT and upsert `written`
   - otherwise → `skipped_cap`
   - `detail` always records `open_break` (true when `d.last_punch_type = 'break_start'`), `close_min`, and `tz`. An open break is written like any other shift (C2).
6. Planned and written time = `least(d.floored_end, now())`. After the gate this is always below now(), so pairing hours are identical.
7. The upsert is on `(clock_in_punch_id, mode)` and refreshes last_seen, status, planned time, due_at, reason, and detail. A `written` row is never downgraded. Returns counts by status.

## The only write to time_punches (live mode only)
```sql
INSERT INTO public.time_punches (user_id, location_id, shift_id, punch_type, punch_time, is_auto_punched_out, notes, created_by)
VALUES (ci.user_id, ci.location_id, ci.shift_id, 'clock_out', least(d.floored_end, now()), true,
  format('auto_clock_out: %s (close %s +%sm)', d.reason,
         coalesce(to_char(d.close_at AT TIME ZONE d.tz, 'HH24:MI'), 'none'), d.close_min),
  NULL)
RETURNING id;
```
`has_break_violation`, `has_overtime`, and `has_extended_break` keep their default of false. No UPDATE or DELETE on any punch. The existing triggers run unchanged, and a non-null `shift_id` means no phantom shift.

## Migration B-2 (separate, later, after Jordan reviews the log-only night; one transaction)
```sql
UPDATE public.auto_clock_out_settings SET mode='live', updated_at=now(), updated_by=<jordan uuid>;
SELECT cron.unschedule('auto-punch-out-early');
```

## Verification
- **V1:** the frozen checksum for `labor_date < 2026-09-26` must be n=3702 / be1bd3380da920b25abdc827c2ad526c, before and after B-1 and before and after B-2.
- **V2:** runs inside B-1 as an exact compare that raises on any difference (see the B4 block).
- **V3:** `get_live_labor_totals`, `get_labor_totals_for_dates` (9/23–9/26), and `get_cut_savings_total` for Georgetown, Hemet, Palm Desert, and Palm Springs are identical before and after B-1.
- **V4 (C7):**
  - `has_function_privilege('anon'|'authenticated', f, 'EXECUTE')` is false for `run_auto_clock_out`, `_labor_estimate_detail`, and `labor_estimated_end`.
  - `has_table_privilege('anon','public.auto_clock_out_log','SELECT')` is false.
  - `has_table_privilege(r,'public.auto_clock_out_log','INSERT')` is false for anon, authenticated, and service_role.
  - `has_table_privilege('authenticated','public.auto_clock_out_settings','SELECT')` is false.
  - Anon and authenticated have only SELECT (for authenticated) on `auto_punch_log` and `auto_punch_events`, and nothing for anon.
  - A Hemet manager, tested with made-up login claims inside a rolled-back transaction, sees only Hemet rows in the log and only Hemet or own rows in the two old tables.
- **V5 (morning after, C8):**
  - `SELECT count(*) FROM time_punches WHERE notes LIKE 'auto_clock_out:%'` = 0.
  - `auto_punch_events` still got v1 rows overnight.
  - Every `would_write` row has `first_seen >= due_at`, `planned_clock_out <= first_seen`, and `due_at` equal to `close_at + setting`, or to clock-in + max open hours when there is no close time. (This is the version from the C8 conflict section above.)
  - The `would_write` shift list matches the shifts in `auto_punch_events`.
- **V6 safety (R4):**
  - Pre-check: the candidate query plus the due gate, run for every store except [TEST] Sandbox, must return 0 rows. If it returns more than 0, wait and re-check.
  - V6 runs as ONE `DO` block that ends in `RAISE EXCEPTION 'V6 done'`. That rolls back every write, every trigger effect, and every queued background refresh request.
  - Results are reported through `RAISE NOTICE` before the final exception.
  - Post-check: 0 new `time_punches`, 0 new `scheduled_shifts`, and 0 `auto_clock_out_log` rows since the start time.
- **V6 (one DO block at [TEST] Sandbox, mode set to live inside the block):**
  - one clock_out is written with the parent's `shift_id`, and no phantom shift is created
  - a second run writes 0
  - a later clock_in gives `skipped_next_punch`
  - a `zero` resolution gives `skipped_resolved`
  - a NULL `shift_id` gives `skipped_invalid`
  - a 1:30 AM close lands on the right date
  - an 8/25 clock_in is ignored
  - 101 due shifts give 100 `written` and 1 `skipped_cap`
  - (C9) someone scheduled to end early who is still clocked in before close + X gets no row and no write
  - (C9) a due shift with an open `break_start` is written, with `open_break=true` and hours unchanged
- **V7:** `cron.job` shows both `auto-clock-out` and `auto-punch-out-early` until B-2, and only `auto-clock-out` after it.

## Rollback
```sql
-- fast (under 1 min)
UPDATE public.auto_clock_out_settings SET mode='off';
-- only after B-2:
SELECT cron.schedule('auto-punch-out-early', '0 * * * *', (SELECT command FROM public.pkgb_backup_cron));
-- R3: first list auto clock-outs a manager edited, for review by hand (never deleted)
SELECT tp.id, tp.location_id, tp.user_id, tp.punch_time, tp.edited_by, tp.edited_at
  FROM public.time_punches tp JOIN public.auto_clock_out_log l ON l.time_punch_id = tp.id AND l.status='written'
 WHERE tp.edited_at IS NOT NULL;
DELETE FROM public.time_punches WHERE id IN (SELECT time_punch_id FROM public.auto_clock_out_log WHERE status='written')
  AND is_auto_punched_out AND edited_at IS NULL AND notes LIKE 'auto_clock_out:%';
-- full removal
SELECT cron.unschedule('auto-clock-out');
DROP FUNCTION public.run_auto_clock_out();
-- EXECUTE the def from pkgb_backup_functions (restores the original labor_estimated_end) and re-apply exec_roles
DROP FUNCTION public._labor_estimate_detail(uuid);
DROP TABLE public.auto_clock_out_log, public.auto_clock_out_settings;
-- restore auto_punch_log/events policies from pkgb_backup_policies and grants from pkgb_backup_grants
```

## Confirmed not touched
- Punch triggers, the `time_punches` structure, and any tablet or punch-screen files.
- Every file under `src/`, so there is no publish.
- B-1 is SQL only. B-2 is a separate, later migration.
- The v1 edge function stays deployed and is left unscheduled after B-2.
- `labor_cache` data before 9/26.
- The `EditShiftForm` write that marks an auto clock-out as reviewed, which belongs to Package C.
