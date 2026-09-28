CREATE TABLE public.labor_ot_premium (id boolean PRIMARY KEY DEFAULT true CHECK (id), enabled boolean NOT NULL DEFAULT true);
INSERT INTO public.labor_ot_premium (id, enabled) VALUES (true, true);
ALTER TABLE public.labor_ot_premium ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.labor_ot_premium FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public._labor_ot_rule(_location_id uuid, _date date)
RETURNS TABLE(active boolean, ot_thr numeric, dt_thr numeric, ot_mult numeric, dt_mult numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp
AS $$
  SELECT (_date >= public.labor_new_rule_start() AND coalesce((SELECT enabled FROM public.labor_ot_premium LIMIT 1), false)),
         coalesce(lr.daily_overtime_threshold, 0), coalesce(lr.daily_double_time_threshold, 0),
         coalesce(lr.overtime_multiplier, 1.5), coalesce(lr.double_time_multiplier, 2.0)
    FROM (SELECT 1) x
    LEFT JOIN LATERAL (SELECT * FROM public.labor_rules r WHERE r.location_id = _location_id ORDER BY r.created_at LIMIT 1) lr ON true
$$;
REVOKE ALL ON FUNCTION public._labor_ot_rule(uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_ot_rule(uuid, date) TO service_role;

-- OT/DT hours for a span of the day's paid hours [a, b]
CREATE FUNCTION public._labor_ot_span(a numeric, b numeric, ot_thr numeric, dt_thr numeric)
RETURNS TABLE(ot numeric, dt numeric)
LANGUAGE sql IMMUTABLE SET search_path = public, pg_temp
AS $$
  SELECT CASE WHEN ot_thr > 0 THEN greatest(0, least(b, CASE WHEN dt_thr > 0 THEN dt_thr ELSE b END) - greatest(a, ot_thr)) ELSE 0 END,
         CASE WHEN dt_thr > 0 THEN greatest(0, b - greatest(a, dt_thr)) ELSE 0 END
$$;
REVOKE ALL ON FUNCTION public._labor_ot_span(numeric, numeric, numeric, numeric) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._labor_ot_span(numeric, numeric, numeric, numeric) TO service_role;

DROP FUNCTION public.labor_day_user_totals(uuid, date, boolean);
CREATE FUNCTION public.labor_day_user_totals(_location_id uuid, _date date, _live boolean)
 RETURNS TABLE(user_id uuid, paid_hours numeric, unpaid_break_hours numeric, wage numeric, cost numeric, wage_missing boolean, open_shift boolean, unclosed_break_count integer, ot_hours numeric, dt_hours numeric, premium_cost numeric)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH g AS (
    SELECT s.user_id,
           sum(s.worked_sec) AS worked,
           sum(s.unpaid_sec) AS unpaid,
           bool_or(s.missing_clock_out AND NOT s.open_shift_live) AS open_shift,
           sum(s.unclosed_break_count)::int AS unc
      FROM public._labor_pair_shifts(_location_id, _date, _live) s
     GROUP BY s.user_id
  ), w AS (
    SELECT g.*,
           coalesce(
             (SELECT wh.hourly_wage FROM public.wage_history wh
               WHERE wh.user_id = g.user_id AND wh.effective_date <= _date AND wh.hourly_wage IS NOT NULL
               ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
             (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = g.user_id)
           ) AS raw_wage
      FROM g
  ), r AS (SELECT * FROM public._labor_ot_rule(_location_id, _date))
  SELECT w.user_id,
         greatest(w.worked - w.unpaid, 0) / 3600,
         w.unpaid / 3600,
         w.raw_wage,
         (greatest(w.worked - w.unpaid, 0) / 3600) * w.raw_wage,
         w.raw_wage IS NULL,
         w.open_shift,
         w.unc,
         CASE WHEN r.active THEN sp.ot ELSE 0 END,
         CASE WHEN r.active THEN sp.dt ELSE 0 END,
         CASE WHEN r.active THEN coalesce((sp.ot * (r.ot_mult - 1) + sp.dt * (r.dt_mult - 1)) * w.raw_wage, 0) ELSE 0 END
    FROM w CROSS JOIN r
    CROSS JOIN LATERAL public._labor_ot_span(0, greatest(w.worked - w.unpaid, 0) / 3600, r.ot_thr, r.dt_thr) sp
$function$;
REVOKE ALL ON FUNCTION public.labor_day_user_totals(uuid, date, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_day_user_totals(uuid, date, boolean) TO service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;

CREATE OR REPLACE FUNCTION public.labor_day_totals(_location_id uuid, _date date, _live boolean)
 RETURNS TABLE(hours numeric, cost numeric, wage_missing_count integer, open_shift_count integer, unclosed_break_count integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
  SELECT round(coalesce(sum(u.paid_hours), 0), 4),
         round(coalesce(sum(u.cost + u.premium_cost), 0), 2),
         (count(*) FILTER (WHERE u.wage_missing AND u.paid_hours > 0))::int,
         (count(*) FILTER (WHERE u.open_shift))::int,
         coalesce(sum(u.unclosed_break_count), 0)::int
    FROM public.labor_day_user_totals(_location_id, _date, _live) u
$function$;

DROP FUNCTION public.labor_shifts(uuid, date, date);
CREATE FUNCTION public.labor_shifts(_location_id uuid, _start date, _end date)
 RETURNS TABLE(user_id uuid, business_date date, clock_in_punch_id uuid, clock_in timestamp with time zone, clock_out timestamp with time zone, paid_hours numeric, paid_break_min numeric, unpaid_break_min numeric, wage numeric, cost numeric, open_shift_live boolean, missing_clock_out boolean, unclosed_break boolean, ignored_duplicates integer, resolved_zero boolean, resolved_by uuid, resolved_at timestamp with time zone, clock_out_punch_id uuid, auto_clock_out boolean, auto_reviewed boolean, meal_break_missing boolean, estimated_end timestamp with time zone, estimated boolean, wage_missing boolean, ot_hours numeric, dt_hours numeric, premium_cost numeric)
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
#variable_conflict use_column
DECLARE v_uid uuid := auth.uid(); v_d date; v_today date; v_mh numeric; v_md int;
BEGIN
  IF v_uid IS NULL OR _location_id IS NULL
     OR NOT public.has_role_or_higher(v_uid, 'manager')
     OR NOT public.has_location_access(v_uid, _location_id) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  IF _start IS NULL OR _end IS NULL OR _end < _start OR (_end - _start) > 44 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  v_today := public.business_date(_location_id);
  SELECT lr.meal_break_hours, lr.meal_break_duration INTO v_mh, v_md
    FROM public.labor_rules lr WHERE lr.location_id = _location_id ORDER BY lr.created_at LIMIT 1;

  FOR v_d IN SELECT g::date FROM generate_series(_start::timestamp, _end::timestamp, interval '1 day') g LOOP
    RETURN QUERY
      WITH base AS (
        SELECT s.*, greatest(s.worked_sec - s.unpaid_sec, 0) / 3600 AS ph,
               sum(greatest(s.worked_sec - s.unpaid_sec, 0) / 3600) OVER (PARTITION BY s.user_id ORDER BY s.clock_in, s.clock_in_punch_id) AS cum
          FROM public._labor_pair_shifts(_location_id, v_d, v_d = v_today, true) s
      ), r AS (SELECT * FROM public._labor_ot_rule(_location_id, v_d))
      SELECT s.user_id, s.business_date, s.clock_in_punch_id, s.clock_in, s.clock_out,
             round(s.ph, 4),
             round(s.paid_break_sec / 60, 2),
             round(s.unpaid_sec / 60, 2),
             wg.w,
             round(s.ph * wg.w, 2),
             s.open_shift_live, s.missing_clock_out, s.unclosed_break_count > 0,
             (SELECT (count(*) - count(DISTINCT (tp.punch_time, tp.punch_type)))::int
                FROM public.time_punches tp
               WHERE tp.location_id = _location_id AND tp.user_id = s.user_id
                 AND tp.punch_time >= s.clock_in
                 AND tp.punch_time <= coalesce(s.clock_out, s.clock_in)),
             coalesce(lsr.resolution = 'zero', false),
             CASE WHEN lsr.id IS NOT NULL THEN lsr.resolved_by END,
             CASE WHEN lsr.id IS NOT NULL THEN lsr.resolved_at END,
             s.clock_out_punch_id,
             coalesce(co.is_auto_punched_out, false),
             coalesce(lsr.resolution = 'auto_reviewed', false),
             CASE WHEN v_mh IS NULL THEN false
                  ELSE greatest(s.worked_sec - s.unpaid_sec, 0) > v_mh * 3600
                       AND coalesce(s.max_unpaid_break_sec, 0) < coalesce(v_md, 30) * 60 END,
             s.estimated_end, s.estimated,
             wg.w IS NULL,
             round(CASE WHEN r.active THEN sp.ot ELSE 0 END, 4),
             round(CASE WHEN r.active THEN sp.dt ELSE 0 END, 4),
             round(CASE WHEN r.active THEN coalesce((sp.ot * (r.ot_mult - 1) + sp.dt * (r.dt_mult - 1)) * wg.w, 0) ELSE 0 END, 2)
        FROM base s
        CROSS JOIN r
        CROSS JOIN LATERAL public._labor_ot_span(s.cum - s.ph, s.cum, r.ot_thr, r.dt_thr) sp
        LEFT JOIN public.labor_shift_resolutions lsr ON lsr.clock_in_punch_id = s.clock_in_punch_id
        LEFT JOIN public.time_punches co ON co.id = s.clock_out_punch_id
        CROSS JOIN LATERAL (
          SELECT coalesce(
            (SELECT wh.hourly_wage FROM public.wage_history wh
              WHERE wh.user_id = s.user_id AND wh.effective_date <= v_d AND wh.hourly_wage IS NOT NULL
              ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
            (SELECT pr.hourly_wage FROM public.profiles pr WHERE pr.id = s.user_id)) AS w
        ) wg;
  END LOOP;
END;
$function$;
REVOKE ALL ON FUNCTION public.labor_shifts(uuid, date, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_shifts(uuid, date, date) TO authenticated, service_role, sandbox_exec_lmodeiyrpwvgyqcvjkjr;