-- ONE scheduled-hours rule (mirror of src/utils/shiftUtils.ts paidShiftHours). Keep identical.
CREATE OR REPLACE FUNCTION public.scheduled_paid_hours(_start time, _end time, _rules jsonb)
RETURNS numeric LANGUAGE sql IMMUTABLE SET search_path = public AS $$
  WITH g AS (
    SELECT extract(epoch FROM (CASE WHEN _end <= _start THEN _end - _start + interval '24 hours' ELSE _end - _start END)) / 3600.0 AS gross
  ), r AS (
    SELECT g.gross,
      CASE WHEN _rules IS NULL OR jsonb_typeof(_rules) <> 'object'
             OR coalesce(_rules->>'meal_rule_basis', '') = 'none'
             OR coalesce((_rules->>'meal_break_paid')::boolean, false)
             OR coalesce((_rules->>'meal_break_hours')::numeric, 0) = 0
        THEN 0
        ELSE coalesce((_rules->>'meal_break_duration')::numeric, (_rules->>'unpaid_break_min_minutes')::numeric, 30)
          * ((CASE WHEN g.gross > (_rules->>'meal_break_hours')::numeric THEN 1 ELSE 0 END)
           + (CASE WHEN coalesce((_rules->>'second_meal_break_hours')::numeric, 0) > 0
                    AND g.gross > (_rules->>'second_meal_break_hours')::numeric THEN 1 ELSE 0 END))
      END AS meal_min
    FROM g
  )
  SELECT greatest(0, gross - meal_min / 60.0) FROM r
