-- Fix predict ordering (position avg must be read before the sum) and wire the position layer
-- into _labor_pace_core. Still gated by use_position (default off).

CREATE OR REPLACE FUNCTION public._labor_close_predict_min(_location_id uuid, _user_id uuid, _dow int, _band text,
  _position text DEFAULT NULL, _as_of date DEFAULT NULL, _use_position boolean DEFAULT false)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v numeric; v_pos numeric := 0;
BEGIN
  IF _use_position AND _position IS NOT NULL THEN
    IF _as_of IS NULL THEN
      SELECT coalesce(h.avg_minutes, 0) * h.trust INTO v_pos FROM public.labor_close_habits h
       WHERE h.location_id = _location_id AND h.scope = 'position' AND h.key = _position;
    ELSE
      SELECT coalesce(h.avg_minutes, 0) * h.trust INTO v_pos FROM public._labor_close_habits_compute(_location_id, _as_of) h
       WHERE h.scope = 'position' AND h.key = _position;
    END IF;
    v_pos := coalesce(v_pos, 0);
  END IF;
  IF _as_of IS NULL THEN
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes
                              WHEN h.scope = 'person' AND _use_position THEN (h.avg_minutes - v_pos) * h.trust
                              ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public.labor_close_habits h
     WHERE h.location_id = _location_id
       AND ((h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
            OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text)
            OR (_use_position AND h.scope = 'position' AND h.key = _position));
  ELSE
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes
                              WHEN h.scope = 'person' AND _use_position THEN (h.avg_minutes - v_pos) * h.trust
                              ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public._labor_close_habits_compute(_location_id, _as_of) h
     WHERE (h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
        OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text)
        OR (_use_position AND h.scope = 'position' AND h.key = _position);
  END IF;
  RETURN v;
END $$;

