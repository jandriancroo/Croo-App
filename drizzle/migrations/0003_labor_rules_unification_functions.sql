CREATE OR REPLACE FUNCTION public.effective_labor_rules(_location_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v jsonb; v_st text;
BEGIN
  SELECT to_jsonb(lr) || '{"source":"location"}'::jsonb INTO v
    FROM public.labor_rules lr WHERE lr.location_id = _location_id;
  IF v IS NULL THEN
    SELECT d.state_code INTO v_st FROM public.locations l
      CROSS JOIN LATERAL public.derive_store_region(l.address) d WHERE l.id = _location_id;
    IF v_st IS NOT NULL THEN
      SELECT to_jsonb(p) || '{"source":"preset"}'::jsonb INTO v
        FROM public.labor_rule_presets p WHERE p.is_system AND p.state_code = v_st
       ORDER BY p.created_at LIMIT 1;
    END IF;
  END IF;
  IF v IS NULL THEN
    SELECT to_jsonb(p) || '{"source":"default"}'::jsonb INTO v
      FROM public.labor_rule_presets p WHERE p.preset_name = 'Federal Default' ORDER BY p.created_at LIMIT 1;
  END IF;
  v := coalesce(v, '{"source":"default"}'::jsonb);
  v := v || jsonb_build_object(
    'unpaid_break_min_minutes', coalesce(nullif(v->'unpaid_break_min_minutes','null'::jsonb), '30'::jsonb),
    'duplicate_tap_minutes',    coalesce(nullif(v->'duplicate_tap_minutes','null'::jsonb), '5'::jsonb),
    'long_break_grace_minutes', coalesce(nullif(v->'long_break_grace_minutes','null'::jsonb), '5'::jsonb),
    'long_shift_hours',         coalesce(nullif(v->'long_shift_hours','null'::jsonb), '10'::jsonb));
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public._shift_flags_with_rules(_location_id uuid, _start date, _end date, _rules jsonb)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_out_punch_id uuid,
              clock_in timestamptz, clock_out timestamptz, paid_min int, flags text[], details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
DECLARE
  v_today date; wsdow int; v_ws date; v_we date; v_lo date; v_hi date;
  v_sh jsonb; v_ot jsonb := '{}'::jsonb; v_cls jsonb; v_prules jsonb; u record; v_wage numeric; v_tz text;
  r_basis text := coalesce(_rules->>'meal_rule_basis', 'law');
  r_mbh numeric := nullif(_rules->>'meal_break_hours','')::numeric;
  r_mlen numeric := coalesce(nullif(_rules->>'meal_break_duration','')::numeric, nullif(_rules->>'unpaid_break_min_minutes','')::numeric, 30);
  r_waiv numeric := nullif(_rules->>'meal_waiver_max_hours','')::numeric;
  r_m2 numeric := nullif(_rules->>'second_meal_break_hours','')::numeric;
  r_w2 numeric := nullif(_rules->>'second_meal_waiver_max_hours','')::numeric;
  r_dead numeric := nullif(_rules->>'meal_deadline_hours','')::numeric;
  r_grace numeric := coalesce(nullif(_rules->>'long_break_grace_minutes','')::numeric, 5);
  r_long numeric := coalesce(nullif(_rules->>'long_shift_hours','')::numeric, 10);
  r_split boolean := coalesce((_rules->>'split_shift_enabled')::boolean, false);
  r_gap numeric := nullif(_rules->>'split_shift_gap_minutes','')::numeric;
  r_turn numeric := nullif(_rules->>'min_hours_between_shifts','')::numeric;
  r_rest_on boolean := coalesce((_rules->>'flag_rest_breaks')::boolean, false);
  r_rest numeric := nullif(_rules->>'rest_break_hours','')::numeric;
  r_minor jsonb := nullif(_rules->'minor_rules', 'null'::jsonb);
  r_minor_max numeric; r_minor_end time;
BEGIN
  IF _location_id IS NULL OR _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  r_minor_max := nullif(coalesce(r_minor->>'max_daily_hours', r_minor->>'max_hours_school_day'), '')::numeric;
  r_minor_end := nullif(r_minor->>'latest_end_school_night', '')::time;
  v_today := public.business_date(_location_id);
  v_tz := coalesce((SELECT ls.timezone FROM public.location_settings ls WHERE ls.location_id = _location_id), 'America/Los_Angeles');
  wsdow := coalesce(nullif(_rules->>'workweek_start_dow','')::int, 1);
  v_ws := _start - ((extract(dow from _start)::int - wsdow + 7) % 7);
  v_we := _end + (6 - ((extract(dow from _end)::int - wsdow + 7) % 7));
  v_lo := least(v_ws, _start - 1);
  v_hi := least(v_we, v_today);

  SELECT coalesce(jsonb_agg(to_jsonb(s) || jsonb_build_object(
           'ph', round(greatest(s.worked_sec - s.unpaid_sec, 0) / 3600, 4),
           'pm', floor(greatest(s.worked_sec - s.unpaid_sec, 0) / 60)::int,
           'rz', EXISTS (SELECT 1 FROM public.labor_shift_resolutions r WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'zero'),
           'ar', EXISTS (SELECT 1 FROM public.labor_shift_resolutions r WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'auto_reviewed'))), '[]'::jsonb)
    INTO v_sh
    FROM generate_series(v_lo::timestamp, v_hi::timestamp, interval '1 day') g
    CROSS JOIN LATERAL public._labor_pair_shifts(_location_id, g::date, g::date = v_today, true) s;

  v_prules := jsonb_build_object('d_ot', _rules->'daily_overtime_threshold', 'd_dt', _rules->'daily_double_time_threshold',
    'w_ot', coalesce(nullif(_rules->>'weekly_overtime_threshold','')::numeric, 40),
    'seventh', coalesce((_rules->>'seventh_day_rule')::boolean, false),
    'max_wage', _rules->'daily_ot_max_wage', 'window', coalesce(_rules->>'daily_ot_window', 'business_day'), 'wsdow', wsdow);
  FOR u IN
    SELECT x.user_id AS uid, jsonb_agg(jsonb_build_object('d', x.business_date, 'ci', x.clock_in,
             'co', coalesce(x.clock_out, x.estimated_end), 'h', x.ph)) AS cls
      FROM jsonb_to_recordset(v_sh) AS x(user_id uuid, business_date date, clock_in timestamptz, clock_out timestamptz,
                                          estimated_end timestamptz, ph numeric, rz boolean)
     WHERE x.business_date BETWEEN v_ws AND v_we AND NOT x.rz
     GROUP BY x.user_id
  LOOP
    v_wage := coalesce(
      (SELECT wh.hourly_wage FROM public.wage_history wh WHERE wh.user_id = u.uid AND wh.effective_date <= _end
        ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
      (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = u.uid));
    v_cls := public._payroll_classify(u.cls, v_prules, v_wage);
    v_ot := v_ot || jsonb_build_object(u.uid::text,
      coalesce((SELECT jsonb_object_agg(e->>'d', jsonb_build_object('ot', e->'ot', 'dt', e->'dt')) FROM jsonb_array_elements(v_cls) e), '{}'::jsonb));
  END LOOP;

  RETURN QUERY
  WITH sh AS (
    SELECT * FROM jsonb_to_recordset(v_sh) AS x(user_id uuid, business_date date, clock_in_punch_id uuid,
      clock_out_punch_id uuid, clock_in timestamptz, clock_out timestamptz, estimated_end timestamptz,
      open_shift_live boolean, missing_clock_out boolean, unclosed_break_count int, ph numeric, pm int, rz boolean, ar boolean)
  ), tgt AS (
    SELECT * FROM sh WHERE sh.business_date BETWEEN _start AND _end
  ), br AS (
    SELECT s.clock_in_punch_id AS cid, b.punch_time AS bs, e.et AS be,
           extract(epoch from (e.et - b.punch_time)) / 60.0 AS mn
      FROM tgt s
      JOIN public.time_punches b ON b.user_id = s.user_id AND b.location_id = _location_id
       AND b.punch_type = 'break_start' AND b.punch_time > s.clock_in
       AND b.punch_time < coalesce(s.clock_out, s.estimated_end, now())
      LEFT JOIN LATERAL (
        SELECT e.punch_time AS et FROM public.time_punches e
         WHERE e.user_id = s.user_id AND e.location_id = _location_id
           AND e.punch_type IN ('break_end','clock_in','clock_out') AND e.punch_time > b.punch_time
         ORDER BY e.punch_time LIMIT 1) e ON true
  ), bagg AS (
    SELECT br.cid,
           jsonb_agg(jsonb_build_object('start', br.bs, 'end', br.be, 'min', round(br.mn, 1),
             'long', br.mn IS NOT NULL AND round(br.mn) > r_mlen + r_grace) ORDER BY br.bs) AS breaks,
           max(br.mn) AS longest,
           count(*) FILTER (WHERE br.mn >= r_mlen) AS nq,
           min(br.bs) FILTER (WHERE br.mn >= r_mlen) AS first_q,
           bool_or(br.mn IS NOT NULL AND round(br.mn) > r_mlen + r_grace) AS any_long,
           count(*) FILTER (WHERE br.mn IS NOT NULL AND br.mn < r_mlen) AS nrest
      FROM br GROUP BY br.cid
  ), late AS (
    SELECT ba.cid,
           extract(epoch from (ba.first_q - s.clock_in)) / 60.0
             - coalesce((SELECT sum(b2.mn) FROM br b2 WHERE b2.cid = ba.cid AND b2.bs < ba.first_q), 0) AS worked_before
      FROM bagg ba JOIN tgt s ON s.clock_in_punch_id = ba.cid WHERE ba.first_q IS NOT NULL
  ), dy AS (
    SELECT sh.user_id, sh.business_date, sum(sh.pm) AS dpm FROM sh GROUP BY 1, 2
  ), otd AS (
    SELECT t.clock_in_punch_id AS cid,
           coalesce((v_ot->(t.user_id::text)->(t.business_date::text)->>'ot')::numeric, 0) AS d_ot,
           coalesce((v_ot->(t.user_id::text)->(t.business_date::text)->>'dt')::numeric, 0) AS d_dt,
           CASE WHEN t.rz THEN 0 ELSE t.ph END AS h,
           coalesce(sum(CASE WHEN t2.rz THEN 0 ELSE t2.ph END), 0) AS later_h
      FROM tgt t
      LEFT JOIN sh t2 ON t2.user_id = t.user_id AND t2.business_date = t.business_date
       AND (t2.clock_in > t.clock_in OR (t2.clock_in = t.clock_in AND t2.clock_in_punch_id > t.clock_in_punch_id))
     GROUP BY t.clock_in_punch_id, t.user_id, t.business_date, t.rz, t.ph
  ), ots AS (
    SELECT o.cid,
           least(greatest(o.d_dt - o.later_h, 0), o.h) AS s_dt,
           least(o.h, greatest(o.d_ot + o.d_dt - o.later_h, 0)) - least(greatest(o.d_dt - o.later_h, 0), o.h) AS s_ot
      FROM otd o
  ), c AS (
    SELECT t.*, ba.breaks, ba.longest, coalesce(ba.nq, 0) AS nq, coalesce(ba.any_long, false) AS any_long,
           coalesce(ba.nrest, 0) AS nrest, lt.worked_before, d.dpm,
           coalesce(o.s_ot, 0) AS s_ot, coalesce(o.s_dt, 0) AS s_dt,
           coalesce(co.is_auto_punched_out, false) AS is_auto,
           pr.birthday,
           EXISTS (SELECT 1 FROM sh e WHERE e.user_id = t.user_id AND e.business_date = t.business_date
                     AND e.clock_in < t.clock_in AND e.clock_out IS NOT NULL
                     AND e.clock_out < t.clock_in - make_interval(mins => coalesce(r_gap, 0)::int)) AS is_split,
           (SELECT max(coalesce(p.clock_out, p.estimated_end)) FROM sh p
             WHERE p.user_id = t.user_id AND p.clock_in < t.clock_in) AS prev_end
      FROM tgt t
      LEFT JOIN bagg ba ON ba.cid = t.clock_in_punch_id
      LEFT JOIN late lt ON lt.cid = t.clock_in_punch_id
      LEFT JOIN dy d ON d.user_id = t.user_id AND d.business_date = t.business_date
      LEFT JOIN ots o ON o.cid = t.clock_in_punch_id
      LEFT JOIN public.time_punches co ON co.id = t.clock_out_punch_id
      LEFT JOIN public.profiles pr ON pr.id = t.user_id
  )
  SELECT c.user_id, c.business_date, c.clock_in_punch_id, c.clock_out_punch_id, c.clock_in, c.clock_out, c.pm,
    array_remove(ARRAY[
      CASE WHEN c.missing_clock_out AND NOT c.rz THEN 'missing_clock_out' END,
      CASE WHEN c.is_auto AND NOT c.ar THEN 'auto_clock_out' END,
      CASE WHEN c.unclosed_break_count > 0 THEN 'open_break' END,
      CASE WHEN r_basis <> 'none' AND r_mbh IS NOT NULL AND c.clock_out IS NOT NULL AND NOT c.open_shift_live
             AND c.pm > r_mbh * 60 AND NOT (r_waiv IS NOT NULL AND c.pm <= r_waiv * 60) AND c.nq = 0
           THEN 'no_meal_break' END,
      CASE WHEN r_m2 IS NOT NULL AND c.pm > r_m2 * 60 AND NOT (r_w2 IS NOT NULL AND c.pm <= r_w2 * 60) AND c.nq < 2
           THEN 'second_meal_missing' END,
      CASE WHEN r_dead IS NOT NULL AND r_basis <> 'none' AND c.worked_before IS NOT NULL AND c.worked_before > r_dead * 60
           THEN 'meal_late' END,
      CASE WHEN c.any_long THEN 'long_break' END,
      CASE WHEN c.dpm > r_long * 60 THEN 'long_shift' END,
      CASE WHEN c.s_ot + c.s_dt > 0 THEN 'overtime' END,
      CASE WHEN r_split AND c.is_split THEN 'split_shift' END,
      CASE WHEN r_turn IS NOT NULL AND c.prev_end IS NOT NULL
             AND extract(epoch from (c.clock_in - c.prev_end)) < r_turn * 3600 THEN 'short_turnaround' END,
      CASE WHEN r_rest_on AND r_rest IS NOT NULL AND r_rest > 0
             AND c.nrest < round(c.pm / (r_rest * 60)) THEN 'rest_break_missing' END,
      CASE WHEN r_minor IS NOT NULL AND c.birthday IS NOT NULL AND date_part('year', age(c.business_date, c.birthday)) < 18
             AND r_minor_max IS NOT NULL AND c.dpm > r_minor_max * 60 THEN 'minor_hours' END,
      CASE WHEN r_minor IS NOT NULL AND c.birthday IS NOT NULL AND date_part('year', age(c.business_date, c.birthday)) < 18
             AND r_minor_end IS NOT NULL AND c.clock_out IS NOT NULL
             AND (c.clock_out AT TIME ZONE v_tz)::time > r_minor_end THEN 'minor_late' END
    ]::text[], NULL),
    jsonb_build_object(
      'basis', r_basis,
      'rules', jsonb_build_object('meal_break_hours', r_mbh, 'meal_break_duration', r_mlen,
                 'meal_waiver_max_hours', r_waiv, 'second_meal_break_hours', r_m2,
                 'long_break_threshold', r_mlen + r_grace, 'long_shift_hours', r_long),
      'breaks', coalesce(c.breaks, '[]'::jsonb),
      'day_paid_min', c.dpm,
      'ot', round(c.s_ot, 4), 'dt', round(c.s_dt, 4),
      'short_meal_min', CASE WHEN c.longest IS NOT NULL THEN round(c.longest, 1) END)
  FROM c
  ORDER BY c.business_date, c.clock_in;
END $$;

CREATE OR REPLACE FUNCTION public._shift_flags(_location_id uuid, _start date, _end date)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_out_punch_id uuid,
              clock_in timestamptz, clock_out timestamptz, paid_min int, flags text[], details jsonb)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT * FROM public._shift_flags_with_rules(_location_id, _start, _end, public.effective_labor_rules(_location_id));
$$;

REVOKE EXECUTE ON FUNCTION public._shift_flags_with_rules(uuid, date, date, jsonb) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public._shift_flags(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._shift_flags_with_rules(uuid, date, date, jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public._shift_flags(uuid, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.shift_flags(_location_id uuid, _start date, _end date)
RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_out_punch_id uuid,
              clock_in timestamptz, clock_out timestamptz, paid_min int, flags text[], details jsonb)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL OR _location_id IS NULL
     OR NOT public.has_role_or_higher(v_uid, 'manager')
     OR NOT public.has_location_access(v_uid, _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT * FROM public._shift_flags(_location_id, _start, _end);
END $$;
REVOKE EXECUTE ON FUNCTION public.shift_flags(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_flags(uuid, date, date) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._can_manage_labor_rules(_user uuid, _location_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT _user IS NOT NULL AND (public.is_super_admin(_user) OR EXISTS (
    SELECT 1 FROM public.locations l WHERE l.id = _location_id
       AND (public.is_org_admin(_user, l.organization_id)
            OR (public.has_role(_user, 'admin'::app_role) AND public.is_org_member(_user, l.organization_id)))));
$$;
REVOKE EXECUTE ON FUNCTION public._can_manage_labor_rules(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._can_manage_labor_rules(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_shift_flags(_location_id uuid, _start date, _end date, _rules jsonb)
RETURNS TABLE(flag text, n int)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF NOT public._can_manage_labor_rules(v_uid, _location_id)
     OR NOT public.has_location_access(v_uid, _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
    SELECT f AS flag, count(*)::int AS n
      FROM public._shift_flags_with_rules(_location_id, _start, _end,
             public.effective_labor_rules(_location_id) || coalesce(_rules, '{}'::jsonb)) s
      CROSS JOIN LATERAL unnest(s.flags) f
     GROUP BY f ORDER BY f;
END $$;
REVOKE EXECUTE ON FUNCTION public.preview_shift_flags(uuid, date, date, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.preview_shift_flags(uuid, date, date, jsonb) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public._pay_period_open_issues(_start date, _end date, _user uuid)
 RETURNS TABLE(location_id uuid, location_name text, user_id uuid, user_name text, business_date date, clock_in_punch_id uuid, clock_in timestamp with time zone, kind text, blocking boolean)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE v_loc record; v_d date; v_today date;
BEGIN
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  FOR v_loc IN
    SELECT l.id, l.name FROM public.locations l
     WHERE public.labor_source_for(l.id) = 'punch_clock'
       AND (_user IS NULL OR public.has_location_access(_user, l.id))
       AND EXISTS (
         SELECT 1 FROM public.time_punches tp
          WHERE tp.location_id = l.id
            AND tp.punch_time >= (SELECT w.start_at FROM public.business_day_window(l.id, _start) w)
            AND tp.punch_time <  (SELECT w.end_at FROM public.business_day_window(l.id, _end) w))
  LOOP
    v_today := public.business_date(v_loc.id);
    FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
      RETURN QUERY
        SELECT v_loc.id, v_loc.name, s.user_id, pr.full_name, s.business_date, s.clock_in_punch_id, s.clock_in,
               CASE WHEN s.missing_clock_out THEN 'missing_clock_out' ELSE 'auto_clock_out_unreviewed' END,
               s.missing_clock_out
          FROM public._labor_pair_shifts(v_loc.id, v_d, v_d = v_today, true) s
          LEFT JOIN public.profiles pr ON pr.id = s.user_id
          LEFT JOIN public.time_punches co ON co.id = s.clock_out_punch_id
         WHERE (s.missing_clock_out
                AND NOT EXISTS (SELECT 1 FROM public.labor_shift_resolutions r
                                 WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'zero'))
            OR (NOT s.missing_clock_out AND coalesce(co.is_auto_punched_out, false)
                AND NOT EXISTS (SELECT 1 FROM public.labor_shift_resolutions r
                                 WHERE r.clock_in_punch_id = s.clock_in_punch_id AND r.resolution = 'auto_reviewed'));
    END LOOP;
    RETURN QUERY
      SELECT v_loc.id, v_loc.name, f.user_id, pr.full_name, f.business_date, f.clock_in_punch_id, f.clock_in,
             fl, false
        FROM public._shift_flags(v_loc.id, _start, _end) f
        CROSS JOIN LATERAL unnest(f.flags) fl
        LEFT JOIN public.profiles pr ON pr.id = f.user_id
       WHERE fl IN ('no_meal_break','second_meal_missing','meal_late','long_break','open_break');
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.save_labor_rules(_location_id uuid, _patch jsonb, _source text,
  _proposal_id uuid DEFAULT NULL, _note text DEFAULT NULL)
RETURNS public.labor_rules
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_old public.labor_rules; v_new public.labor_rules; v_res public.labor_rules;
  v_created boolean := false; k text; v_set text := ''; v_fs jsonb; v_oj jsonb; v_nj jsonb;
  v_bad text[] := ARRAY['id','location_id','created_at','unpaid_break_min_minutes','duplicate_tap_minutes',
                        'max_open_shift_hours','auto_clock_out_after_close_min','field_sources'];
BEGIN
  IF _location_id IS NULL OR (coalesce(auth.role(), '') <> 'service_role'
     AND NOT public._can_manage_labor_rules(v_uid, _location_id)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _source IS NULL OR _source NOT IN ('manual','preset','migration','ai') THEN
    RAISE EXCEPTION 'invalid source' USING ERRCODE = '22023';
  END IF;
  IF _patch IS NULL OR jsonb_typeof(_patch) <> 'object' THEN
    RAISE EXCEPTION 'invalid patch' USING ERRCODE = '22023';
  END IF;
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF k = ANY (v_bad) THEN RAISE EXCEPTION 'field not editable: %', k USING ERRCODE = '22023'; END IF;
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                    AND c.table_name = 'labor_rules' AND c.column_name = k) THEN
      RAISE EXCEPTION 'unknown field: %', k USING ERRCODE = '22023';
    END IF;
  END LOOP;

  SELECT * INTO v_old FROM public.labor_rules lr WHERE lr.location_id = _location_id FOR UPDATE;
  IF NOT FOUND THEN
    INSERT INTO public.labor_rules (location_id, rule_name)
    VALUES (_location_id, coalesce(nullif(_patch->>'rule_name', ''), 'Labor Rules'))
    ON CONFLICT (location_id) DO NOTHING;
    SELECT * INTO v_old FROM public.labor_rules lr WHERE lr.location_id = _location_id FOR UPDATE;
    v_created := true;
  END IF;

  v_new := jsonb_populate_record(v_old, _patch);

  IF v_new.meal_break_hours IS NOT NULL AND (v_new.meal_break_hours < 0 OR v_new.meal_break_hours > 12) THEN
    RAISE EXCEPTION 'meal_break_hours must be 0-12' USING ERRCODE = '22023'; END IF;
  IF v_new.meal_break_duration IS NOT NULL AND (v_new.meal_break_duration < 10 OR v_new.meal_break_duration > 60) THEN
    RAISE EXCEPTION 'meal_break_duration must be 10-60' USING ERRCODE = '22023'; END IF;
  IF coalesce(v_new.daily_overtime_threshold, 0) > 0 AND coalesce(v_new.daily_double_time_threshold, 0) > 0
     AND v_new.daily_double_time_threshold <= v_new.daily_overtime_threshold THEN
    RAISE EXCEPTION 'daily_double_time_threshold must be above daily_overtime_threshold' USING ERRCODE = '22023'; END IF;
  IF v_new.meal_waiver_max_hours IS NOT NULL AND v_new.meal_break_hours IS NOT NULL
     AND v_new.meal_waiver_max_hours < v_new.meal_break_hours THEN
    RAISE EXCEPTION 'meal_waiver_max_hours must be >= meal_break_hours' USING ERRCODE = '22023'; END IF;
  IF v_new.meal_deadline_hours IS NOT NULL AND v_new.meal_break_hours IS NOT NULL
     AND v_new.meal_deadline_hours > v_new.meal_break_hours THEN
    RAISE EXCEPTION 'meal_deadline_hours must be <= meal_break_hours' USING ERRCODE = '22023'; END IF;
  IF (v_new.overtime_multiplier IS NOT NULL AND (v_new.overtime_multiplier < 1 OR v_new.overtime_multiplier > 3))
     OR (v_new.double_time_multiplier IS NOT NULL AND (v_new.double_time_multiplier < 1 OR v_new.double_time_multiplier > 3)) THEN
    RAISE EXCEPTION 'multipliers must be 1-3' USING ERRCODE = '22023'; END IF;

  v_oj := to_jsonb(v_old); v_nj := to_jsonb(v_new);
  v_fs := coalesce(v_old.field_sources, '{}'::jsonb);
  FOR k IN SELECT jsonb_object_keys(_patch) LOOP
    IF (v_oj->k) IS DISTINCT FROM (v_nj->k) OR v_created THEN
      v_set := v_set || format('%I = ($1).%I, ', k, k);
      v_fs := v_fs || jsonb_build_object(k, jsonb_build_object('source', _source, 'at', now(), 'by', v_uid, 'proposal_id', _proposal_id));
    END IF;
  END LOOP;

  v_set := v_set || 'field_sources = $2, updated_at = now()';
  IF _source = 'manual' THEN v_set := v_set || ', rules_reviewed_at = now(), rules_reviewed_by = $3'; END IF;
  EXECUTE format('UPDATE public.labor_rules SET %s WHERE id = $4 RETURNING *', v_set)
    INTO v_res USING v_new, v_fs, v_uid, v_old.id;

  INSERT INTO public.labor_rules_history (location_id, changed_by, source, proposal_id, before, after, note)
  VALUES (_location_id, v_uid, _source, _proposal_id, CASE WHEN v_created THEN NULL ELSE v_oj END, to_jsonb(v_res), _note);
  RETURN v_res;
END $$;
REVOKE EXECUTE ON FUNCTION public.save_labor_rules(uuid, jsonb, text, uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.save_labor_rules(uuid, jsonb, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.seed_labor_rules_from_preset(_location_id uuid)
RETURNS public.labor_rules
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.labor_rules; v_st text; v_p jsonb; v_patch jsonb;
BEGIN
  IF NOT public._can_manage_labor_rules(v_uid, _location_id)
     AND coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_row FROM public.labor_rules lr WHERE lr.location_id = _location_id;
  IF FOUND THEN RETURN v_row; END IF;
  SELECT d.state_code INTO v_st FROM public.locations l
    CROSS JOIN LATERAL public.derive_store_region(l.address) d WHERE l.id = _location_id;
  SELECT to_jsonb(p) INTO v_p FROM public.labor_rule_presets p
   WHERE p.is_system AND p.state_code = v_st ORDER BY p.created_at LIMIT 1;
  IF v_p IS NULL THEN
    SELECT to_jsonb(p) INTO v_p FROM public.labor_rule_presets p WHERE p.preset_name = 'Federal Default' ORDER BY p.created_at LIMIT 1;
  END IF;
  IF v_p IS NULL THEN RAISE EXCEPTION 'no preset available' USING ERRCODE = 'P0002'; END IF;
  SELECT coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb) INTO v_patch
    FROM jsonb_each(v_p) e
   WHERE e.key NOT IN ('id','created_at','updated_at','preset_name','is_system')
     AND EXISTS (SELECT 1 FROM information_schema.columns c WHERE c.table_schema = 'public'
                  AND c.table_name = 'labor_rules' AND c.column_name = e.key);
  v_patch := v_patch || jsonb_build_object('rule_name', v_p->>'preset_name');
  RETURN public.save_labor_rules(_location_id, v_patch, 'preset', NULL, 'Seeded from preset ' || (v_p->>'preset_name'));
END $$;
REVOKE EXECUTE ON FUNCTION public.seed_labor_rules_from_preset(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_labor_rules_from_preset(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.trg_location_region()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_st text; v_tz text; v_cur text;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.address IS NOT DISTINCT FROM OLD.address THEN RETURN NEW; END IF;
  SELECT d.state_code, d.timezone INTO v_st, v_tz FROM public.derive_store_region(NEW.address) d;
  IF v_st IS NULL THEN
    INSERT INTO public.location_timezone_pending(location_id, kind, address)
    VALUES (NEW.id, 'parse_failed', NEW.address);
    RETURN NEW;
  END IF;

  UPDATE public.labor_rules lr SET state_code = v_st
   WHERE lr.location_id = NEW.id AND lr.state_code IS DISTINCT FROM v_st;
  UPDATE public.labor_rules lr SET
         meal_break_hours        = coalesce(lr.meal_break_hours, p.meal_break_hours),
         meal_break_duration     = coalesce(lr.meal_break_duration, p.meal_break_duration),
         rest_break_hours        = coalesce(lr.rest_break_hours, p.rest_break_hours),
         rest_break_duration     = coalesce(lr.rest_break_duration, p.rest_break_duration),
         second_meal_break_hours = coalesce(lr.second_meal_break_hours, p.second_meal_break_hours),
         meal_deadline_hours     = coalesce(lr.meal_deadline_hours, p.meal_deadline_hours)
    FROM (SELECT * FROM public.labor_rule_presets pp WHERE pp.is_system AND pp.state_code = v_st
           ORDER BY pp.created_at LIMIT 1) p
   WHERE lr.location_id = NEW.id
     AND (lr.meal_break_hours IS NULL OR lr.meal_break_duration IS NULL OR lr.rest_break_hours IS NULL
          OR lr.rest_break_duration IS NULL OR lr.second_meal_break_hours IS NULL OR lr.meal_deadline_hours IS NULL);

  SELECT ls.timezone INTO v_cur FROM public.location_settings ls WHERE ls.location_id = NEW.id;
  IF NOT FOUND OR v_cur IS NOT DISTINCT FROM v_tz OR public._tz_valid_for_state(v_st, v_cur) THEN
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.punch_clock_devices d WHERE d.location_id = NEW.id AND d.revoked_at IS NULL) THEN
    INSERT INTO public.location_timezone_pending(location_id, kind, address, derived_state, current_tz, proposed_tz)
    SELECT NEW.id, 'timezone_change', NEW.address, v_st, v_cur, v_tz
     WHERE NOT EXISTS (SELECT 1 FROM public.location_timezone_pending p
                        WHERE p.location_id = NEW.id AND p.status = 'pending' AND p.proposed_tz = v_tz);
  ELSE
    UPDATE public.location_settings SET timezone = v_tz WHERE location_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.effective_labor_rules(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.effective_labor_rules(uuid) TO authenticated, service_role;

COMMENT ON FUNCTION public.labor_shifts(uuid, date, date) IS
  'Column meal_break_missing is DEPRECATED: the UI uses public.shift_flags (no_meal_break) instead. Hours/cost unchanged.';