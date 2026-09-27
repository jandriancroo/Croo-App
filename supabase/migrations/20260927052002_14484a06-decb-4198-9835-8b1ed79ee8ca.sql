-- lovable-cron-fallback-reviewed: approved Package B cadence; auto clock-out is time-based (close + X), no row event exists to trigger it; 96 runs/day
-- ===== C4 backups =====
CREATE TABLE public.pkgb_backup_functions AS
  SELECT 'labor_estimated_end'::text AS fn,
         pg_get_functiondef('public.labor_estimated_end(uuid)'::regprocedure) AS def,
         (SELECT array_agg(r) FROM unnest(array['anon','authenticated','service_role']) r
           WHERE has_function_privilege(r,'public.labor_estimated_end(uuid)','EXECUTE')) AS exec_roles;
CREATE TABLE public.pkgb_backup_cron AS SELECT jobid, jobname, schedule, command FROM cron.job WHERE jobid = 240;
CREATE TABLE public.pkgb_backup_policies AS
  SELECT schemaname, tablename, policyname, permissive, roles::text[] AS roles, cmd, qual, with_check
    FROM pg_policies WHERE schemaname='public' AND tablename IN ('auto_punch_log','auto_punch_events');
CREATE TABLE public.pkgb_backup_grants AS
  SELECT t, r, p FROM unnest(array['auto_punch_log','auto_punch_events']) t,
    unnest(array['anon','authenticated','service_role']) r,
    unnest(array['SELECT','INSERT','UPDATE','DELETE','TRUNCATE','REFERENCES','TRIGGER']) p
   WHERE has_table_privilege(r, 'public.'||t, p);
CREATE TABLE public.pkgb_est_before AS
  SELECT id, public.labor_estimated_end(id) AS est FROM public.time_punches
   WHERE punch_type='clock_in' AND public.business_date(location_id, punch_time) >= public.labor_new_rule_start();

DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY array['pkgb_backup_functions','pkgb_backup_cron','pkgb_backup_policies','pkgb_backup_grants','pkgb_est_before'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('REVOKE ALL ON public.%I FROM PUBLIC, anon, authenticated', t);
  END LOOP;
END $$;

-- V3 capture (before), exact because now() is fixed in this transaction
CREATE TEMP TABLE pkgb_v3_before ON COMMIT DROP AS
  SELECT loc, d, flag, (SELECT string_agg(row(s.*)::text, ';') FROM public._store_labor(loc, d, flag) s) AS v
    FROM unnest(array['79456db0-c817-464e-a849-bca44f8d6f34','12c977c7-1786-4131-90f5-1eef3f96e2c6',
                      '01a87b8b-fb29-4734-8d1b-4a47307f843c','d667741f-6d4c-433e-bb22-307e817ea7f1']::uuid[]) loc,
         unnest(array['2026-09-26']::date[]) d, unnest(array[true,false]) flag;

-- ===== B1 settings =====
CREATE TABLE public.auto_clock_out_settings(
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  mode text NOT NULL DEFAULT 'log_only' CHECK (mode IN ('off','log_only','live')),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid);
INSERT INTO public.auto_clock_out_settings DEFAULT VALUES;
REVOKE ALL ON public.auto_clock_out_settings FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.auto_clock_out_settings TO service_role;
ALTER TABLE public.auto_clock_out_settings ENABLE ROW LEVEL SECURITY;

-- ===== B2 log =====
CREATE TABLE public.auto_clock_out_log(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  first_seen timestamptz NOT NULL DEFAULT now(),
  last_seen timestamptz NOT NULL DEFAULT now(),
  mode text NOT NULL,
  location_id uuid NOT NULL,
  user_id uuid NOT NULL,
  clock_in_punch_id uuid NOT NULL,
  business_date date NOT NULL,
  planned_clock_out timestamptz,
  due_at timestamptz,
  reason text CHECK (reason IN ('scheduled_end_1h','close_plus_setting','max_open_hours','last_punch_floor')),
  close_at timestamptz,
  scheduled_end timestamptz,
  time_punch_id uuid,
  detail jsonb,
  status text NOT NULL CHECK (status IN ('would_write','written','skipped_next_punch','skipped_resolved','skipped_invalid','skipped_cap','error')),
  UNIQUE (clock_in_punch_id, mode));
CREATE UNIQUE INDEX auto_clock_out_log_written_uq ON public.auto_clock_out_log(clock_in_punch_id) WHERE status = 'written';
CREATE INDEX auto_clock_out_log_loc_bd_idx ON public.auto_clock_out_log(location_id, business_date);
REVOKE ALL ON public.auto_clock_out_log FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.auto_clock_out_log TO authenticated, service_role;
ALTER TABLE public.auto_clock_out_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY acol_mgr_read ON public.auto_clock_out_log FOR SELECT TO authenticated
  USING (public.has_role_or_higher(auth.uid(),'manager') AND public.has_location_access(auth.uid(), location_id));

-- ===== B4 detail =====
CREATE FUNCTION public._labor_estimate_detail(_clock_in_punch_id uuid)
RETURNS TABLE(uncapped_end timestamptz, floored_end timestamptz, reason text, close_at timestamptz,
              close_min int, max_open_hours numeric, scheduled_end timestamptz, next_clock_in timestamptz,
              last_punch timestamptz, last_punch_type text, tz text)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_ci timestamptz; v_uid uuid; v_loc uuid; v_tz text;
  v_maxh numeric := 16; v_close_min int := 180; v_dup int := 5;
  v_next timestamptz; v_last timestamptz; v_sched timestamptz; v_close timestamptz;
  v_bd date; v_open time; v_cl time; v_isclosed boolean;
  v_est timestamptz; v_floor timestamptz; v_reason text; v_last_type text;
BEGIN
  SELECT tp.punch_time, tp.user_id, tp.location_id INTO v_ci, v_uid, v_loc
    FROM public.time_punches tp WHERE tp.id = _clock_in_punch_id AND tp.punch_type = 'clock_in';
  IF v_ci IS NULL THEN RETURN; END IF;

  SELECT coalesce(lr.max_open_shift_hours, 16), coalesce(lr.auto_clock_out_after_close_min, 180), coalesce(lr.duplicate_tap_minutes, 5)
    INTO v_maxh, v_close_min, v_dup
    FROM public.labor_rules lr WHERE lr.location_id = v_loc ORDER BY lr.created_at LIMIT 1;
  v_maxh := coalesce(v_maxh, 16); v_close_min := coalesce(v_close_min, 180); v_dup := coalesce(v_dup, 5);
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = v_loc;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');

  SELECT min(tp.punch_time) INTO v_next FROM public.time_punches tp
   WHERE tp.location_id = v_loc AND tp.user_id = v_uid AND tp.punch_type = 'clock_in'
     AND tp.punch_time > v_ci + make_interval(mins => v_dup);

  SELECT max(tp.punch_time) INTO v_last FROM public.time_punches tp
   WHERE tp.location_id = v_loc AND tp.user_id = v_uid
     AND tp.punch_time >= v_ci AND (v_next IS NULL OR tp.punch_time < v_next);

  SELECT tp.punch_type INTO v_last_type FROM public.time_punches tp
   WHERE tp.location_id = v_loc AND tp.user_id = v_uid AND tp.punch_time = v_last
   ORDER BY tp.created_at DESC NULLS LAST LIMIT 1;

  SELECT x.e INTO v_sched FROM (
    SELECT ((ss.shift_date + ss.end_time) AT TIME ZONE v_tz)
             + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END AS e,
           abs(extract(epoch FROM ((ss.shift_date + ss.start_time) AT TIME ZONE v_tz) - v_ci)) AS dist
      FROM public.scheduled_shifts ss JOIN public.schedules s ON s.id = ss.schedule_id
     WHERE s.location_id = v_loc AND ss.user_id = v_uid AND NOT coalesce(ss.is_time_off, false)
       AND ss.shift_date BETWEEN (v_ci AT TIME ZONE v_tz)::date - 1 AND (v_ci AT TIME ZONE v_tz)::date + 1
  ) x ORDER BY x.dist LIMIT 1;

  v_bd := public.business_date(v_loc, v_ci);
  SELECT lh.open_time, lh.close_time, lh.is_closed INTO v_open, v_cl, v_isclosed
    FROM public.location_hours lh WHERE lh.location_id = v_loc AND lh.day_of_week = extract(dow FROM v_bd)::int
    LIMIT 1;
  IF v_cl IS NOT NULL AND NOT coalesce(v_isclosed, false) THEN
    v_close := ((v_bd + v_cl) AT TIME ZONE v_tz)
               + CASE WHEN v_open IS NOT NULL AND v_cl <= v_open THEN interval '1 day' ELSE interval '0' END;
  END IF;

  v_est := least(v_next,
                 v_sched + interval '1 hour',
                 v_close + make_interval(mins => v_close_min),
                 v_ci + make_interval(secs => (v_maxh * 3600)::double precision));
  v_floor := greatest(v_est, v_last);

  v_reason := CASE
    WHEN v_floor IS DISTINCT FROM v_est THEN 'last_punch_floor'
    WHEN v_est = v_next THEN 'next_clock_in'
    WHEN v_est = v_sched + interval '1 hour' THEN 'scheduled_end_1h'
    WHEN v_est = v_close + make_interval(mins => v_close_min) THEN 'close_plus_setting'
    ELSE 'max_open_hours' END;

  uncapped_end := v_est; floored_end := v_floor; reason := v_reason; close_at := v_close;
  close_min := v_close_min; max_open_hours := v_maxh; scheduled_end := v_sched; next_clock_in := v_next;
  last_punch := v_last; last_punch_type := v_last_type; tz := v_tz;
  RETURN NEXT;
END;
$function$;
REVOKE ALL ON FUNCTION public._labor_estimate_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_estimate_detail(uuid) TO service_role;

-- ===== B4 wrapper =====
CREATE OR REPLACE FUNCTION public.labor_estimated_end(_clock_in_punch_id uuid)
RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $function$ SELECT least(d.floored_end, now()) FROM public._labor_estimate_detail(_clock_in_punch_id) d $function$;
REVOKE ALL ON FUNCTION public.labor_estimated_end(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_estimated_end(uuid) TO service_role;
DO $$ DECLARE r text; BEGIN
  FOR r IN SELECT unnest(exec_roles) FROM public.pkgb_backup_functions LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.labor_estimated_end(uuid) TO %I', r);
  END LOOP;
END $$;

-- V2 exact compare + V3 compare
DO $$ DECLARE n int; BEGIN
  SELECT count(*) INTO n FROM public.pkgb_est_before b WHERE b.est IS DISTINCT FROM public.labor_estimated_end(b.id);
  IF n > 0 THEN RAISE EXCEPTION 'V2 failed: % labor_estimated_end values changed', n; END IF;
  SELECT count(*) INTO n FROM pkgb_v3_before b
   WHERE b.v IS DISTINCT FROM (SELECT string_agg(row(s.*)::text, ';') FROM public._store_labor(b.loc, b.d, b.flag) s);
  IF n > 0 THEN RAISE EXCEPTION 'V3 failed: % store labor results changed', n; END IF;
END $$;

-- ===== B3 job function =====
CREATE FUNCTION public.run_auto_clock_out()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp
AS $function$
DECLARE
  v_mode text; r record; d record;
  v_due timestamptz; v_status text; v_planned timestamptz; v_tp uuid;
  v_writes int := 0; v_counts jsonb := '{}'::jsonb; v_detail jsonb; v_reason text;
BEGIN
  IF NOT pg_try_advisory_xact_lock(hashtext('auto_clock_out')) THEN
    RETURN jsonb_build_object('skipped','locked');
  END IF;
  SELECT mode INTO v_mode FROM public.auto_clock_out_settings WHERE id;
  IF v_mode IS NULL OR v_mode = 'off' THEN RETURN jsonb_build_object('mode', coalesce(v_mode,'off')); END IF;

  FOR r IN
    SELECT ci.id, ci.user_id, ci.location_id, ci.shift_id, ci.punch_time,
           public.business_date(ci.location_id, ci.punch_time) AS bd,
           coalesce((SELECT lr.duplicate_tap_minutes FROM public.labor_rules lr
                      WHERE lr.location_id = ci.location_id ORDER BY lr.created_at LIMIT 1), 5) AS dup
      FROM public.time_punches ci
      JOIN public.locations l ON l.id = ci.location_id AND l.is_active
     WHERE ci.punch_type = 'clock_in'
       AND ci.punch_time > now() - interval '3 days'
       AND public.business_date(ci.location_id, ci.punch_time) >= public.labor_new_rule_start()
     ORDER BY ci.punch_time
  LOOP
    BEGIN
      -- second tap of a double tap: skip
      IF EXISTS (SELECT 1 FROM public.time_punches p
                  WHERE p.location_id = r.location_id AND p.user_id = r.user_id AND p.punch_type = 'clock_in'
                    AND p.punch_time >= r.punch_time - make_interval(mins => r.dup) AND p.punch_time < r.punch_time) THEN
        CONTINUE;
      END IF;

      SELECT * INTO d FROM public._labor_estimate_detail(r.id);
      IF NOT FOUND THEN CONTINUE; END IF;

      -- already clocked out before the next shift: nothing to do
      IF EXISTS (SELECT 1 FROM public.time_punches p
                  WHERE p.location_id = r.location_id AND p.user_id = r.user_id AND p.punch_type = 'clock_out'
                    AND p.punch_time > r.punch_time
                    AND p.punch_time < coalesce(d.next_clock_in, 'infinity'::timestamptz)) THEN
        CONTINUE;
      END IF;

      -- C1 due gate FIRST: no row at all until close + setting (or ci + max open hours)
      v_due := CASE WHEN d.close_at IS NOT NULL THEN d.close_at + make_interval(mins => d.close_min)
                    ELSE r.punch_time + make_interval(secs => (d.max_open_hours * 3600)::double precision) END;
      IF now() < v_due THEN CONTINUE; END IF;

      v_planned := least(d.floored_end, now());
      v_reason := CASE WHEN d.reason IN ('scheduled_end_1h','close_plus_setting','max_open_hours','last_punch_floor') THEN d.reason END;
      v_detail := jsonb_build_object('open_break', coalesce(d.last_punch_type = 'break_start', false),
                                     'close_min', d.close_min, 'tz', d.tz, 'raw_reason', d.reason,
                                     'next_clock_in', d.next_clock_in, 'last_punch', d.last_punch);
      v_tp := NULL;

      IF d.next_clock_in IS NOT NULL THEN
        v_status := 'skipped_next_punch';
      ELSIF EXISTS (SELECT 1 FROM public.labor_shift_resolutions x WHERE x.clock_in_punch_id = r.id) THEN
        v_status := 'skipped_resolved';
      ELSIF r.shift_id IS NULL OR d.floored_end <= r.punch_time THEN
        v_status := 'skipped_invalid';
        IF r.shift_id IS NULL THEN v_detail := v_detail || '{"why":"no_shift_id"}'::jsonb; END IF;
      ELSIF v_mode = 'log_only' THEN
        v_status := 'would_write';
      ELSIF v_writes < 100 THEN
        PERFORM 1 FROM public.time_punches WHERE id = r.id FOR UPDATE;
        IF EXISTS (SELECT 1 FROM public.time_punches p
                    WHERE p.location_id = r.location_id AND p.user_id = r.user_id AND p.punch_type = 'clock_out'
                      AND p.punch_time > r.punch_time) THEN
          CONTINUE;
        END IF;
        INSERT INTO public.time_punches (user_id, location_id, shift_id, punch_type, punch_time, is_auto_punched_out, notes, created_by)
        VALUES (r.user_id, r.location_id, r.shift_id, 'clock_out', v_planned, true,
                format('auto_clock_out: %s (close %s +%sm)', d.reason,
                       coalesce(to_char(d.close_at AT TIME ZONE d.tz, 'HH24:MI'), 'none'), d.close_min),
                NULL)
        RETURNING id INTO v_tp;
        v_writes := v_writes + 1;
        v_status := 'written';
      ELSE
        v_status := 'skipped_cap';
      END IF;

      INSERT INTO public.auto_clock_out_log AS g
        (mode, location_id, user_id, clock_in_punch_id, business_date, planned_clock_out, due_at, reason,
         close_at, scheduled_end, time_punch_id, detail, status)
      VALUES (v_mode, r.location_id, r.user_id, r.id, r.bd, v_planned, v_due, v_reason,
              d.close_at, d.scheduled_end, v_tp, v_detail, v_status)
      ON CONFLICT (clock_in_punch_id, mode) DO UPDATE
        SET last_seen = now(), status = EXCLUDED.status, planned_clock_out = EXCLUDED.planned_clock_out,
            due_at = EXCLUDED.due_at, reason = EXCLUDED.reason, close_at = EXCLUDED.close_at,
            scheduled_end = EXCLUDED.scheduled_end, detail = EXCLUDED.detail,
            time_punch_id = coalesce(EXCLUDED.time_punch_id, g.time_punch_id)
        WHERE g.status <> 'written';

      v_counts := jsonb_set(v_counts, array[v_status], to_jsonb(coalesce((v_counts->>v_status)::int, 0) + 1));
    EXCEPTION WHEN others THEN
      BEGIN
        INSERT INTO public.auto_clock_out_log AS g
          (mode, location_id, user_id, clock_in_punch_id, business_date, detail, status)
        VALUES (v_mode, r.location_id, r.user_id, r.id, r.bd, jsonb_build_object('error', SQLERRM), 'error')
        ON CONFLICT (clock_in_punch_id, mode) DO UPDATE
          SET last_seen = now(), status = 'error', detail = EXCLUDED.detail
          WHERE g.status <> 'written';
      EXCEPTION WHEN others THEN NULL;
      END;
      v_counts := jsonb_set(v_counts, array['error'], to_jsonb(coalesce((v_counts->>'error')::int, 0) + 1));
    END;
  END LOOP;

  RETURN jsonb_build_object('mode', v_mode, 'counts', v_counts, 'writes', v_writes, 'at', now());
END;
$function$;
REVOKE ALL ON FUNCTION public.run_auto_clock_out() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.run_auto_clock_out() TO service_role;

-- ===== B7 =====
REVOKE ALL ON public.auto_punch_log, public.auto_punch_events FROM anon;
REVOKE ALL ON public.auto_punch_log, public.auto_punch_events FROM authenticated;
GRANT SELECT ON public.auto_punch_log, public.auto_punch_events TO authenticated;
DROP POLICY "Admins can view auto punch log" ON public.auto_punch_log;
DROP POLICY "Admins can view auto punch events" ON public.auto_punch_events;
CREATE POLICY "Managers view auto punch log for their stores" ON public.auto_punch_log FOR SELECT TO authenticated
  USING (public.has_role_or_higher(auth.uid(),'manager') AND public.has_location_access(auth.uid(), location_id));
CREATE POLICY "Managers view auto punch events for their stores" ON public.auto_punch_events FOR SELECT TO authenticated
  USING (public.has_role_or_higher(auth.uid(),'manager') AND public.has_location_access(auth.uid(), location_id));

-- ===== B5 cron =====
SELECT cron.schedule('auto-clock-out', '*/15 * * * *', 'SELECT public.run_auto_clock_out();');
