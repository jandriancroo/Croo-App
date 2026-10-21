-- Back-test gains the 4-layer (position) variant plus a new-closer breakdown.
-- Scorecard gains pos_pct/pos_miss and skips stores with no punch data that day.

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
               (SELECT pf.hourly_wage FROM public.profiles pf WHERE pf.id = o.user_id), 0) AS w,
             (SELECT count(*)::int FROM public.labor_shift_outcomes o2
               WHERE o2.location_id = o.location_id AND o2.user_id = o.user_id AND o2.is_closer
                 AND o2.exclude_reason IS NULL AND o2.business_date < d) AS prior_closes
        FROM public.labor_shift_outcomes o
       WHERE o.location_id = _location_id AND o.business_date = d AND o.actual_out IS NOT NULL AND o.actual_in IS NOT NULL),
    s AS (
      SELECT o.*,
             CASE WHEN o.actual_out <= t6 AND o.actual_in <= t6 THEN 0
                  WHEN o.actual_in <= t6 THEN greatest(extract(epoch FROM o.scheduled_end - t6), 0)
                  ELSE greatest(extract(epoch FROM o.scheduled_end - o.scheduled_start), 0) END AS plain_rem,
             CASE WHEN o.is_closer AND t6 < o.scheduled_end AND NOT (o.actual_out <= t6 AND o.actual_in <= t6)
                  THEN public._labor_close_predict_min(_location_id, o.user_id, o.day_of_week, v_band, NULL, d, false) END AS pred,
             CASE WHEN o.is_closer AND t6 < o.scheduled_end AND NOT (o.actual_out <= t6 AND o.actual_in <= t6)
                  THEN public._labor_close_predict_min(_location_id, o.user_id, o.day_of_week, v_band, o.position, d, true) END AS pos_pred,
             greatest(extract(epoch FROM o.actual_out - t6), 0) AS actual_rem_sec
        FROM o),
    a AS (
      SELECT s.*, (public._labor_smart_close_adjust(
               CASE WHEN s.actual_in <= t6 THEN 'working' ELSE 'not_started' END, s.scheduled_end, t6, s.plain_rem, s.pred)).remaining_sec AS smart_rem,
             (public._labor_smart_close_adjust(
               CASE WHEN s.actual_in <= t6 THEN 'working' ELSE 'not_started' END, s.scheduled_end, t6, s.plain_rem, s.pos_pred)).remaining_sec AS pos_rem
         FROM s)
    SELECT sum(a.w * extract(epoch FROM greatest(least(a.actual_out, t6) - a.actual_in, interval '0')) / 3600) AS worked,
           sum(a.w * a.plain_rem / 3600) AS plain_rem, sum(a.w * a.smart_rem / 3600) AS smart_rem,
           sum(a.w * a.pos_rem / 3600) AS pos_rem,
           sum(a.w * extract(epoch FROM a.actual_out - a.actual_in) / 3600) AS actual,
           count(*) FILTER (WHERE a.pred IS NOT NULL) AS closers,
           count(*) FILTER (WHERE a.pred IS NOT NULL AND a.prior_closes < 10) AS new_closers,
           avg(abs(a.smart_rem - a.actual_rem_sec) / 60) FILTER (WHERE a.pred IS NOT NULL AND a.prior_closes < 10) AS new_miss_smart_min,
           avg(abs(a.pos_rem - a.actual_rem_sec) / 60) FILTER (WHERE a.pred IS NOT NULL AND a.prior_closes < 10) AS new_miss_pos_min
      INTO r FROM a;
    CONTINUE WHEN r.actual IS NULL OR r.actual = 0;
    v_nights := v_nights || jsonb_build_object('date', d, 'sales_pace_at', round(v_pace, 2), 'final_sales', v_net,
      'plain_pct', round((r.worked + r.plain_rem) / v_pace * 100, 2), 'smart_pct', round((r.worked + r.smart_rem) / v_pace * 100, 2),
      'pos_pct', round((r.worked + r.pos_rem) / v_pace * 100, 2),
      'actual_pct', round(r.actual / v_net * 100, 2),
      'plain_dollars', round(r.worked + r.plain_rem, 2), 'smart_dollars', round(r.worked + r.smart_rem, 2),
      'pos_dollars', round(r.worked + r.pos_rem, 2),
      'actual_dollars', round(r.actual, 2), 'closers_adjusted', r.closers, 'new_closers', r.new_closers,
      'new_closer_miss_smart_min', round(r.new_miss_smart_min, 1), 'new_closer_miss_pos_min', round(r.new_miss_pos_min, 1));
  END LOOP;
  RETURN jsonb_build_object('location_id', _location_id, 'at', _at, 'nights', jsonb_array_length(v_nights),
    'avg_miss_plain_pct', (SELECT round(avg(abs((n->>'plain_pct')::numeric - (n->>'actual_pct')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_smart_pct', (SELECT round(avg(abs((n->>'smart_pct')::numeric - (n->>'actual_pct')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_pos_pct', (SELECT round(avg(abs((n->>'pos_pct')::numeric - (n->>'actual_pct')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_plain_dollars', (SELECT round(avg(abs((n->>'plain_dollars')::numeric - (n->>'actual_dollars')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_smart_dollars', (SELECT round(avg(abs((n->>'smart_dollars')::numeric - (n->>'actual_dollars')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'avg_miss_pos_dollars', (SELECT round(avg(abs((n->>'pos_dollars')::numeric - (n->>'actual_dollars')::numeric)), 2) FROM jsonb_array_elements(v_nights) n),
    'new_closer_nights', (SELECT count(*) FROM jsonb_array_elements(v_nights) n WHERE (n->>'new_closers')::int > 0),
    'new_closer_avg_miss_smart_min', (SELECT round(avg((n->>'new_closer_miss_smart_min')::numeric), 1) FROM jsonb_array_elements(v_nights) n WHERE n->>'new_closer_miss_smart_min' IS NOT NULL),
    'new_closer_avg_miss_pos_min', (SELECT round(avg((n->>'new_closer_miss_pos_min')::numeric), 1) FROM jsonb_array_elements(v_nights) n WHERE n->>'new_closer_miss_pos_min' IS NOT NULL),
    'detail', v_nights);
END $$;

REVOKE ALL ON FUNCTION public.labor_smart_close_backtest(uuid, int, time) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.labor_smart_close_backtest(uuid, int, time) TO service_role;

-- Scorecard: 4-layer columns + skip stores with no punch data that day.
ALTER TABLE public.labor_pace_scorecard ADD COLUMN pos_pct numeric, ADD COLUMN pos_miss numeric;

CREATE OR REPLACE FUNCTION public.snapshot_labor_pace_scorecard()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_tz text; v_local timestamp; p jsonb; s jsonb; q jsonb; v_n int := 0;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR r IN SELECT l.id FROM public.locations l LOOP
    BEGIN
      CONTINUE WHEN coalesce(public.labor_source_for(r.id), '') NOT IN ('punch_clock', 'toast');
      SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = r.id;
      v_local := now() AT TIME ZONE coalesce(v_tz, 'America/Los_Angeles');
      CONTINUE WHEN extract(hour FROM v_local) <> 18;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.labor_pace_scorecard x WHERE x.location_id = r.id AND x.business_date = public.business_date(r.id));
      p := public._labor_pace_core(r.id, NULL, false);
      CONTINUE WHEN p->>'mode' = 'unavailable' OR p->>'worked_hours' IS NULL;
      s := public._labor_pace_core(r.id, NULL, true, false);
      q := public._labor_pace_core(r.id, NULL, true, true);
      INSERT INTO public.labor_pace_scorecard (location_id, business_date, snapshot_at, smart_close_enabled, sales_pace_at_snapshot,
        plain_pct, smart_pct, pos_pct, smart_close_minutes, closers)
      VALUES (r.id, (p->>'business_date')::date, now(),
        coalesce((SELECT e.enabled FROM public.labor_smart_close_settings e WHERE e.location_id = r.id), false),
        (p->>'sales_pace')::numeric, (p->>'pace_labor_pct')::numeric, (s->>'pace_labor_pct')::numeric,
        (q->>'pace_labor_pct')::numeric,
        (q->>'smart_close_minutes')::int,
        coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', pp->>'user_id', 'name', pp->>'name',
                   'scheduled_end', sh->>'scheduled_end', 'expected_out', sh->>'expected_out'))
                    FROM jsonb_array_elements(q->'people') pp, jsonb_array_elements(pp->'shifts') sh
                    WHERE sh ? 'expected_out'), '[]'::jsonb))
      ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'scorecard snapshot % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $$;

CREATE OR REPLACE FUNCTION public.fill_labor_pace_scorecard()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_src text; v_cost numeric; v_sales numeric; v_pct numeric; v_n int := 0;
BEGIN
  FOR r IN SELECT * FROM public.labor_pace_scorecard x
            WHERE x.filled_at IS NULL AND x.business_date < public.business_date(x.location_id)
              AND x.business_date >= current_date - 14 LOOP
    v_src := public.labor_source_for(r.location_id);
    IF v_src = 'punch_clock' THEN
      SELECT t.cost INTO v_cost FROM public.labor_day_totals(r.location_id, r.business_date, false) t;
    ELSE
      SELECT l.labor_cost INTO v_cost FROM public.labor_cache l
       WHERE l.location_id = r.location_id AND l.labor_date = r.business_date AND l.source = v_src;
    END IF;
    SELECT sc.net_sales INTO v_sales FROM public.sales_cache sc
     WHERE sc.location_id = r.location_id AND sc.sale_date = r.business_date ORDER BY sc.fetched_at DESC NULLS LAST LIMIT 1;
    v_pct := CASE WHEN coalesce(v_sales, 0) > 0 AND v_cost IS NOT NULL THEN round(v_cost / v_sales * 100, 2) END;
    UPDATE public.labor_pace_scorecard x SET
      final_sales = v_sales, final_labor_dollars = round(v_cost, 2), actual_pct = v_pct,
      plain_miss = round(x.plain_pct - v_pct, 2), smart_miss = round(x.smart_pct - v_pct, 2),
      pos_miss = round(x.pos_pct - v_pct, 2),
      closers = coalesce((SELECT jsonb_agg(c || jsonb_build_object('actual_out', o.actual_out,
                  'predicted_vs_actual_min', round(extract(epoch FROM o.actual_out - (c->>'expected_out')::timestamptz) / 60)))
                  FROM jsonb_array_elements(x.closers) c
                  LEFT JOIN LATERAL (SELECT o.actual_out FROM public.labor_shift_outcomes o
                     WHERE o.location_id = x.location_id AND o.business_date = x.business_date
                       AND o.user_id = (c->>'user_id')::uuid AND o.scheduled_end = (c->>'scheduled_end')::timestamptz LIMIT 1) o ON true), '[]'::jsonb),
      filled_at = CASE WHEN v_pct IS NOT NULL THEN now() END
     WHERE x.location_id = r.location_id AND x.business_date = r.business_date;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;