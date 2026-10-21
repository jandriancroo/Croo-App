-- Smart Close + cut history (additive). Learned closing habits feed get_labor_pace for closers only,
-- and only at stores switched on in labor_smart_close_settings (default off, changed by migration only).

CREATE TABLE public.labor_shift_outcomes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id uuid NOT NULL,
  business_date date NOT NULL,
  day_of_week int NOT NULL,
  user_id uuid NOT NULL,
  scheduled_shift_id uuid NOT NULL UNIQUE,
  template_id uuid,
  station_id uuid,
  position text,
  role text,
  scheduled_start timestamptz NOT NULL,
  scheduled_end timestamptz NOT NULL,
  actual_in timestamptz,
  actual_out timestamptz,
  minutes_vs_schedule int,
  is_closer boolean NOT NULL DEFAULT false,
  closer_by text,
  out_hour int,
  sales_at_out numeric,
  pace_pct_at_out numeric,
  final_sales numeric,
  goal numeric,
  final_sales_pct numeric,
  sales_band text,
  close_crew uuid[] NOT NULL DEFAULT '{}',
  crew_size_at_out int,
  source text NOT NULL,
  auto_closed boolean NOT NULL DEFAULT false,
  edited_out boolean NOT NULL DEFAULT false,
  exclude_reason text,
  computed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX labor_shift_outcomes_loc_date ON public.labor_shift_outcomes (location_id, business_date);
