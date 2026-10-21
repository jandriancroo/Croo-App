-- Labor pace scorecard: five daily checkpoints (11 AM, 2 PM, 5 PM, 7 PM, 9 PM store time),
-- scheduled-vs-pace-vs-ending columns, and one reporting function. Additive; no existing labor function touched.

-- 1) Table: checkpoint becomes part of the key; existing rows keep their 6 PM label.
ALTER TABLE public.labor_pace_scorecard
  ADD COLUMN checkpoint text NOT NULL DEFAULT '6 PM',
  ADD COLUMN scheduled_pct numeric,
  ADD COLUMN scheduled_dollars numeric,
  ADD COLUMN scheduled_miss numeric,
  ADD COLUMN plain_dollars numeric,
  ADD COLUMN smart_dollars numeric;
ALTER TABLE public.labor_pace_scorecard DROP CONSTRAINT labor_pace_scorecard_pkey;
ALTER TABLE public.labor_pace_scorecard ADD PRIMARY KEY (location_id, business_date, checkpoint);

-- 2) Scheduled labor for a day: posted schedule hours minus required unpaid breaks, at each person's wage
-- (same shift filters, break rule and wage fallback as the labor pace core).
CREATE OR REPLACE FUNCTION public._labor_scheduled_labor(_location_id uuid, _date date)
RETURNS TABLE(dollars numeric, pct numeric) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_goal numeric;
BEGIN
  v_goal := public._resolve_goal(_location_id, _date);
  RETURN QUERY
  WITH sh AS (
    SELECT ss.user_id,
           extract(epoch FROM (( (_date + ss.end_time) + CASE WHEN ss.end_time <= ss.start_time THEN interval '1 day' ELSE interval '0' END)
                               - (_date + ss.start_time))) / 3600 AS gross_h
      FROM public.scheduled_shifts ss
      JOIN public.schedules s ON s.id = ss.schedule_id AND s.location_id = _location_id
     WHERE ss.shift_date = _date AND ss.user_id IS NOT NULL
       AND NOT coalesce(ss.is_time_off, false) AND NOT coalesce(ss.is_phantom, false)
       AND NOT coalesce(ss.is_coverage_only, false)
       AND ss.start_time IS NOT NULL AND ss.end_time IS NOT NULL
  ),
  per AS (
    SELECT sh.user_id,
           greatest(sh.gross_h - public._labor_pace_break_owed_sec(_location_id, sh.gross_h) / 3600, 0) AS paid_h,
           coalesce((SELECT wh.hourly_wage FROM public.wage_history wh
              WHERE wh.user_id = sh.user_id AND wh.effective_date <= _date AND wh.hourly_wage IS NOT NULL
              ORDER BY wh.effective_date DESC, wh.created_at DESC, wh.id DESC LIMIT 1),
             pf.hourly_wage) AS wage
      FROM sh JOIN public.profiles pf ON pf.id = sh.user_id
  )
  SELECT round(coalesce(sum(per.paid_h * per.wage), 0), 2),
         CASE WHEN coalesce(v_goal, 0) > 0 THEN round(coalesce(sum(per.paid_h * per.wage), 0) / v_goal * 100, 2) END
    FROM per;
END $$;

-- 3) Snapshot: one row per checkpoint per store per day. The hourly cron calls this; the function
-- snapshots only when the store's local hour is a checkpoint hour. Stores with no punch data are skipped.
CREATE OR REPLACE FUNCTION public.snapshot_labor_pace_scorecard()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_tz text; v_local timestamp; v_hour int; v_cp text; p jsonb; s jsonb; q jsonb; v_n int := 0; v_sched record;
BEGIN
  PERFORM set_config('request.jwt.claims', '{"role":"service_role"}', true);
  FOR r IN SELECT l.id FROM public.locations l LOOP
    BEGIN
      CONTINUE WHEN coalesce(public.labor_source_for(r.id), '') NOT IN ('punch_clock', 'toast');
      SELECT ls.timezone INTO v_tz FROM public.location_settings ls WHERE ls.location_id = r.id;
      v_local := now() AT TIME ZONE coalesce(v_tz, 'America/Los_Angeles');
      v_hour := extract(hour FROM v_local)::int;
      CONTINUE WHEN v_hour NOT IN (11, 14, 17, 19, 21);
      v_cp := CASE v_hour WHEN 11 THEN '11 AM' WHEN 14 THEN '2 PM' WHEN 17 THEN '5 PM' WHEN 19 THEN '7 PM' ELSE '9 PM' END;
      CONTINUE WHEN EXISTS (SELECT 1 FROM public.labor_pace_scorecard x
                             WHERE x.location_id = r.id AND x.business_date = public.business_date(r.id) AND x.checkpoint = v_cp);
      p := public._labor_pace_core(r.id, NULL, false);
      CONTINUE WHEN p->>'mode' = 'unavailable' OR p->>'worked_hours' IS NULL;
      s := public._labor_pace_core(r.id, NULL, true);
      q := public._labor_pace_core(r.id, NULL, true, true);
      SELECT * INTO v_sched FROM public._labor_scheduled_labor(r.id, (p->>'business_date')::date);
      INSERT INTO public.labor_pace_scorecard (location_id, business_date, checkpoint, snapshot_at, smart_close_enabled, sales_pace_at_snapshot,
        scheduled_pct, scheduled_dollars, plain_pct, plain_dollars, smart_pct, smart_dollars, pos_pct, smart_close_minutes, closers)
      VALUES (r.id, (p->>'business_date')::date, v_cp, now(),
        coalesce((SELECT e.enabled FROM public.labor_smart_close_settings e WHERE e.location_id = r.id), false),
        (p->>'sales_pace')::numeric, v_sched.pct, v_sched.dollars,
        (p->>'pace_labor_pct')::numeric, (p->>'pace_labor_dollars')::numeric,
        (s->>'pace_labor_pct')::numeric, (s->>'pace_labor_dollars')::numeric,
        (q->>'pace_labor_pct')::numeric,
        (s->>'smart_close_minutes')::int,
        coalesce((SELECT jsonb_agg(jsonb_build_object('user_id', pp->>'user_id', 'name', pp->>'name',
                   'scheduled_end', sh->>'scheduled_end', 'expected_out', sh->>'expected_out'))
                    FROM jsonb_array_elements(s->'people') pp, jsonb_array_elements(pp->>'shifts') sh
                    WHERE sh ? 'expected_out'), '[]'::jsonb))
      ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'scorecard snapshot % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $$;