REVOKE ALL ON FUNCTION public._labor_close_predict_min(uuid, uuid, int, text, date) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._labor_close_predict_min(uuid, uuid, int, text, text, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_close_predict_min(uuid, uuid, int, text, text, date, boolean) TO service_role;

-- Pace core: optional 4th arg _position (NULL = store setting). Adds shift position to the smart branch.
CREATE OR REPLACE FUNCTION public._labor_pace_core(_location_id uuid, _date date, _smart boolean, _position boolean DEFAULT NULL)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
  v_band numeric := public._labor_pace_on_track_band();
  v_smart boolean := false; v_use_pos boolean := false; v_close_at timestamptz; v_bandtxt text; v_dow int;
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

  -- Smart Close (closers only). Off unless the store is switched on.
  IF NOT v_sched_only AND v_src IN ('punch_clock', 'toast') AND v_date = v_today THEN
    SELECT coalesce(_smart, s.enabled, false), coalesce(_position, s.use_position, false)
      INTO v_smart, v_use_pos
      FROM (SELECT 1) one
      LEFT JOIN public.labor_smart_close_settings s ON s.location_id = _location_id;
    v_smart := coalesce(v_smart, false); v_use_pos := coalesce(v_use_pos, false);
  END IF;
  IF v_smart THEN
    v_close_at := public._labor_close_at(_location_id, v_date, v_tz);
    v_dow := extract(dow FROM v_date)::int;
    v_bandtxt := CASE WHEN coalesce(v_goal, 0) > 0 AND coalesce(v_pace, 0) > 0 THEN public._labor_sales_band(v_pace / v_goal * 100) END;
  END IF;

  WITH sh AS (
    SELECT ss.id, ss.user_id, st.position::text AS position,
           greatest((v_date + ss.start_time) AT TIME ZONE v_tz, v_ws) AS s_start,
           least(((v_date + ss.end_time) + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_tz, v_we) AS s_end
      FROM public.scheduled_shifts ss
      JOIN public.schedules s ON s.id = ss.schedule_id AND s.location_id = _location_id
      LEFT JOIN public.shift_templates st ON st.id = ss.template_id
     WHERE ss.shift_date = v_date AND ss.user_id IS NOT NULL
       AND NOT coalesce(ss.is_time_off, false) AND NOT coalesce(ss.is_phantom, false)
       AND NOT coalesce(ss.is_coverage_only, false)
       AND ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL
  ),
  pr AS (
    SELECT * FROM public._labor_pace_pairs(_location_id, v_date, CASE WHEN v_sched_only THEN NULL ELSE v_src END)
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
    SELECT sh.id, sh.user_id, sh.position, sh.s_start, sh.s_end, ev.remaining_sec, ev.state, ev.late_minutes, ev.early_out_minutes,
           agg.on_break, agg.first_in, agg.last_out, ev.break_sec
      FROM sh
      CROSS JOIN LATERAL (
        SELECT count(*)::int AS npairs, bool_or(mp.is_open) AS open_any, bool_or(mp.on_break) AS on_break,
               min(mp.clock_in) AS first_in, max(mp.clock_out) FILTER (WHERE NOT mp.is_open) AS last_out,
               coalesce(sum(mp.taken_unpaid_sec), 0) AS taken
          FROM mp WHERE mp.sid = sh.id) agg
      CROSS JOIN LATERAL public._labor_pace_shift_eval(sh.s_start, sh.s_end, agg.npairs, agg.open_any, agg.first_in,
                                               agg.last_out, v_now, v_src, v_sched_only,
                                               public._labor_pace_break_owed_sec(_location_id, extract(epoch FROM sh.s_end - sh.s_start) / 3600),
                                               agg.taken, coalesce(agg.on_break, false)) ev
  ),
  sm AS (
    SELECT se.*, a.exp_out, a.remaining_sec AS rem2
      FROM se CROSS JOIN LATERAL public._labor_smart_close_adjust(se.state, se.s_end, v_now, se.remaining_sec,
              CASE WHEN v_smart AND public._labor_closer_rule(se.s_end, v_close_at, (SELECT max(x.s_end) FROM sh x)) IS NOT NULL
                  THEN public._labor_close_predict_min(_location_id, se.user_id, v_dow, v_bandtxt,
                                                       CASE WHEN v_use_pos THEN se.position END, NULL, v_use_pos) END) a
  ),
  un AS (
    SELECT mp.user_id, mp.clock_in, mp.on_break, te.e AS t_end, mp.est_end
      FROM mp CROSS JOIN LATERAL (SELECT public._labor_pace_template_end(_location_id, v_date, mp.clock_in, v_tz) AS e) te
     WHERE mp.sid IS NULL AND mp.is_open
  ),
  items AS (
    SELECT sm.user_id, sm.s_start AS sched_start, sm.s_end AS sched_end, sm.first_in AS actual_in, sm.last_out AS actual_out,
           sm.rem2 AS remaining_sec, sm.state, sm.late_minutes, sm.early_out_minutes, coalesce(sm.on_break, false) AS on_break,
           NULL::boolean AS from_template, sm.break_sec, sm.exp_out, sm.rem2 - sm.remaining_sec AS add_sec
      FROM sm
    UNION ALL
    SELECT un.user_id, NULL::timestamptz, least(coalesce(un.t_end, un.est_end), v_we), un.clock_in, NULL::timestamptz,
           greatest(extract(epoch FROM least(coalesce(un.t_end, un.est_end), v_we) - v_now), 0), 'unscheduled', 0, 0,
           un.on_break, un.t_end IS NOT NULL, 0::numeric, NULL::timestamptz, 0::numeric
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
                     'end_from_template', i.from_template,
                     'break_deducted_minutes', round(i.break_sec / 60))
                     || CASE WHEN i.exp_out IS NOT NULL THEN jsonb_build_object('expected_out', i.exp_out) ELSE '{}'::jsonb END
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
    coalesce((SELECT round(sum(add_sec) / 60) FROM items), 0)::int AS smart_min,
    coalesce((SELECT sum(late_minutes) FROM items), 0)::int AS late_min,
    coalesce((SELECT sum(early_out_minutes) FROM items), 0)::int AS early_min,
    coalesce((SELECT round(sum(break_sec) / 60) FROM items), 0)::int AS break_min,
    coalesce(jsonb_agg(jsonb_build_object(
      'user_id', per.user_id, 'name', per.name, 'state', per.state, 'on_break', per.on_break,
      'worked_hours', round(per.worked_h, 2), 'remaining_hours', round(per.rem_h, 2),
      'wage_missing', per.wage IS NULL, 'shifts', coalesce(per.shifts, '[]'::jsonb))
      ORDER BY per.name) FILTER (WHERE per.user_id IS NOT NULL), '[]'::jsonb) AS people
  INTO t FROM per;

  v_g := public._labor_goals_resolve(_location_id);
  v_d := v_g->'days'->((extract(isodow FROM v_date)::int - 1)::text);
  IF v_d = 'null'::jsonb THEN v_d := NULL; END IF;
  v_target := (coalesce(v_d, v_g->'weekly') #>> '{}')::numeric;

  v_pc := CASE WHEN v_sched_only THEN 0 ELSE coalesce(v_wc, 0) END + t.rem_c;
  v_pct := CASE WHEN coalesce(v_psales, 0) > 0 THEN v_pc / v_psales * 100 END;
  v_status := CASE WHEN v_pct IS NULL OR v_target IS NULL THEN NULL
                   WHEN v_pct < v_target - v_band THEN 'ahead'
                   WHEN v_pct > v_target + v_band THEN 'behind'
                   ELSE 'on_track' END;

  RETURN jsonb_build_object(
    'location_id', _location_id, 'business_date', v_date, 'source', v_src, 'timezone', v_tz,
    'mode', v_mode, 'as_of', v_asof, 'computed_at', v_now,
    'worked_hours', CASE WHEN v_sched_only THEN NULL ELSE v_wh END,
    'worked_labor_dollars', CASE WHEN v_sched_only THEN NULL ELSE v_wc END,
    'remaining_scheduled_hours', round(t.rem_h, 2),
    'remaining_labor_dollars', round(t.rem_c, 2),
    'pace_hours', round(CASE WHEN v_sched_only THEN 0 ELSE coalesce(v_wh, 0) END + t.rem_h, 2),
    'pace_labor_dollars', round(v_pc, 2),
    'sales_pace', round(v_psales, 2), 'sales_pace_source', v_psrc,
    'pace_labor_pct', round(v_pct, 2),
    'target_labor_pct', v_target,
    'target_labor_dollars', CASE WHEN v_target IS NOT NULL AND v_psales > 0 THEN round(v_target * v_psales / 100, 2) END,
    'variance_pct', CASE WHEN v_pct IS NOT NULL AND v_target IS NOT NULL THEN round(v_pct - v_target, 2) END,
    'status', v_status,
    'wage_missing_count', t.wage_missing, 'unscheduled_count', t.unscheduled,
    'late_not_in_count', t.late_not_in, 'over_schedule_count', t.over_schedule, 'on_break_count', t.on_break,
    'late_minutes', t.late_min, 'early_out_minutes', t.early_min,
    'break_deducted_minutes', t.break_min, 'on_track_band_pct', v_band,
    'smart_close', v_smart, 'smart_close_minutes', CASE WHEN v_smart THEN t.smart_min ELSE 0 END,
    'people', CASE WHEN v_svc OR v_mgr THEN t.people ELSE '[]'::jsonb END);
END $function$;

REVOKE ALL ON FUNCTION public._labor_pace_core(uuid, date, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public._labor_pace_core(uuid, date, boolean, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_pace_core(uuid, date, boolean, boolean) TO service_role;