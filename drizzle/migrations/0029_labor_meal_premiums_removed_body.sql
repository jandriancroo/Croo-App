-- Meal premiums removed from scheduled labor cost (always 0). Deductions, waivers, OT/DT, weekly OT, 7th day unchanged.
CREATE OR REPLACE FUNCTION public.labor_week_pay(_shifts jsonb, _rules jsonb)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE SET search_path = public AS $$
DECLARE
  r jsonb := CASE WHEN jsonb_typeof(_rules) = 'object' THEN _rules END;
  v_ot numeric := coalesce((r->>'daily_overtime_threshold')::numeric, 0);
  v_dt numeric := coalesce((r->>'daily_double_time_threshold')::numeric, 0);
  v_otm numeric := coalesce((r->>'overtime_multiplier')::numeric, 1.5);
  v_dtm numeric := coalesce((r->>'double_time_multiplier')::numeric, 2);
  v_w numeric := coalesce((r->>'weekly_overtime_threshold')::numeric, 0);
  v_maxw numeric := coalesce((r->>'daily_ot_max_wage')::numeric, 0);
  v_7 boolean := coalesce((r->>'seventh_day_rule')::boolean, false);
  u record; d record;
  v_n int; v_worked_days int; v_i int; v_cum numeric; v_wh numeric;
  v_reg numeric; v_o numeric; v_d numeric; v_wot numeric; v_cost numeric; v_avail numeric; v_is7 boolean;
  v_pdays jsonb; v_people jsonb := '[]'::jsonb; v_tot_h numeric := 0; v_tot_c numeric := 0;
  v_day jsonb := '{}'::jsonb;
BEGIN
  FOR u IN
    SELECT DISTINCT x->>'user_id' AS uid
    FROM jsonb_array_elements(coalesce(_shifts, '[]'::jsonb)) x
    WHERE nullif(x->>'user_id', '') IS NOT NULL
      AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
    ORDER BY 1
  LOOP
    WITH sh AS (
      SELECT (x->>'shift_date')::date AS dt,
        public.scheduled_paid_hours((x->>'start_time')::time, (x->>'end_time')::time, r) AS paid
      FROM jsonb_array_elements(_shifts) x
      WHERE x->>'user_id' = u.uid
        AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
    ), dd AS (SELECT dt, sum(paid) AS h FROM sh GROUP BY dt)
    SELECT count(*), count(*) FILTER (WHERE h > 0) INTO v_n, v_worked_days FROM dd;

    v_i := 0; v_cum := 0; v_wh := 0; v_pdays := '[]'::jsonb;
    FOR d IN
      WITH sh AS (
        SELECT (x->>'shift_date')::date AS dt,
          public.scheduled_paid_hours((x->>'start_time')::time, (x->>'end_time')::time, r) AS paid,
          coalesce((x->>'wage')::numeric, 15) AS wage
        FROM jsonb_array_elements(_shifts) x
        WHERE x->>'user_id' = u.uid
          AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
      )
      SELECT dt, sum(paid) AS h, max(wage) AS wage FROM sh GROUP BY dt ORDER BY dt
    LOOP
      v_i := v_i + 1;
      v_reg := d.h; v_o := 0; v_d := 0;
      v_is7 := v_7 AND v_worked_days = 7 AND v_i = v_n;
      IF v_is7 THEN
        v_reg := 0; v_o := least(d.h, 8); v_d := greatest(d.h - 8, 0);
      ELSIF v_ot > 0 AND NOT (v_maxw > 0 AND d.wage >= v_maxw) THEN
        v_reg := least(d.h, v_ot);
        v_d := CASE WHEN v_dt > 0 THEN greatest(d.h - v_dt, 0) ELSE 0 END;
        v_o := d.h - v_reg - v_d;
      END IF;
      v_wot := 0;
      IF v_w > 0 THEN
        v_avail := greatest(v_w - v_cum, 0);
        v_cum := v_cum + v_reg;
        v_wot := greatest(v_reg - v_avail, 0);
        v_reg := v_reg - v_wot;
      END IF;

      v_cost := (v_reg + (v_o + v_wot) * v_otm + v_d * v_dtm) * d.wage;
      v_pdays := v_pdays || jsonb_build_object('date', d.dt, 'hours', round(d.h, 4), 'regular', round(v_reg, 4),
        'ot', round(v_o, 4), 'dt', round(v_d, 4), 'weekly_ot', round(v_wot, 4), 'seventh_day', v_is7,
        'meal_premium', 0, 'cost', round(v_cost, 4));
      v_day := jsonb_set(v_day, ARRAY[d.dt::text], jsonb_build_object(
        'hours', coalesce((v_day->d.dt::text->>'hours')::numeric, 0) + d.h,
        'cost', coalesce((v_day->d.dt::text->>'cost')::numeric, 0) + v_cost));
      v_wh := v_wh + d.h; v_tot_h := v_tot_h + d.h; v_tot_c := v_tot_c + v_cost;
    END LOOP;
    v_people := v_people || jsonb_build_object('user_id', u.uid, 'week_hours', round(v_wh, 4), 'days', v_pdays);
  END LOOP;

  RETURN jsonb_build_object(
    'total_hours', round(v_tot_h, 4), 'total_cost', round(v_tot_c, 4),
    'days', coalesce((SELECT jsonb_agg(jsonb_build_object('date', k, 'hours', round((v->>'hours')::numeric, 4),
               'cost', round((v->>'cost')::numeric, 4)) ORDER BY k) FROM jsonb_each(v_day) AS e(k, v)), '[]'::jsonb),
    'people', v_people);
