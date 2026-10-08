-- California-only scheduled missed-meal premiums. Meal deductions and all other pay rules unchanged.
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
  v_m1 numeric := coalesce((r->>'meal_break_hours')::numeric, 0);
  v_m2 numeric := coalesce((r->>'second_meal_break_hours')::numeric, 0);
  v_w1 numeric := coalesce((r->>'meal_waiver_max_hours')::numeric, 0);
  v_w2 numeric := coalesce((r->>'second_meal_waiver_max_hours')::numeric, 0);
  v_len numeric := coalesce((r->>'meal_break_duration')::numeric, (r->>'unpaid_break_min_minutes')::numeric, 30);
  v_dead numeric;
  v_law boolean;
  u record; d record; s record;
  v_n int; v_worked_days int; v_i int; v_cum numeric; v_wh numeric;
  v_reg numeric; v_o numeric; v_d numeric; v_wot numeric; v_prem numeric; v_cost numeric; v_avail numeric; v_is7 boolean;
  v_fit numeric; v_req int; v_worked numeric; v_prev_end numeric; v_start numeric; v_end numeric;
  v_pdays jsonb; v_people jsonb := '[]'::jsonb; v_tot_h numeric := 0; v_tot_c numeric := 0;
  v_day jsonb := '{}'::jsonb;
BEGIN
  v_dead := CASE WHEN coalesce((r->>'meal_deadline_hours')::numeric, 0) > 0 THEN (r->>'meal_deadline_hours')::numeric ELSE v_m1 END;
  v_law := r IS NOT NULL AND coalesce(r->>'state_code', '') = 'CA'
           AND coalesce(r->>'meal_rule_basis', '') = 'law'
           AND NOT coalesce((r->>'meal_break_paid')::boolean, false) AND v_m1 > 0;

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
          extract(epoch FROM (CASE WHEN (x->>'end_time')::time <= (x->>'start_time')::time
            THEN (x->>'end_time')::time - (x->>'start_time')::time + interval '24 hours'
            ELSE (x->>'end_time')::time - (x->>'start_time')::time END)) / 3600.0 AS gross,
          coalesce((x->>'wage')::numeric, 15) AS wage
        FROM jsonb_array_elements(_shifts) x
        WHERE x->>'user_id' = u.uid
          AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
      )
      SELECT dt, sum(paid) AS h, sum(gross) AS g, max(wage) AS wage FROM sh GROUP BY dt ORDER BY dt
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

      v_prem := 0;
      IF v_law THEN
        v_req := CASE WHEN NOT (d.g > v_m1) OR (v_w1 > 0 AND d.g <= v_w1) THEN 0
                      WHEN v_m2 > 0 AND d.g > v_m2 AND NOT (v_w2 > 0 AND d.g <= v_w2) THEN 2 ELSE 1 END;
        IF v_req > 0 THEN
          v_fit := 0; v_worked := 0; v_prev_end := NULL;
          FOR s IN
            SELECT extract(epoch FROM (x->>'start_time')::time) / 60.0 AS st,
                   extract(epoch FROM (x->>'end_time')::time) / 60.0 AS en
            FROM jsonb_array_elements(_shifts) x
            WHERE x->>'user_id' = u.uid AND (x->>'shift_date')::date = d.dt
              AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
          LOOP
            v_start := s.st; v_end := s.en;
            IF v_end <= v_start THEN v_end := v_end + 1440; END IF;
            v_fit := v_fit
              + CASE WHEN (v_end - v_start) / 60.0 > v_m1 AND NOT (v_w1 > 0 AND (v_end - v_start) / 60.0 <= v_w1) THEN 1 ELSE 0 END
              + CASE WHEN v_m2 > 0 AND (v_end - v_start) / 60.0 > v_m2 AND NOT (v_w2 > 0 AND (v_end - v_start) / 60.0 <= v_w2) THEN 1 ELSE 0 END;
          END LOOP;
          FOR s IN
            SELECT extract(epoch FROM (x->>'start_time')::time) / 60.0 AS st,
                   extract(epoch FROM (x->>'end_time')::time) / 60.0 AS en
            FROM jsonb_array_elements(_shifts) x
            WHERE x->>'user_id' = u.uid AND (x->>'shift_date')::date = d.dt
              AND NOT coalesce((x->>'is_time_off')::boolean, false) AND NOT coalesce((x->>'is_phantom')::boolean, false)
            ORDER BY 1
          LOOP
            v_start := s.st; v_end := s.en;
            IF v_end <= v_start THEN v_end := v_end + 1440; END IF;
            IF v_prev_end IS NOT NULL AND v_start - v_prev_end >= v_len THEN
              IF v_fit = 0 THEN
                IF v_worked <= v_dead THEN v_fit := v_fit + 1; END IF;
              ELSE v_fit := v_fit + 1; END IF;
            END IF;
            v_worked := v_worked + (v_end - v_start) / 60.0;
            v_prev_end := v_end;
          END LOOP;
          IF v_fit < v_req THEN v_prem := d.wage; END IF;
        END IF;
      END IF;

      v_cost := (v_reg + (v_o + v_wot) * v_otm + v_d * v_dtm) * d.wage + v_prem;
      v_pdays := v_pdays || jsonb_build_object('date', d.dt, 'hours', round(d.h, 4), 'regular', round(v_reg, 4),
        'ot', round(v_o, 4), 'dt', round(v_d, 4), 'weekly_ot', round(v_wot, 4), 'seventh_day', v_is7,
        'meal_premium', round(v_prem, 4), 'cost', round(v_cost, 4));
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