$$;
REVOKE EXECUTE ON FUNCTION public.scheduled_paid_hours(time, time, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.scheduled_paid_hours(time, time, jsonb) TO service_role;

-- Same numbers as the schedule Labor row: rule-driven meals, wage on each shift date,
-- per-employee daily OT/DT, saved schedule sales first. STABLE: CTEs only, no temp tables.
CREATE OR REPLACE FUNCTION public.schedule_week_labor_check(_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE sc record; v_rules jsonb; v_hours numeric := 0; v_cost numeric := 0; v_sales numeric; v_target numeric;
  v_pct numeric; v_reason text; v_days jsonb; v_people jsonb;
  v_ot numeric; v_dt numeric; v_otm numeric; v_dtm numeric; v_wk numeric;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;
  IF auth.uid() IS NOT NULL AND NOT (public.has_role_or_higher(auth.uid(), 'manager') AND public.has_location_access(auth.uid(), sc.location_id)) THEN
    RAISE EXCEPTION 'not_authorized';
  END IF;

  SELECT to_jsonb(lr) INTO v_rules FROM labor_rules lr WHERE lr.location_id = sc.location_id;
  v_ot  := nullif((v_rules->>'daily_overtime_threshold')::numeric, 0);
  v_dt  := nullif((v_rules->>'daily_double_time_threshold')::numeric, 0);
  v_otm := coalesce((v_rules->>'overtime_multiplier')::numeric, 1.5);
  v_dtm := coalesce((v_rules->>'double_time_multiplier')::numeric, 2.0);
  v_wk  := coalesce((v_rules->>'weekly_overtime_threshold')::numeric, 40);

  WITH sh AS (
    SELECT s.user_id, s.shift_date, public.scheduled_paid_hours(s.start_time, s.end_time, v_rules) AS hrs
    FROM scheduled_shifts s
    WHERE s.schedule_id = _schedule_id AND s.user_id IS NOT NULL
      AND NOT coalesce(s.is_time_off, false) AND NOT coalesce(s.is_phantom, false)
  ), wd AS (
    SELECT shift_date, array_agg(DISTINCT user_id) AS users FROM sh GROUP BY shift_date
  ), w AS (
    SELECT wd.shift_date, x.user_id, x.hourly_wage
    FROM wd, LATERAL public.get_current_wages_batch(wd.users, wd.shift_date) x
  ), ed AS (
    SELECT sh.user_id, sh.shift_date, sum(sh.hrs) AS hrs, max(coalesce(w.hourly_wage, 15)) AS wage
    FROM sh LEFT JOIN w ON w.user_id = sh.user_id AND w.shift_date = sh.shift_date
    GROUP BY sh.user_id, sh.shift_date
  ), edc AS (
    SELECT ed.*, CASE
      WHEN v_ot IS NULL OR ed.hrs <= v_ot THEN ed.hrs * ed.wage
      WHEN v_dt IS NULL OR ed.hrs <= v_dt THEN v_ot * ed.wage + (ed.hrs - v_ot) * ed.wage * v_otm
      ELSE v_ot * ed.wage + (v_dt - v_ot) * ed.wage * v_otm + (ed.hrs - v_dt) * ed.wage * v_dtm END AS cost
    FROM ed
  ), dl AS (
    SELECT shift_date, sum(hrs) AS hrs, sum(cost) AS cost FROM edc GROUP BY shift_date
  ), d AS (
    SELECT g::date AS day, (g::date - sc.week_start_date) AS idx
    FROM generate_series(sc.week_start_date, sc.week_start_date + 6, interval '1 day') g
  ), p AS (
    SELECT DISTINCT ON (c.sale_date) c.sale_date,
      coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) AS proj
    FROM sales_cache c WHERE c.location_id = sc.location_id AND c.sale_date BETWEEN sc.week_start_date AND sc.week_start_date + 6
    ORDER BY c.sale_date, coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) DESC NULLS LAST
  ), dd AS (
    SELECT d.day, coalesce(sps.projected_sales, p.proj) AS sales,
      coalesce(dl.hrs, 0) AS hrs, coalesce(dl.cost, 0) AS cost,
      public.labor_goal_pct(sc.location_id, d.day) AS target
    FROM d LEFT JOIN p ON p.sale_date = d.day
      LEFT JOIN schedule_projected_sales sps ON sps.schedule_id = _schedule_id AND sps.day_of_week = d.idx
      LEFT JOIN dl ON dl.shift_date = d.day
  ), dp AS (
    SELECT dd.*, CASE WHEN dd.sales > 0 THEN round(dd.cost / dd.sales * 100, 1) END AS pct FROM dd
  ), pw AS (
    SELECT user_id, sum(hrs) AS wh,
      jsonb_agg(jsonb_build_object('date', shift_date, 'hours', round(hrs, 2)) ORDER BY shift_date)
        FILTER (WHERE v_ot IS NOT NULL AND hrs > v_ot) AS over_days
    FROM edc GROUP BY user_id
  )
  SELECT
    (SELECT coalesce(sum(hrs), 0) FROM dd),
    (SELECT coalesce(sum(cost), 0) FROM dd),
    (SELECT sum(sales) FROM dd),
    (SELECT jsonb_agg(jsonb_build_object('date', day, 'projected_sales', sales, 'target_pct', target,
        'scheduled_hours', round(hrs, 2), 'scheduled_cost', round(cost, 2), 'labor_pct', pct,
        'over_goal', coalesce(pct > target, false)) ORDER BY day) FROM dp),
    (SELECT coalesce(jsonb_agg(jsonb_build_object('user_id', pw.user_id, 'name', pr.full_name,
        'week_hours', round(pw.wh, 2), 'over_weekly', pw.wh > v_wk, 'weekly_threshold', v_wk,
        'days_over_daily', coalesce(pw.over_days, '[]'::jsonb)) ORDER BY pr.full_name), '[]'::jsonb)
     FROM pw LEFT JOIN profiles pr ON pr.id = pw.user_id
     WHERE pw.wh > v_wk OR pw.over_days IS NOT NULL)
  INTO v_hours, v_cost, v_sales, v_days, v_people;

  v_target := public.labor_goal_pct(sc.location_id, NULL);
  IF v_target IS NULL THEN
    SELECT labor_percentage_target INTO v_target FROM location_settings WHERE location_id = sc.location_id;
  END IF;

  IF v_sales IS NOT NULL AND v_sales > 0 THEN v_pct := round(v_cost / v_sales * 100, 1); END IF;
  IF v_target IS NULL THEN v_reason := 'no_target';
  ELSIF v_sales IS NULL THEN v_reason := 'no_projection';
  ELSIF v_sales <= 0 THEN v_reason := 'zero_sales';
  ELSIF v_pct > v_target THEN v_reason := 'over_goal';
  END IF;

  RETURN jsonb_build_object('scheduled_hours', round(v_hours, 2), 'scheduled_cost', round(v_cost, 2),
    'projected_sales', round(v_sales, 2), 'labor_pct', v_pct, 'target_pct', v_target,
    'misses_goal', v_reason IS NOT NULL, 'reason', v_reason,
    'week_over_goal', coalesce(v_pct > v_target, false),
    'days', coalesce(v_days, '[]'::jsonb), 'people', v_people);
END $function$;
-- Grants unchanged (CREATE OR REPLACE keeps the existing ACL: authenticated + service_role).