END $$;
REVOKE EXECUTE ON FUNCTION public.labor_week_pay(jsonb, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_week_pay(jsonb, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._schedule_week_labor_check(_schedule_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public' AS $function$
DECLARE sc record; v_rules jsonb; v_pay jsonb; v_hours numeric := 0; v_cost numeric := 0; v_sales numeric;
  v_target numeric; v_pct numeric; v_reason text; v_days jsonb; v_people jsonb; v_any_day boolean;
  v_ot numeric; v_wk numeric;
BEGIN
  SELECT * INTO sc FROM schedules WHERE id = _schedule_id;
  IF sc IS NULL THEN RAISE EXCEPTION 'schedule_not_found'; END IF;

  SELECT to_jsonb(lr) INTO v_rules FROM labor_rules lr WHERE lr.location_id = sc.location_id;
  v_ot := coalesce((v_rules->>'daily_overtime_threshold')::numeric, 0);
  v_wk := nullif((v_rules->>'weekly_overtime_threshold')::numeric, 0);

  v_target := public.labor_goal_pct(sc.location_id, NULL);
  IF v_target IS NULL THEN
    SELECT labor_percentage_target INTO v_target FROM location_settings WHERE location_id = sc.location_id;
  END IF;

  SELECT public.labor_week_pay(coalesce(jsonb_agg(jsonb_build_object(
      'user_id', s.user_id, 'shift_date', s.shift_date, 'start_time', s.start_time, 'end_time', s.end_time,
      'wage', coalesce((SELECT wh.hourly_wage FROM wage_history wh
                         WHERE wh.user_id = s.user_id AND wh.effective_date <= s.shift_date
                         ORDER BY wh.effective_date DESC LIMIT 1), pr.hourly_wage, 15))), '[]'::jsonb), v_rules)
  INTO v_pay
  FROM scheduled_shifts s LEFT JOIN profiles pr ON pr.id = s.user_id
  WHERE s.schedule_id = _schedule_id AND s.user_id IS NOT NULL
    AND NOT coalesce(s.is_time_off, false) AND NOT coalesce(s.is_phantom, false);

  WITH d AS (
    SELECT g::date AS day, (g::date - sc.week_start_date) AS idx
    FROM generate_series(sc.week_start_date, sc.week_start_date + 6, interval '1 day') g
  ), p AS (
    SELECT DISTINCT ON (c.sale_date) c.sale_date,
      coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) AS proj
    FROM sales_cache c WHERE c.location_id = sc.location_id AND c.sale_date BETWEEN sc.week_start_date AND sc.week_start_date + 6
    ORDER BY c.sale_date, coalesce(c.override_projection, c.living_projection, c.initial_projection, c.projected_sales) DESC NULLS LAST
  ), dl AS (
    SELECT (x->>'date')::date AS day, (x->>'hours')::numeric AS hrs, (x->>'cost')::numeric AS cost
    FROM jsonb_array_elements(v_pay->'days') x
  ), dd AS (
    SELECT d.day, coalesce(sps.projected_sales, p.proj) AS sales,
      coalesce(dl.hrs, 0) AS hrs, coalesce(dl.cost, 0) AS cost,
      coalesce(public.labor_goal_pct(sc.location_id, d.day), v_target) AS target
    FROM d LEFT JOIN p ON p.sale_date = d.day
      LEFT JOIN schedule_projected_sales sps ON sps.schedule_id = _schedule_id AND sps.day_of_week = d.idx
      LEFT JOIN dl ON dl.day = d.day
  ), dp AS (
    SELECT dd.*, CASE WHEN dd.sales > 0 THEN round(dd.cost / dd.sales * 100, 1) END AS pct FROM dd
  )
  SELECT coalesce(sum(hrs), 0), coalesce(sum(cost), 0), sum(sales),
    jsonb_agg(jsonb_build_object('date', day, 'projected_sales', sales, 'target_pct', target,
        'scheduled_hours', round(hrs, 2), 'scheduled_cost', round(cost, 2), 'labor_pct', pct,
        'over_goal', coalesce(pct > target, false)) ORDER BY day),
    coalesce(bool_or(pct > target), false)
  INTO v_hours, v_cost, v_sales, v_days, v_any_day
  FROM dp;

  SELECT coalesce(jsonb_agg(o ORDER BY o->>'name'), '[]'::jsonb) INTO v_people FROM (
    SELECT jsonb_build_object('user_id', pp->>'user_id', 'name', pr.full_name,
      'week_hours', round((pp->>'week_hours')::numeric, 2),
      'over_weekly', coalesce(v_wk IS NOT NULL AND (pp->>'week_hours')::numeric > v_wk, false),
      'weekly_threshold', v_wk,
      'days_over_daily', coalesce((SELECT jsonb_agg(jsonb_build_object('date', dy->>'date', 'hours', round((dy->>'hours')::numeric, 2)) ORDER BY dy->>'date')
          FROM jsonb_array_elements(pp->'days') dy WHERE v_ot > 0 AND (dy->>'hours')::numeric > v_ot), '[]'::jsonb),
      'seventh_day', (SELECT dy->>'date' FROM jsonb_array_elements(pp->'days') dy WHERE (dy->>'seventh_day')::boolean LIMIT 1)) AS o
    FROM jsonb_array_elements(v_pay->'people') pp LEFT JOIN profiles pr ON pr.id = (pp->>'user_id')::uuid
  ) q
  WHERE (o->>'over_weekly')::boolean OR jsonb_array_length(o->'days_over_daily') > 0
     OR o->>'seventh_day' IS NOT NULL;

  IF v_sales IS NOT NULL AND v_sales > 0 THEN v_pct := round(v_cost / v_sales * 100, 1); END IF;
  IF v_target IS NULL THEN v_reason := 'no_target';
  ELSIF v_sales IS NULL THEN v_reason := 'no_projection';
  ELSIF v_sales <= 0 THEN v_reason := 'zero_sales';
  ELSIF v_pct > v_target THEN v_reason := 'over_goal';
  ELSIF v_any_day THEN v_reason := 'day_over_goal';
  END IF;

  RETURN jsonb_build_object('scheduled_hours', round(v_hours, 2), 'scheduled_cost', round(v_cost, 2),
    'projected_sales', round(v_sales, 2), 'labor_pct', v_pct, 'target_pct', v_target,
    'misses_goal', v_reason IS NOT NULL, 'reason', v_reason,
    'week_over_goal', coalesce(v_pct > v_target, false),
    'days', coalesce(v_days, '[]'::jsonb), 'people', v_people);
END $function$;
REVOKE EXECUTE ON FUNCTION public._schedule_week_labor_check(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._schedule_week_labor_check(uuid) TO service_role;