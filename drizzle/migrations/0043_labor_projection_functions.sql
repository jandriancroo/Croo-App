-- Labor projection (labor pace): additive only. No existing labor function is changed.

-- 1) Server copy of the Dash's today-pace formula (cubeMetrics.computePace). Pure.
CREATE OR REPLACE FUNCTION public._pace_num(_v jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN _v IS NULL THEN 0
    WHEN jsonb_typeof(_v) = 'number' THEN (_v #>> '{}')::numeric
    WHEN jsonb_typeof(_v) = 'string' AND btrim(_v #>> '{}') ~ '^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$' THEN btrim(_v #>> '{}')::numeric
    ELSE 0 END
$$;

CREATE OR REPLACE FUNCTION public._pace_hour(_e jsonb)
RETURNS int LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT nullif(substring(split_part(coalesce(_e->>'hour', ''), ':', 1) FROM '^\s*([+-]?\d+)'), '')::int
$$;

CREATE OR REPLACE FUNCTION public.sales_pace_today(
  _hourly jsonb, _net_sales numeric, _stored numeric, _stored_at timestamptz,
  _cur_h int, _cur_m int, _now timestamptz DEFAULT now())
RETURNS numeric LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
DECLARE
  e jsonb; h int; a numeric; p numeric; v_sales numeric := coalesce(_net_sales, 0);
  l_sum numeric := 0; l_n int := 0; d_sum numeric := 0; d_n int := 0;
  v_active numeric; v_factor numeric; v_sum numeric := 0;
BEGIN
  IF _hourly IS NULL OR jsonb_typeof(_hourly) <> 'array' OR jsonb_array_length(_hourly) = 0 THEN RETURN NULL; END IF;
  IF coalesce(_stored, 0) > 0 AND _stored_at IS NOT NULL AND _now - _stored_at < interval '15 minutes' THEN
    RETURN greatest(_stored, v_sales);
  END IF;
  FOR e IN SELECT x FROM jsonb_array_elements(_hourly) x LOOP
    h := public._pace_hour(e); CONTINUE WHEN h IS NULL;
    a := public._pace_num(e->'sales'); p := public._pace_num(e->'projected');
    CONTINUE WHEN p <= 0;
    CONTINUE WHEN NOT ((h < _cur_h AND a > 0) OR (h = _cur_h AND _cur_m >= 30 AND a > 0));
    IF h < 15 THEN l_sum := l_sum + (a - p) / p; l_n := l_n + 1;
    ELSE d_sum := d_sum + (a - p) / p; d_n := d_n + 1; END IF;
  END LOOP;
  IF _cur_h >= 15 THEN
    IF d_n >= 3 THEN v_active := d_sum / d_n;
    ELSIF l_n >= 3 THEN v_active := (l_sum / l_n) * 0.5; END IF;
  ELSIF l_n >= 3 THEN v_active := l_sum / l_n;
  END IF;
  v_factor := CASE WHEN v_active IS NULL THEN 1
    ELSE 1 + v_active + CASE WHEN v_active > 0 THEN 0.03 * least(v_active / 0.5, 1) ELSE 0 END END;
  FOR e IN SELECT x FROM jsonb_array_elements(_hourly) x LOOP
    h := public._pace_hour(e); CONTINUE WHEN h IS NULL;
    a := public._pace_num(e->'sales'); p := public._pace_num(e->'projected');
    IF h < _cur_h THEN v_sum := v_sum + a;
    ELSIF h = _cur_h THEN
      v_sum := v_sum + CASE WHEN _cur_m < 30 THEN p * v_factor ELSE a + p * ((60 - _cur_m)::numeric / 60) * v_factor END;
    ELSE v_sum := v_sum + p * v_factor; END IF;
  END LOOP;
  RETURN CASE WHEN v_sum > 0 THEN greatest(v_sum, v_sales) ELSE NULL END;
END $$;

-- 2) One scheduled shift: remaining seconds and state. Pure (owner rules).
CREATE OR REPLACE FUNCTION public._lp_shift_eval(
  _s_start timestamptz, _s_end timestamptz, _npairs int, _open boolean,
  _first_in timestamptz, _last_out timestamptz, _now timestamptz, _src text, _schedule_only boolean,
  OUT remaining_sec numeric, OUT state text, OUT late_minutes int, OUT early_out_minutes int)
LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  late_minutes := 0; early_out_minutes := 0;
  IF _schedule_only THEN
    remaining_sec := greatest(extract(epoch FROM _s_end - _s_start), 0); state := 'scheduled'; RETURN;
  END IF;
  IF _src IS DISTINCT FROM 'punch_clock' AND _src IS DISTINCT FROM 'toast' THEN
    -- POS labor total covers the past; only the rest of the shift from now is added.
    remaining_sec := greatest(extract(epoch FROM _s_end - greatest(_s_start, _now)), 0);
    state := CASE WHEN _now < _s_start THEN 'not_started' WHEN _now >= _s_end THEN 'done' ELSE 'working' END;
    RETURN;
  END IF;
  IF coalesce(_npairs, 0) > 0 THEN
    late_minutes := greatest(floor(extract(epoch FROM _first_in - _s_start) / 60), 0)::int;
    IF coalesce(_open, false) THEN
      remaining_sec := greatest(extract(epoch FROM _s_end - _now), 0);
      state := CASE WHEN _now > _s_end THEN 'over_schedule' ELSE 'working' END;
    ELSE
      remaining_sec := 0; state := 'done';
      IF _last_out IS NOT NULL AND _last_out < _s_end THEN
        early_out_minutes := floor(extract(epoch FROM _s_end - _last_out) / 60)::int;
      END IF;
    END IF;
    RETURN;
  END IF;
  -- Not clocked in: count the full scheduled shift (owner rule), never zero.
  remaining_sec := greatest(extract(epoch FROM _s_end - _s_start), 0);
  state := CASE WHEN _now < _s_start THEN 'not_started' ELSE 'late_not_in' END;
END $$;

-- 3) Clocked in with no scheduled shift: end of the closest shift template that day.
CREATE OR REPLACE FUNCTION public._lp_template_end(_location_id uuid, _date date, _clock_in timestamptz, _tz text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT ((_date + st.end_time) + CASE WHEN st.end_time <= st.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE _tz
    FROM public.shift_templates st
   WHERE st.location_id = _location_id
     AND (st.days_of_week IS NULL OR cardinality(st.days_of_week) = 0
          OR extract(dow FROM _date)::int = ANY (st.days_of_week))
   ORDER BY abs(extract(epoch FROM ((_date + st.start_time) AT TIME ZONE _tz) - _clock_in)), st.start_time, st.id
   LIMIT 1
$$;

-- 4) Punch pairs for the day, read-only from the existing sources.
CREATE OR REPLACE FUNCTION public._lp_pairs(_location_id uuid, _date date, _src text)
RETURNS TABLE(user_id uuid, clock_in timestamptz, clock_out timestamptz, is_open boolean,
              shift_id uuid, est_end timestamptz, on_break boolean, worked_sec numeric)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
#variable_conflict use_column
BEGIN
  IF _src = 'punch_clock' THEN
    RETURN QUERY
      SELECT p.user_id, p.clock_in, CASE WHEN p.open_shift_live THEN NULL ELSE p.clock_out END,
             coalesce(p.open_shift_live, false), tp.shift_id, p.estimated_end,
             coalesce(p.open_shift_live AND lb.punch_type = 'break_start', false),
             greatest(coalesce(p.worked_sec, 0) - coalesce(p.unpaid_sec, 0), 0)
        FROM public._labor_pair_shifts(_location_id, _date, true) p
        LEFT JOIN public.time_punches tp ON tp.id = p.clock_in_punch_id
        LEFT JOIN LATERAL (
          SELECT t.punch_type FROM public.time_punches t
           WHERE t.user_id = p.user_id AND t.location_id = _location_id
             AND t.punch_time >= p.clock_in AND t.punch_time <= now()
           ORDER BY t.punch_time DESC LIMIT 1) lb ON true;
  ELSIF _src = 'toast' THEN
    RETURN QUERY
      SELECT ts.croo_user_id, ts.in_time, ts.out_time, ts.out_time IS NULL, ts.croo_scheduled_shift_id,
             ts.in_time + interval '8 hours', false,
             coalesce(ts.payable_seconds::numeric,
                      greatest(extract(epoch FROM coalesce(ts.out_time, now()) - ts.in_time) - coalesce(ts.unpaid_break_seconds, 0), 0))
        FROM public.toast_shifts ts
       WHERE ts.location_id = _location_id AND ts.shift_date = _date
         AND ts.croo_user_id IS NOT NULL AND ts.in_time IS NOT NULL;
  END IF;
END $$;

-- 5) The shared data point.
CREATE OR REPLACE FUNCTION public.get_labor_projection(_location_id uuid, _date date DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_svc boolean := coalesce(auth.role(), '') = 'service_role';
  v_mgr boolean; v_tm boolean; v_dev boolean;
  v_now timestamptz := now();
  v_today date; v_date date; v_tz text; v_src text; v_mode text := 'live';
  v_sched_only boolean := false; v_asof timestamptz; v_ws timestamptz; v_we timestamptz;
  v_wh numeric; v_wc numeric; t record;
  v_sales record; v_goal numeric; v_pace numeric; v_psales numeric; v_psrc text; v_local timestamp;
  v_g jsonb; v_d jsonb; v_target numeric; v_pc numeric; v_pct numeric; v_status text;
BEGIN
  IF _location_id IS NULL THEN RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023'; END IF;
  v_mgr := coalesce(v_uid IS NOT NULL AND public.has_role_or_higher(v_uid, 'shift_manager')
             AND (public.is_super_admin(v_uid) OR public.has_location_access(v_uid, _location_id)
                  OR public.has_brand_access_via_location(v_uid, _location_id)), false);
  v_tm := NOT v_mgr AND coalesce(v_uid IS NOT NULL AND public.has_role_or_higher(v_uid, 'team_member')
             AND public.has_location_access(v_uid, _location_id)
             AND public._org_role_permission_enabled(_location_id, 'team_member', 'view_sales'), false);
  v_dev := coalesce(v_uid IS NOT NULL AND public.punch_device_location(v_uid) = _location_id, false);
  IF NOT (v_svc OR v_mgr OR v_tm OR v_dev) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;

  v_today := public.business_date(_location_id);
  v_date := coalesce(_date, v_today);
  IF NOT (v_svc OR v_mgr) AND v_date <> v_today THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  v_src := public.labor_source_for(_location_id);

  IF v_date < public.labor_new_rule_start() OR v_date < v_today
     OR _location_id = '5ce2f74e-7292-4ccd-84c1-7b8b28e4bc0d'::uuid THEN  -- Virginia St
    RETURN jsonb_build_object('location_id', _location_id, 'business_date', v_date, 'source', v_src,
                              'timezone', v_tz, 'mode', 'unavailable');
  END IF;

  SELECT w.start_at, w.end_at INTO v_ws, v_we FROM public.business_day_window(_location_id, v_date) w;

  -- Worked so far: exactly what get_store_labor returns today.
  IF v_date > v_today THEN
    v_sched_only := true; v_mode := 'schedule_only';
  ELSIF v_src = 'punch_clock' THEN
    SELECT x.hours, x.cost INTO v_wh, v_wc FROM public.labor_day_totals(_location_id, v_date, true) x;
    v_asof := v_now;
  ELSE
    SELECT l.labor_hours, l.labor_cost, l.fetched_at INTO v_wh, v_wc, v_asof
      FROM public.labor_cache l
     WHERE l.location_id = _location_id AND l.labor_date = v_date AND l.source = v_src;
    IF v_asof IS NULL OR v_now - v_asof > interval '30 minutes' THEN
      v_sched_only := true; v_mode := 'schedule_only';
    END IF;
  END IF;

  WITH sh AS (
    SELECT ss.id, ss.user_id,
           greatest((v_date + ss.start_time) AT TIME ZONE v_tz, v_ws) AS s_start,
           least(((v_date + ss.end_time) + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_tz, v_we) AS s_end
      FROM public.scheduled_shifts ss
      JOIN public.schedules s ON s.id = ss.schedule_id AND s.location_id = _location_id
     WHERE ss.shift_date = v_date AND ss.user_id IS NOT NULL
       AND NOT coalesce(ss.is_time_off, false) AND NOT coalesce(ss.is_phantom, false)
       AND NOT coalesce(ss.is_coverage_only, false)
       AND ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL
  ),
  pr AS (
    SELECT * FROM public._lp_pairs(_location_id, v_date, CASE WHEN v_sched_only THEN NULL ELSE v_src END)
  ),
  mp AS (
    SELECT pr.*, m.id AS sid
      FROM pr LEFT JOIN LATERAL (
        SELECT sh.id FROM sh
         WHERE sh.user_id = pr.user_id
           AND (sh.id = pr.shift_id
                OR ((pr.shift_id IS NULL OR NOT EXISTS (SELECT 1 FROM sh s2 WHERE s2.id = pr.shift_id))
                    AND tstzrange(pr.clock_in, coalesce(pr.clock_out, v_now)) && tstzrange(sh.s_start, sh.s_end)))
         ORDER BY (sh.id = pr.shift_id) DESC NULLS LAST, abs(extract(epoch FROM sh.s_start - pr.clock_in)) LIMIT 1) m ON true
  ),
  se AS (
    SELECT sh.id, sh.user_id, sh.s_start, sh.s_end, ev.remaining_sec, ev.state, ev.late_minutes, ev.early_out_minutes,
           agg.on_break, agg.first_in, agg.last_out
      FROM sh
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS npairs, bool_or(mp.is_open) AS open_any, bool_or(mp.on_break) AS on_break,
               min(mp.clock_in) AS first_in, max(mp.clock_out) FILTER (WHERE NOT mp.is_open) AS last_out
          FROM mp WHERE mp.sid = sh.id) agg
      CROSS JOIN LATERAL public._lp_shift_eval(sh.s_start, sh.s_end, agg.npairs, agg.open_any, agg.first_in,
                                               agg.last_out, v_now, v_src, v_sched_only) ev
  ),
  un AS (
    SELECT mp.user_id, mp.clock_in, mp.on_break, te.e AS t_end, mp.est_end
      FROM mp CROSS JOIN LATERAL (SELECT public._lp_template_end(_location_id, v_date, mp.clock_in, v_tz) AS e) te
     WHERE mp.sid IS NULL AND mp.is_open
  ),
  items AS (
    SELECT se.user_id, se.s_start AS sched_start, se.s_end AS sched_end, se.first_in AS actual_in, se.last_out AS actual_out,
           se.remaining_sec, se.state, se.late_minutes, se.early_out_minutes, coalesce(se.on_break, false) AS on_break,
           NULL::boolean AS from_template
      FROM se
    UNION ALL
    SELECT un.user_id, NULL::timestamptz, least(coalesce(un.t_end, un.est_end), v_we), un.clock_in, NULL::timestamptz,
           greatest(extract(epoch FROM least(coalesce(un.t_end, un.est_end), v_we) - v_now), 0), 'unscheduled', 0, 0,
           un.on_break, un.t_end IS NOT NULL
      FROM un
  ),
  wk AS (
    SELECT u.user_id, u.paid_hours, u.wage FROM public.labor_day_user_totals(_location_id, v_date, true) u
     WHERE v_src = 'punch_clock' AND NOT v_sched_only
    UNION ALL
    SELECT pr.user_id, sum(pr.worked_sec) / 3600, NULL::numeric FROM pr WHERE v_src = 'toast' GROUP BY pr.user_id
  ),
  ppl AS (
    SELECT x.user_id FROM items x UNION SELECT wk.user_id FROM wk
  ),
  per AS (
    SELECT p.user_id,
           coalesce(nullif(pf.nickname, ''), pf.full_name) AS name,
           coalesce(wk.paid_hours, 0) AS worked_h,
           coalesce((SELECT sum(i.remaining_sec) FROM items i WHERE i.user_id = p.user_id), 0) / 3600 AS rem_h,
           coalesce(wk.wage,
             (SELECT wh.hourly_wage FROM public.wage_history wh
               WHERE wh.user_id = p.user_id AND wh.effective_date <= v_date AND wh.hourly_wage IS NOT NULL
               ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
             pf.hourly_wage) AS wage,
           (SELECT jsonb_agg(jsonb_build_object(
                     'scheduled_start', i.sched_start, 'scheduled_end', i.sched_end,
                     'actual_in', i.actual_in, 'actual_out', i.actual_out, 'state', i.state,
                     'late_minutes', i.late_minutes, 'early_out_minutes', i.early_out_minutes,
                     'remaining_hours', round(i.remaining_sec / 3600, 2), 'on_break', i.on_break,
                     'end_from_template', i.from_template)
                   ORDER BY coalesce(i.sched_start, i.actual_in))
              FROM items i WHERE i.user_id = p.user_id) AS shifts,
           (SELECT i.state FROM items i WHERE i.user_id = p.user_id
             ORDER BY array_position(ARRAY['over_schedule','working','unscheduled','late_not_in','not_started','scheduled','done'], i.state)
             LIMIT 1) AS state,
           coalesce((SELECT bool_or(i.on_break) FROM items i WHERE i.user_id = p.user_id), false) AS on_break
      FROM ppl p
      LEFT JOIN wk ON wk.user_id = p.user_id
      LEFT JOIN public.profiles pf ON pf.id = p.user_id
  )
  SELECT
    coalesce(sum(per.rem_h), 0) AS rem_h,
    coalesce(sum(per.rem_h * per.wage), 0) AS rem_c,
    (count(*) FILTER (WHERE per.wage IS NULL AND (per.worked_h + per.rem_h) > 0))::int AS wage_missing,
    (SELECT count(*) FROM items WHERE state = 'unscheduled')::int AS unscheduled,
    (SELECT count(*) FROM items WHERE state = 'late_not_in')::int AS late_not_in,
    (SELECT count(*) FROM items WHERE state = 'over_schedule')::int AS over_schedule,
    (SELECT count(*) FROM items WHERE on_break)::int AS on_break,
    coalesce((SELECT sum(late_minutes) FROM items), 0)::int AS late_min,
    coalesce((SELECT sum(early_out_minutes) FROM items), 0)::int AS early_min,
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', per.user_id, 'name', per.name, 'state', per.state, 'on_break', per.on_break,
      'worked_hours', round(per.worked_h, 2), 'remaining_hours', round(per.rem_h, 2),
      'wage_missing', per.wage IS NULL, 'shifts', coalesce(per.shifts, '[]'::jsonb))
      ORDER BY per.name) FILTER (WHERE per.user_id IS NOT NULL), '[]'::jsonb) AS people
  INTO t FROM per;

  SELECT sc.* INTO v_sales FROM public.sales_cache sc
   WHERE sc.location_id = _location_id AND sc.sale_date = v_date
   ORDER BY sc.fetched_at DESC NULLS LAST LIMIT 1;
  v_goal := public._resolve_goal(_location_id, v_date);
  IF v_date = v_today AND v_sales.id IS NOT NULL THEN
    v_local := v_now AT TIME ZONE v_tz;
    v_pace := public.sales_pace_today(v_sales.hourly_data, v_sales.net_sales, v_sales.pace_adjusted_projection,
                                      v_sales.pace_calculated_at, extract(hour FROM v_local)::int,
                                      extract(minute FROM v_local)::int, v_now);
  END IF;
  IF coalesce(v_pace, 0) > 0 THEN
    v_psales := greatest(v_pace, coalesce(v_sales.net_sales, 0)); v_psrc := 'pace';
  ELSIF coalesce(v_goal, 0) > 0 THEN
    v_psales := v_goal; v_psrc := 'goal';
  END IF;

  v_g := public._labor_goals_resolve(_location_id);
  v_d := v_g->'days'->((extract(isodow FROM v_date)::int - 1)::text);
  IF v_d = 'null'::jsonb THEN v_d := NULL; END IF;
  v_target := (coalesce(v_d, v_g->'weekly') #>> '{}')::numeric;

  v_pc := CASE WHEN v_sched_only THEN 0 ELSE coalesce(v_wc, 0) END + t.rem_c;
  v_pct := CASE WHEN coalesce(v_psales, 0) > 0 THEN v_pc / v_psales * 100 END;
  v_status := CASE WHEN v_pct IS NULL OR v_target IS NULL THEN NULL
                   WHEN v_pct < v_target - 0.5 THEN 'ahead'
                   WHEN v_pct > v_target + 0.5 THEN 'behind'
                   ELSE 'on_track' END;

  RETURN jsonb_build_object(
    'location_id', _location_id, 'business_date', v_date, 'source', v_src, 'timezone', v_tz,
    'mode', v_mode, 'as_of', v_asof, 'computed_at', v_now,
    'worked_hours', CASE WHEN v_sched_only THEN NULL ELSE v_wh END,
    'worked_labor_dollars', CASE WHEN v_sched_only THEN NULL ELSE v_wc END,
    'remaining_scheduled_hours', round(t.rem_h, 2),
    'remaining_labor_dollars', round(t.rem_c, 2),
    'projected_hours', round(CASE WHEN v_sched_only THEN 0 ELSE coalesce(v_wh, 0) END + t.rem_h, 2),
    'projected_labor_dollars', round(v_pc, 2),
    'projected_sales', round(v_psales, 2), 'projected_sales_source', v_psrc,
    'projected_labor_pct', round(v_pct, 2),
    'target_labor_pct', v_target,
    'target_labor_dollars', CASE WHEN v_target IS NOT NULL AND v_psales > 0 THEN round(v_target * v_psales / 100, 2) END,
    'variance_pct', CASE WHEN v_pct IS NOT NULL AND v_target IS NOT NULL THEN round(v_pct - v_target, 2) END,
    'status', v_status,
    'wage_missing_count', t.wage_missing, 'unscheduled_count', t.unscheduled,
    'late_not_in_count', t.late_not_in, 'over_schedule_count', t.over_schedule, 'on_break_count', t.on_break,
    'late_minutes', t.late_min, 'early_out_minutes', t.early_min,
    'people', CASE WHEN v_svc OR v_mgr THEN t.people ELSE '[]'::jsonb END);
END $$;

REVOKE ALL ON FUNCTION public._lp_template_end(uuid, date, timestamptz, text) FROM public, anon, authenticated;
REVOKE ALL ON FUNCTION public._lp_pairs(uuid, date, text) FROM public, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._lp_template_end(uuid, date, timestamptz, text) TO service_role;
GRANT EXECUTE ON FUNCTION public._lp_pairs(uuid, date, text) TO service_role;
REVOKE ALL ON FUNCTION public.get_labor_projection(uuid, date) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_labor_projection(uuid, date) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.sales_pace_today(jsonb, numeric, numeric, timestamptz, int, int, timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._lp_shift_eval(timestamptz, timestamptz, int, boolean, timestamptz, timestamptz, timestamptz, text, boolean) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pace_num(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public._pace_hour(jsonb) TO authenticated, service_role;