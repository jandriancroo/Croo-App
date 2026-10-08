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
      'estimated_end', c.estimated_end,
      'ot', round(c.s_ot, 4), 'dt', round(c.s_dt, 4),
      'short_meal_min', CASE WHEN c.longest IS NOT NULL THEN round(c.longest, 1) END)
  FROM c
  ORDER BY c.business_date, c.clock_in;
END $$;