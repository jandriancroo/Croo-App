-- Fix nested aggregate in the report summary ordering (ORDER BY min(...) inside jsonb_agg).
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
             ORDER BY y.first_at), '[]'::jsonb)
       FROM (SELECT x.checkpoint, count(*)::int AS n, min(x.snapshot_at) AS first_at,
               round(avg(abs(x.scheduled_miss)), 2) AS a_sched,
               round(avg(abs(x.plain_miss)), 2) AS a_og,
               round(avg(abs(x.smart_miss)), 2) AS a_new
             FROM public.labor_pace_scorecard x
            WHERE x.location_id = _location_id AND x.business_date BETWEEN _from AND _to AND x.filled_at IS NOT NULL
            GROUP BY x.checkpoint) y));
END $$;
REVOKE ALL ON FUNCTION public.get_labor_pace_report(uuid, date, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_labor_pace_report(uuid, date, date) TO authenticated, service_role;