GRANT SELECT ON public.labor_shift_outcomes TO authenticated;
GRANT ALL ON public.labor_shift_outcomes TO service_role;
ALTER TABLE public.labor_shift_outcomes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin can view shift outcomes" ON public.labor_shift_outcomes
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE TABLE public.labor_close_habits (
  location_id uuid NOT NULL,
  scope text NOT NULL,
  key text NOT NULL,
  n int NOT NULL,
  avg_minutes numeric NOT NULL,
  trust numeric NOT NULL,
  computed_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (location_id, scope, key)
);
GRANT SELECT ON public.labor_close_habits TO authenticated;
GRANT ALL ON public.labor_close_habits TO service_role;
ALTER TABLE public.labor_close_habits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin can view close habits" ON public.labor_close_habits
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE TABLE public.labor_smart_close_settings (
  location_id uuid PRIMARY KEY,
  enabled boolean NOT NULL DEFAULT false,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.labor_smart_close_settings TO authenticated;
GRANT ALL ON public.labor_smart_close_settings TO service_role;
ALTER TABLE public.labor_smart_close_settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin can view smart close settings" ON public.labor_smart_close_settings
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

CREATE OR REPLACE FUNCTION public._labor_close_at_from(_date date, _open time, _close time, _is_closed boolean, _tz text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN coalesce(_is_closed, false) OR _open IS NULL OR _close IS NULL OR _open = _close THEN NULL
              ELSE ((_date + _close) + CASE WHEN _close < _open THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE _tz END
$$;

CREATE OR REPLACE FUNCTION public._labor_close_at(_location_id uuid, _date date, _tz text)
RETURNS timestamptz LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._labor_close_at_from(_date, h.open_time, h.close_time, h.is_closed, _tz)
    FROM public.location_hours h
   WHERE h.location_id = _location_id AND h.day_of_week = extract(dow FROM _date)::int
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public._labor_closer_rule(_s_end timestamptz, _close_at timestamptz, _latest_end timestamptz)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE
    WHEN _close_at IS NOT NULL AND _s_end >= _close_at AND _latest_end IS NOT NULL AND _s_end >= _latest_end - interval '30 minutes' THEN 'both'
    WHEN _close_at IS NOT NULL AND _s_end >= _close_at THEN 'hours'
    WHEN _latest_end IS NOT NULL AND _s_end >= _latest_end - interval '30 minutes' THEN 'latest' END
$$;

CREATE OR REPLACE FUNCTION public._labor_sales_band(_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _pct IS NULL THEN NULL WHEN _pct < 80 THEN '<80' WHEN _pct < 90 THEN '80-90'
              WHEN _pct < 100 THEN '90-100' WHEN _pct < 110 THEN '100-110' WHEN _pct < 120 THEN '110-120' ELSE '120+' END
$$;

CREATE OR REPLACE FUNCTION public._labor_outcome_exclude(_actual_out timestamptz, _auto boolean, _edited boolean, _minutes int)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp AS $$
  SELECT CASE WHEN _actual_out IS NULL THEN 'missing_out' WHEN coalesce(_auto, false) THEN 'auto_closed'
              WHEN coalesce(_edited, false) THEN 'edited' WHEN abs(_minutes) > 180 THEN 'over_3h' END
$$;

CREATE OR REPLACE FUNCTION public._labor_smart_close_adjust(_state text, _s_end timestamptz, _now timestamptz,
  _remaining_sec numeric, _pred_min numeric, OUT exp_out timestamptz, OUT remaining_sec numeric)
RETURNS record LANGUAGE plpgsql IMMUTABLE SET search_path = public, pg_temp AS $$
BEGIN
  IF _pred_min IS NULL OR _state NOT IN ('working', 'not_started', 'late_not_in') OR _now >= _s_end THEN
    exp_out := NULL; remaining_sec := _remaining_sec; RETURN;
  END IF;
  exp_out := greatest(_s_end + _pred_min * interval '1 minute', _now);
  remaining_sec := greatest(_remaining_sec + extract(epoch FROM exp_out - _s_end), 0);
END $$;

CREATE OR REPLACE FUNCTION public._labor_close_habits_compute(_location_id uuid, _as_of date)
RETURNS TABLE(scope text, key text, n int, avg_minutes numeric, trust numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  WITH c AS (
    SELECT o.* FROM public.labor_shift_outcomes o
     WHERE o.location_id = _location_id AND o.is_closer AND o.exclude_reason IS NULL
       AND o.business_date < _as_of AND o.business_date >= _as_of - 365),
  st AS (SELECT count(*)::int AS n, avg(minutes_vs_schedule)::numeric AS a FROM c WHERE business_date >= _as_of - 56)
  SELECT 'store', 'all', st.n, round(st.a, 2), 1::numeric FROM st WHERE st.n > 0
  UNION ALL
  SELECT 'weekday', c.day_of_week::text, count(*)::int, round(avg(c.minutes_vs_schedule) - st.a, 2), round(count(*)::numeric / (count(*) + 8), 4)
    FROM c, st WHERE st.n > 0 AND c.business_date >= _as_of - 56 GROUP BY c.day_of_week, st.a
  UNION ALL
  SELECT 'sales_band', c.sales_band, count(*)::int,
         round(sum(c.minutes_vs_schedule * power(0.5, (_as_of - c.business_date) / 90.0)) / sum(power(0.5, (_as_of - c.business_date) / 90.0)) - st.a, 2),
         round(count(*)::numeric / (count(*) + 8), 4)
    FROM c, st WHERE st.n > 0 AND c.sales_band IS NOT NULL GROUP BY c.sales_band, st.a
  UNION ALL
  SELECT 'person', p.user_id::text, count(*)::int, round(avg(p.minutes_vs_schedule) - st.a, 2), round(count(*)::numeric / (count(*) + 8), 4)
    FROM (SELECT c.user_id, c.minutes_vs_schedule, row_number() OVER (PARTITION BY c.user_id ORDER BY c.business_date DESC) AS rn FROM c) p, st
   WHERE st.n > 0 AND p.rn <= 30 GROUP BY p.user_id, st.a
$$;

CREATE OR REPLACE FUNCTION public._labor_close_predict_min(_location_id uuid, _user_id uuid, _dow int, _band text, _as_of date DEFAULT NULL)
RETURNS numeric LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v numeric;
BEGIN
  IF _as_of IS NULL THEN
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public.labor_close_habits h
     WHERE h.location_id = _location_id
       AND ((h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
            OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text));
  ELSE
    SELECT CASE WHEN bool_or(h.scope = 'store')
                THEN sum(CASE WHEN h.scope = 'store' THEN h.avg_minutes ELSE h.avg_minutes * h.trust END) END
      INTO v FROM public._labor_close_habits_compute(_location_id, _as_of) h
     WHERE (h.scope = 'store') OR (h.scope = 'weekday' AND h.key = _dow::text)
        OR (h.scope = 'sales_band' AND h.key = _band) OR (h.scope = 'person' AND h.key = _user_id::text);
  END IF;
  RETURN v;
END $$;

-- Exact copy of today's get_labor_pace, kept only for the smart-off parity check.
CREATE OR REPLACE FUNCTION public._labor_pace_baseline(_location_id uuid, _date date DEFAULT NULL::date)
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
    SELECT sh.id, sh.user_id, sh.s_start, sh.s_end, ev.remaining_sec, ev.state, ev.late_minutes, ev.early_out_minutes,
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
  un AS (
    SELECT mp.user_id, mp.clock_in, mp.on_break, te.e AS t_end, mp.est_end
      FROM mp CROSS JOIN LATERAL (SELECT public._labor_pace_template_end(_location_id, v_date, mp.clock_in, v_tz) AS e) te
     WHERE mp.sid IS NULL AND mp.is_open
  ),
  items AS (
    SELECT se.user_id, se.s_start AS sched_start, se.s_end AS sched_end, se.first_in AS actual_in, se.last_out AS actual_out,
           se.remaining_sec, se.state, se.late_minutes, se.early_out_minutes, coalesce(se.on_break, false) AS on_break,
           NULL::boolean AS from_template, se.break_sec
      FROM se
    UNION ALL
    SELECT un.user_id, NULL::timestamptz, least(coalesce(un.t_end, un.est_end), v_we), un.clock_in, NULL::timestamptz,
           greatest(extract(epoch FROM least(coalesce(un.t_end, un.est_end), v_we) - v_now), 0), 'unscheduled', 0, 0,
           un.on_break, un.t_end IS NOT NULL, 0::numeric
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
    coalesce((SELECT round(sum(break_sec) / 60) FROM items), 0)::int AS break_min,
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
    'people', CASE WHEN v_svc OR v_mgr THEN t.people ELSE '[]'::jsonb END);
END $function$;

CREATE OR REPLACE FUNCTION public._labor_pace_core(_location_id uuid, _date date, _smart boolean)
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
  v_smart boolean := false; v_close_at timestamptz; v_bandtxt text; v_dow int;
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
    v_smart := coalesce(_smart, (SELECT s.enabled FROM public.labor_smart_close_settings s WHERE s.location_id = _location_id), false);
  END IF;
  IF v_smart THEN
    v_close_at := public._labor_close_at(_location_id, v_date, v_tz);
    v_dow := extract(dow FROM v_date)::int;
    v_bandtxt := CASE WHEN coalesce(v_goal, 0) > 0 AND coalesce(v_pace, 0) > 0 THEN public._labor_sales_band(v_pace / v_goal * 100) END;
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
    SELECT sh.id, sh.user_id, sh.s_start, sh.s_end, ev.remaining_sec, ev.state, ev.late_minutes, ev.early_out_minutes,
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
                  THEN public._labor_close_predict_min(_location_id, se.user_id, v_dow, v_bandtxt) END) a
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

CREATE OR REPLACE FUNCTION public.get_labor_pace(_location_id uuid, _date date DEFAULT NULL::date)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT public._labor_pace_core(_location_id, _date, NULL)
$$;

CREATE OR REPLACE FUNCTION public.labor_shift_outcomes_build(_location_id uuid, _date date)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text; v_src text; v_hourly jsonb; v_net numeric; v_goal numeric; v_close_at timestamptz; v_n int := 0;
BEGIN
  v_src := public.labor_source_for(_location_id);
  IF v_src IS NULL OR v_src NOT IN ('punch_clock', 'toast') THEN RETURN 0; END IF;
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  SELECT sc.hourly_data, sc.net_sales INTO v_hourly, v_net FROM public.sales_cache sc
   WHERE sc.location_id = _location_id AND sc.sale_date = _date ORDER BY sc.fetched_at DESC NULLS LAST LIMIT 1;
  IF v_hourly IS NOT NULL AND jsonb_typeof(v_hourly) <> 'array' THEN v_hourly := NULL; END IF;
  v_goal := public._resolve_goal(_location_id, _date);
  v_close_at := public._labor_close_at(_location_id, _date, v_tz);

  WITH sh AS (
    SELECT ss.id, ss.user_id, ss.template_id, ss.station_id, st.position::text AS position, pf.role::text AS role,
           (_date + ss.start_time) AT TIME ZONE v_tz AS s_start,
           ((_date + ss.end_time) + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END) AT TIME ZONE v_tz AS s_end
      FROM public.scheduled_shifts ss
      JOIN public.schedules s ON s.id = ss.schedule_id AND s.location_id = _location_id
      LEFT JOIN public.shift_templates st ON st.id = ss.template_id
      LEFT JOIN public.profiles pf ON pf.id = ss.user_id
     WHERE ss.shift_date = _date AND ss.user_id IS NOT NULL
       AND NOT coalesce(ss.is_time_off, false) AND NOT coalesce(ss.is_phantom, false)
       AND NOT coalesce(ss.is_coverage_only, false)
       AND ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL),
  pr AS (
    SELECT p.user_id, p.clock_in,
           CASE WHEN p.missing_clock_out OR coalesce(p.estimated, false) OR coalesce(p.open_shift_live, false) THEN NULL ELSE p.clock_out END AS clock_out,
           tp.shift_id, coalesce(co.is_auto_punched_out, false) AS auto, (co.edited_by IS NOT NULL) AS edited
      FROM public._labor_pair_shifts(_location_id, _date, false) p
      LEFT JOIN public.time_punches tp ON tp.id = p.clock_in_punch_id
      LEFT JOIN public.time_punches co ON co.id = p.clock_out_punch_id
     WHERE v_src = 'punch_clock'
    UNION ALL
    SELECT ts.croo_user_id, ts.in_time, ts.out_time, ts.croo_scheduled_shift_id, false, false
      FROM public.toast_shifts ts
     WHERE v_src = 'toast' AND ts.location_id = _location_id AND ts.shift_date = _date
       AND ts.croo_user_id IS NOT NULL AND ts.in_time IS NOT NULL),
  mp AS (
    SELECT pr.*, m.id AS sid FROM pr LEFT JOIN LATERAL (
      SELECT sh.id FROM sh
       WHERE sh.user_id = pr.user_id
         AND (sh.id = pr.shift_id
              OR ((pr.shift_id IS NULL OR NOT EXISTS (SELECT 1 FROM sh s2 WHERE s2.id = pr.shift_id))
                  AND tstzrange(pr.clock_in, coalesce(pr.clock_out, pr.clock_in + interval '1 minute')) && tstzrange(sh.s_start, sh.s_end)))
       ORDER BY (sh.id = pr.shift_id) DESC NULLS LAST, abs(extract(epoch FROM sh.s_start - pr.clock_in)) LIMIT 1) m ON true),
  ag AS (
    SELECT sh.id, sh.user_id, sh.template_id, sh.station_id, sh.position, sh.role, sh.s_start, sh.s_end,
           min(mp.clock_in) AS ai,
           CASE WHEN bool_or(mp.clock_out IS NULL) THEN NULL ELSE max(mp.clock_out) END AS ao,
           bool_or(mp.auto) AS au, bool_or(mp.edited) AS ed
      FROM sh JOIN mp ON mp.sid = sh.id
     GROUP BY sh.id, sh.user_id, sh.template_id, sh.station_id, sh.position, sh.role, sh.s_start, sh.s_end),
  lt AS (SELECT max(sh.s_end) AS le FROM sh),
  rw AS (
    SELECT ag.*, round(extract(epoch FROM ag.ao - ag.s_end) / 60)::int AS mins, (ag.ao AT TIME ZONE v_tz) AS lo FROM ag),
  fin AS (
    SELECT rw.*, lt.le,
           CASE WHEN rw.ao IS NULL OR v_hourly IS NULL THEN NULL
                WHEN rw.lo::date > _date THEN v_net
                ELSE (SELECT coalesce(sum(CASE WHEN public._pace_hour(e) < extract(hour FROM rw.lo) THEN public._pace_num(e->'sales')
                                               WHEN public._pace_hour(e) = extract(hour FROM rw.lo) THEN public._pace_num(e->'sales') * extract(minute FROM rw.lo) / 60
                                               ELSE 0 END), 0)
                        FROM jsonb_array_elements(v_hourly) e) END AS s_out
      FROM rw CROSS JOIN lt)
  INSERT INTO public.labor_shift_outcomes AS o (
    location_id, business_date, day_of_week, user_id, scheduled_shift_id, template_id, station_id, position, role,
    scheduled_start, scheduled_end, actual_in, actual_out, minutes_vs_schedule, is_closer, closer_by, out_hour,
    sales_at_out, pace_pct_at_out, final_sales, goal, final_sales_pct, sales_band, source, auto_closed, edited_out,
    exclude_reason, computed_at)
  SELECT _location_id, _date, extract(dow FROM _date)::int, f.user_id, f.id, f.template_id, f.station_id, f.position, f.role,
         f.s_start, f.s_end, f.ai, f.ao, f.mins,
         public._labor_closer_rule(f.s_end, v_close_at, f.le) IS NOT NULL, public._labor_closer_rule(f.s_end, v_close_at, f.le),
         extract(hour FROM f.lo)::int, round(f.s_out, 2),
         CASE WHEN coalesce(v_goal, 0) > 0 AND f.s_out IS NOT NULL THEN
           round(CASE WHEN f.lo::date > _date THEN v_net
                      ELSE public.sales_pace_today(v_hourly, f.s_out, NULL, NULL, extract(hour FROM f.lo)::int, extract(minute FROM f.lo)::int, f.ao) END
                 / v_goal * 100, 1) END,
         v_net, v_goal, CASE WHEN coalesce(v_goal, 0) > 0 THEN round(v_net / v_goal * 100, 1) END,
         public._labor_sales_band(CASE WHEN coalesce(v_goal, 0) > 0 THEN v_net / v_goal * 100 END),
         v_src, coalesce(f.au, false), coalesce(f.ed, false), public._labor_outcome_exclude(f.ao, f.au, f.ed, f.mins), now()
    FROM fin f
  ON CONFLICT (scheduled_shift_id) DO UPDATE SET
    location_id = EXCLUDED.location_id, business_date = EXCLUDED.business_date, day_of_week = EXCLUDED.day_of_week,
    user_id = EXCLUDED.user_id, template_id = EXCLUDED.template_id, station_id = EXCLUDED.station_id,
    position = EXCLUDED.position, role = EXCLUDED.role, scheduled_start = EXCLUDED.scheduled_start,
    scheduled_end = EXCLUDED.scheduled_end, actual_in = EXCLUDED.actual_in, actual_out = EXCLUDED.actual_out,
    minutes_vs_schedule = EXCLUDED.minutes_vs_schedule, is_closer = EXCLUDED.is_closer, closer_by = EXCLUDED.closer_by,
    out_hour = EXCLUDED.out_hour, sales_at_out = EXCLUDED.sales_at_out, pace_pct_at_out = EXCLUDED.pace_pct_at_out,
    final_sales = EXCLUDED.final_sales, goal = EXCLUDED.goal, final_sales_pct = EXCLUDED.final_sales_pct,
    sales_band = EXCLUDED.sales_band, source = EXCLUDED.source, auto_closed = EXCLUDED.auto_closed,
    edited_out = EXCLUDED.edited_out, exclude_reason = EXCLUDED.exclude_reason, computed_at = EXCLUDED.computed_at;
  GET DIAGNOSTICS v_n = ROW_COUNT;

  UPDATE public.labor_shift_outcomes o SET
    close_crew = coalesce((SELECT array_agg(o2.user_id ORDER BY o2.user_id) FROM public.labor_shift_outcomes o2
                            WHERE o2.location_id = o.location_id AND o2.business_date = o.business_date
                              AND o2.is_closer AND o2.id <> o.id), '{}'),
    crew_size_at_out = CASE WHEN o.actual_out IS NULL THEN NULL ELSE
                       (SELECT count(*) FROM public.labor_shift_outcomes o2
                         WHERE o2.location_id = o.location_id AND o2.business_date = o.business_date AND o2.id <> o.id
                           AND o2.actual_in <= o.actual_out AND coalesce(o2.actual_out, 'infinity'::timestamptz) > o.actual_out)::int END
   WHERE o.location_id = _location_id AND o.business_date = _date;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.labor_shift_outcomes_backfill(_location_id uuid, _from date, _to date)
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE d date; v int := 0;
BEGIN
  FOR d IN SELECT generate_series(_from, _to, interval '1 day')::date LOOP
    v := v + public.labor_shift_outcomes_build(_location_id, d);
  END LOOP;
  RETURN v;
END $$;

CREATE OR REPLACE FUNCTION public.refresh_labor_close_habits()
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; d date; v_out jsonb := '{}'::jsonb; v_rows int; v_h int;
BEGIN
  FOR r IN SELECT l.id, l.name FROM public.locations l LOOP
    BEGIN
      IF coalesce(public.labor_source_for(r.id), '') NOT IN ('punch_clock', 'toast') THEN CONTINUE; END IF;
      d := public.business_date(r.id);
      v_rows := public.labor_shift_outcomes_backfill(r.id, d - 3, d - 1);
      DELETE FROM public.labor_close_habits WHERE location_id = r.id;
      INSERT INTO public.labor_close_habits (location_id, scope, key, n, avg_minutes, trust, computed_at)
        SELECT r.id, c.scope, c.key, c.n, c.avg_minutes, c.trust, now() FROM public._labor_close_habits_compute(r.id, d) c;
      GET DIAGNOSTICS v_h = ROW_COUNT;
      v_out := v_out || jsonb_build_object(r.name, jsonb_build_object('outcomes', v_rows, 'habits', v_h));
    EXCEPTION WHEN OTHERS THEN
      v_out := v_out || jsonb_build_object(r.name, jsonb_build_object('error', SQLERRM));
    END;
  END LOOP;
  RETURN v_out;
END $$;

CREATE OR REPLACE FUNCTION public.get_cut_history(_location_id uuid, _day_of_week int DEFAULT NULL, _hour int DEFAULT NULL,
  _sales_band text DEFAULT NULL, _days int DEFAULT 180)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid(); v_ok boolean; v_today date;
BEGIN
  IF _location_id IS NULL OR coalesce(_days, 0) < 1 OR _days > 400 THEN RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023'; END IF;
  v_ok := coalesce(auth.role(), '') = 'service_role' OR coalesce(v_uid IS NOT NULL AND public.has_role_or_higher(v_uid, 'shift_manager')
            AND (public.is_super_admin(v_uid) OR public.has_location_access(v_uid, _location_id)
                 OR public.has_brand_access_via_location(v_uid, _location_id)), false);
  IF NOT v_ok THEN RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501'; END IF;
  v_today := public.business_date(_location_id);
  RETURN (
    SELECT coalesce(jsonb_agg(jsonb_build_object(
             'business_date', x.business_date, 'day_of_week', x.day_of_week, 'user_id', x.user_id, 'name', x.name,
             'position', x.position, 'station_id', x.station_id,
             'scheduled_end', x.scheduled_end, 'actual_out', x.actual_out, 'minutes_vs_schedule', x.minutes_vs_schedule,
             'out_hour', x.out_hour, 'sales_at_out', x.sales_at_out, 'pace_pct_at_out', x.pace_pct_at_out,
             'pace_band_at_out', public._labor_sales_band(x.pace_pct_at_out), 'final_sales_pct', x.final_sales_pct,
             'crew_size_at_out', x.crew_size_at_out) ORDER BY x.business_date DESC, x.out_hour), '[]'::jsonb)
      FROM (SELECT o.*, coalesce(nullif(pf.nickname, ''), pf.full_name) AS name
              FROM public.labor_shift_outcomes o LEFT JOIN public.profiles pf ON pf.id = o.user_id
             WHERE o.location_id = _location_id AND NOT o.is_closer AND o.exclude_reason IS NULL
               AND o.business_date >= v_today - _days AND o.business_date < v_today
               AND (_day_of_week IS NULL OR o.day_of_week = _day_of_week)
               AND (_hour IS NULL OR o.out_hour = _hour)
               AND (_sales_band IS NULL OR public._labor_sales_band(o.pace_pct_at_out) = _sales_band)
             ORDER BY o.business_date DESC LIMIT 500) x);
END $$;

CREATE OR REPLACE FUNCTION public.labor_smart_close_backtest(_location_id uuid, _days int DEFAULT 28, _at time DEFAULT '18:00')
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_tz text; v_today date; d date; t6 timestamptz; v_hourly jsonb; v_net numeric; v_goal numeric;
  v_so numeric; v_pace numeric; v_band text; r record; v_nights jsonb := '[]'::jsonb;
BEGIN
  SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = _location_id;
  v_tz := coalesce(v_tz, 'America/Los_Angeles');
  v_today := public.business_date(_location_id);
  FOR d IN SELECT generate_series(v_today - _days, v_today - 1, interval '1 day')::date LOOP
    t6 := (d + _at) AT TIME ZONE v_tz;
    v_hourly := NULL; v_net := NULL;
    SELECT sc.hourly_data, sc.net_sales INTO v_hourly, v_net FROM public.sales_cache sc
     WHERE sc.location_id = _location_id AND sc.sale_date = d ORDER BY sc.fetched_at DESC NULLS LAST LIMIT 1;
    CONTINUE WHEN v_hourly IS NULL OR jsonb_typeof(v_hourly) <> 'array' OR coalesce(v_net, 0) <= 0;
    v_goal := public._resolve_goal(_location_id, d);
    SELECT coalesce(sum(public._pace_num(e->'sales')), 0) INTO v_so FROM jsonb_array_elements(v_hourly) e
     WHERE public._pace_hour(e) < extract(hour FROM _at);
    v_pace := public.sales_pace_today(v_hourly, v_so, NULL, NULL, extract(hour FROM _at)::int, extract(minute FROM _at)::int, t6);
    CONTINUE WHEN coalesce(v_pace, 0) <= 0;
    v_band := CASE WHEN coalesce(v_goal, 0) > 0 THEN public._labor_sales_band(v_pace / v_goal * 100) END;
    WITH o AS (
      SELECT o.*, coalesce(
               (SELECT wh.hourly_wage FROM public.wage_history wh WHERE wh.user_id = o.user_id AND wh.effective_date <= d
                  AND wh.hourly_wage IS NOT NULL ORDER BY wh.effective_date DESC, wh.created_at DESC LIMIT 1),
               (SELECT pf.hourly_wage FROM public.profiles pf WHERE pf.id = o.user_id), 0) AS w
        FROM public.labor_shift_outcomes o
       WHERE o.location_id = _location_id AND o.business_date = d AND o.actual_out IS NOT NULL AND o.actual_in IS NOT NULL),
    s AS (
      SELECT o.*,
             CASE WHEN o.actual_out <= t6 AND o.actual_in <= t6 THEN 0
                  WHEN o.actual_in <= t6 THEN greatest(extract(epoch FROM o.scheduled_end - t6), 0)
                  ELSE greatest(extract(epoch FROM o.scheduled_end - o.scheduled_start), 0) END AS plain_rem,
             CASE WHEN o.is_closer AND t6 < o.scheduled_end AND NOT (o.actual_out <= t6 AND o.actual_in <= t6)
                  THEN public._labor_close_predict_min(_location_id, o.user_id, o.day_of_week, v_band, d) END AS pred
        FROM o),
    a AS (
      SELECT s.*, (public._labor_smart_close_adjust(
               CASE WHEN s.actual_in <= t6 THEN 'working' ELSE 'not_started' END, s.scheduled_end, t6, s.plain_rem, s.pred)).remaining_sec AS smart_rem
        FROM s)
    SELECT sum(a.w * extract(epoch FROM greatest(least(a.actual_out, t6) - a.actual_in, interval '0')) / 3600) AS worked,
           sum(a.w * a.plain_rem / 3600) AS plain_rem, sum(a.w * a.smart_rem / 3600) AS smart_rem,
           sum(a.w * extract(epoch FROM a.actual_out - a.actual_in) / 3600) AS actual,
           count(*) FILTER (WHERE a.pred IS NOT NULL) AS closers
      INTO r FROM a;
    CONTINUE WHEN r.actual IS NULL OR r.actual = 0;
    v_nights := v_nights || jsonb_build_object('date', d, 'sales_pace_at', round(v_pace, 2), 'final_sales', v_net,
      'plain_pct', round((r.worked + r.plain_rem) / v_pace * 100, 2), 'smart_pct', round((r.worked + r.smart_rem) / v_pace * 100, 2),
      'actual_pct', round(r.actual / v_net * 100, 2),
      'plain_dollars', round(r.worked + r.plain_rem, 2), 'smart_dollars', round(r.worked + r.smart_rem, 2),
      'actual_dollars', round(r.actual, 2), 'closers_adjusted', r.closers);
  END LOOP;
  RETURN jsonb_build_object('location_id', _location_id, 'at', _at, 'nights', jsonb_array_length(v_nights),
    'avg_miss_plain_pct', (SELECT round(avg(abs((n->>'plain_pct')::numeric - (n->>'actual_pct')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_smart_pct', (SELECT round(avg(abs((n->>'smart_pct')::numeric - (n->>'actual_pct')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_plain_dollars', (SELECT round(avg(abs((n->>'plain_dollars')::numeric - (n->>'actual_dollars')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_smart_dollars', (SELECT round(avg(abs((n->>'smart_dollars')::numeric - (n->>'actual_dollars')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'detail', v_nights);
END $$;

REVOKE ALL ON FUNCTION public._labor_pace_core(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._labor_pace_baseline(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.labor_shift_outcomes_build(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.labor_shift_outcomes_backfill(uuid, date, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.refresh_labor_close_habits() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.labor_smart_close_backtest(uuid, int, time) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._labor_close_habits_compute(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._labor_close_predict_min(uuid, uuid, int, text, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._labor_close_at(uuid, date, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_cut_history(uuid, int, int, text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_cut_history(uuid, int, int, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public._labor_pace_core(uuid, date, boolean), public._labor_pace_baseline(uuid, date),
  public.labor_shift_outcomes_build(uuid, date), public.labor_shift_outcomes_backfill(uuid, date, date),
  public.refresh_labor_close_habits(), public.labor_smart_close_backtest(uuid, int, time),
  public._labor_close_habits_compute(uuid, date), public._labor_close_predict_min(uuid, uuid, int, text, date),
  public._labor_close_at(uuid, date, text), public.get_cut_history(uuid, int, int, text, int) TO service_role;

INSERT INTO public.data_point_registry (key, label, category, unit, description, canonical_table, sources, refresh_cadence, readers, sot_status, notes)
VALUES
 ('labor_shift_outcomes', 'Shift outcomes (scheduled vs actual end)', 'labor', 'minutes',
  'Per past shift: scheduled vs actual clock-out, closer tag, sales at clock-out, crew', 'labor_shift_outcomes',
  '{"none": {"writer": "labor_shift_outcomes_build (punch clock)"}, "toast": {"writer": "labor_shift_outcomes_build (toast_shifts)"}}',
  'nightly 3 AM maintenance (refresh_labor_close_habits)', '{"get_labor_pace (Smart Close)","get_cut_history (Theo)"}', 'single',
  'Qu stores excluded: Qu sends store totals only.'),
 ('labor_close_habits', 'Learned closing habits', 'labor', 'minutes',
  'Store / weekday / sales band / person minutes past scheduled end for closers, with trust n/(n+8)', 'labor_close_habits',
  '{"none": {"writer": "refresh_labor_close_habits"}, "toast": {"writer": "refresh_labor_close_habits"}}',
  'nightly 3 AM maintenance', '{"get_labor_pace (Smart Close)"}', 'single', 'Used only where labor_smart_close_settings.enabled.')
ON CONFLICT (key) DO NOTHING;
