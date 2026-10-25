CREATE OR REPLACE FUNCTION public.snapshot_labor_pace_scorecard()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
                    FROM jsonb_array_elements(s->'people') pp, jsonb_array_elements(pp->'shifts') sh
                    WHERE sh ? 'expected_out'), '[]'::jsonb))
      ON CONFLICT DO NOTHING;
      v_n := v_n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'scorecard snapshot % failed: %', r.id, SQLERRM;
    END;
  END LOOP;
  RETURN v_n;
END $function$;