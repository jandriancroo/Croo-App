CREATE TABLE public.labor_pace_scorecard (
  location_id uuid NOT NULL,
  business_date date NOT NULL,
  snapshot_at timestamptz NOT NULL,
  smart_close_enabled boolean NOT NULL,
  sales_pace_at_snapshot numeric,
  plain_pct numeric,
  smart_pct numeric,
  smart_close_minutes int,
  closers jsonb NOT NULL DEFAULT '[]'::jsonb,
  final_sales numeric,
  final_labor_dollars numeric,
  actual_pct numeric,
  plain_miss numeric,
  smart_miss numeric,
  filled_at timestamptz,
  PRIMARY KEY (location_id, business_date)
);
GRANT SELECT ON public.labor_pace_scorecard TO authenticated;
GRANT ALL ON public.labor_pace_scorecard TO service_role;
ALTER TABLE public.labor_pace_scorecard ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Super admin can view labor pace scorecard" ON public.labor_pace_scorecard
  FOR SELECT TO authenticated USING (public.is_super_admin(auth.uid()));

-- 6 PM store time: plain and Smart Close pace side by side (Smart Close computed even when the store is off).
CREATE OR REPLACE FUNCTION public.snapshot_labor_pace_scorecard()
RETURNS int LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE r record; v_tz text; v_local timestamp; p jsonb; s jsonb; v_n int := 0;
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
      s := public._labor_pace_core(r.id, NULL, true);
      CONTINUE WHEN p->>'mode' = 'unavailable';
      INSERT INTO public.labor_pace_scorecard (location_id, business_date, snapshot_at, smart_close_enabled, sales_pace_at_snapshot,
        plain_pct, smart_pct, smart_close_minutes, closers)
      VALUES (r.id, (p->>'business_date')::date, now(),
        coalesce((SELECT e.enabled FROM public.labor_smart_close_settings e WHERE e.location_id = r.id), false),
        (p->>'sales_pace')::numeric, (p->>'pace_labor_pct')::numeric, (s->>'pace_labor_pct')::numeric,
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
END $$;

-- 3 AM cycle: final labor %, misses, and each closer's actual clock-out (after shift outcomes are rebuilt).
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

CREATE OR REPLACE FUNCTION public.get_labor_pace_scorecard(_location_id uuid, _days int DEFAULT 30)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF _location_id IS NULL OR coalesce(_days, 0) < 1 OR _days > 400 THEN RAISE EXCEPTION 'invalid input' USING ERRCODE = '22023'; END IF;
  IF NOT (coalesce(auth.role(), '') = 'service_role' OR coalesce(v_uid IS NOT NULL AND public.has_role_or_higher(v_uid, 'shift_manager')
          AND (public.is_super_admin(v_uid) OR public.has_location_access(v_uid, _location_id)
               OR public.has_brand_access_via_location(v_uid, _location_id)), false)) THEN
    RAISE EXCEPTION 'permission denied' USING ERRCODE = '42501';
  END IF;
  RETURN (SELECT coalesce(jsonb_agg(to_jsonb(x) ORDER BY x.business_date DESC), '[]'::jsonb)
            FROM public.labor_pace_scorecard x
           WHERE x.location_id = _location_id AND x.business_date >= public.business_date(_location_id) - _days);
END $$;

-- Nightly fill runs right after the habits rebuild.
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
  BEGIN
    v_out := v_out || jsonb_build_object('scorecard_filled', public.fill_labor_pace_scorecard());
  EXCEPTION WHEN OTHERS THEN
    v_out := v_out || jsonb_build_object('scorecard_error', SQLERRM);
  END;
  RETURN v_out;
END $$;

REVOKE ALL ON FUNCTION public.snapshot_labor_pace_scorecard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.fill_labor_pace_scorecard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.get_labor_pace_scorecard(uuid, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_labor_pace_scorecard(uuid, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.snapshot_labor_pace_scorecard(), public.fill_labor_pace_scorecard(),
  public.get_labor_pace_scorecard(uuid, int) TO service_role;

INSERT INTO public.data_point_registry (key, label, category, unit, description, canonical_table, sources, refresh_cadence, readers, sot_status, notes)
VALUES ('labor_pace_scorecard', 'Labor pace scorecard', 'labor', 'pct',
  '6 PM plain vs Smart Close labor pace, final labor %, misses, closers predicted vs actual out', 'labor_pace_scorecard',
  '{"none": {"writer": "snapshot_labor_pace_scorecard / fill_labor_pace_scorecard"}, "toast": {"writer": "snapshot_labor_pace_scorecard / fill_labor_pace_scorecard"}}',
  'hourly check, snapshots at 6 PM store time; filled at 3 AM maintenance', '{"get_labor_pace_scorecard"}', 'single', NULL)
ON CONFLICT (key) DO NOTHING;