-- 4) 3 AM fill: same as before plus the scheduled miss; keyed by checkpoint now.
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
      scheduled_miss = round(x.scheduled_pct - v_pct, 2),
      plain_miss = round(x.plain_pct - v_pct, 2), smart_miss = round(x.smart_pct - v_pct, 2),
      pos_miss = round(x.pos_pct - v_pct, 2),
      closers = coalesce((SELECT jsonb_agg(c || jsonb_build_object('actual_out', o.actual_out,
                  'predicted_vs_actual_min', round(extract(epoch FROM o.actual_out - (c->>'expected_out')::timestamptz) / 60)))
                  FROM jsonb_array_elements(x.closers) c
                  LEFT JOIN LATERAL (SELECT o.actual_out FROM public.labor_shift_outcomes o
                     WHERE o.location_id = x.location_id AND o.business_date = x.business_date
                       AND o.user_id = (c->>'user_id')::uuid AND o.scheduled_end = (c->>'scheduled_end')::timestamptz LIMIT 1) o ON true), '[]'::jsonb),
      filled_at = CASE WHEN v_pct IS NOT NULL THEN now() END
     WHERE x.location_id = r.location_id AND x.business_date = r.business_date AND x.checkpoint = r.checkpoint;
    v_n := v_n + 1;
  END LOOP;
  RETURN v_n;
END $$;

-- 5) Reporting: one row per day per checkpoint, plus per-checkpoint average absolute misses. Same gate as get_labor_pace.
CREATE OR REPLACE FUNCTION public.get_labor_pace_report(_location_id uuid, _from date, _to date)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF _location_id IS NULL OR _from IS NULL OR _to IS NULL OR _from > _to OR _to - _from > 400 THEN
    RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023';
  END IF;
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR coalesce(v_uid IS NOT NULL AND public.has_role_or_higher(v_uid, 'shift_manager')
           AND (public.is_super_admin(v_uid) OR public.has_location_access(v_uid, _location_id)
               OR public.has_brand_access_via_location(v_uid, _location_id)), false)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'rows', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'business_date', x.business_date, 'checkpoint', x.checkpoint,
               'scheduled_pct', x.scheduled_pct, 'scheduled_dollars', x.scheduled_dollars,
               'og_pct', x.plain_pct, 'og_dollars', x.plain_dollars,
               'new_pct', x.smart_pct, 'new_dollars', x.smart_dollars,
               'ending_pct', x.actual_pct, 'ending_dollars', x.final_labor_dollars,
               'scheduled_miss', x.scheduled_miss, 'og_miss', x.plain_miss, 'new_miss', x.smart_miss,
               'closers', x.closers) ORDER BY x.business_date, x.snapshot_at), '[]'::jsonb)
       FROM public.labor_pace_scorecard x
      WHERE x.location_id = _location_id AND x.business_date BETWEEN _from AND _to),
    'summary', (SELECT coalesce(jsonb_agg(jsonb_build_object(
               'checkpoint', y.checkpoint, 'days', y.n,
               'avg_abs_scheduled_miss', y.a_sched, 'avg_abs_og_miss', y.a_og, 'avg_abs_new_miss', y.a_new)
             ORDER BY min(y.first_at)), '[]'::jsonb)
       FROM (SELECT x.checkpoint, count(*)::int AS n, min(x.snapshot_at) AS first_at,
               round(avg(abs(x.scheduled_miss)), 2) AS a_sched,
               round(avg(abs(x.plain_miss)), 2) AS a_og,
               round(avg(abs(x.smart_miss)), 2) AS a_new
             FROM public.labor_pace_scorecard x
            WHERE x.location_id = _location_id AND x.business_date BETWEEN _from AND _to AND x.filled_at IS NOT NULL
            GROUP BY x.checkpoint) y));
END $$;

REVOKE ALL ON FUNCTION public._labor_scheduled_labor(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_labor_pace_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public._labor_scheduled_labor(uuid, date),
  public.snapshot_labor_pace_scorecard(), public.fill_labor_pace_scorecard() TO service_role;
GRANT EXECUTE ON FUNCTION public.get_labor_pace_report(uuid, date, date) TO authenticated, service_role;

UPDATE public.data_point_registry
   SET description = 'Checkpoints (11 AM, 2 PM, 5 PM, 7 PM, 9 PM store time): scheduled vs plain vs Smart Close labor pace, final labor %, misses, closers predicted vs actual out',
       refresh_cadence = 'hourly check, snapshots at the five checkpoint hours store time; filled at 3 AM maintenance',
       readers = '{"get_labor_pace_report"}'
 WHERE key = 'labor_pace_scorecard';