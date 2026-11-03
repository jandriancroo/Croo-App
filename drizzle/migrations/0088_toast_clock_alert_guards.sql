-- Toast-clock stores: late arrival accepts Toast clock-ins; late/NCNS skipped per store when POS labor feed is stale.
-- Rollback body for check_alerts_sql: scripts/fixtures/check_alerts_sql-before-0088.sql
CREATE OR REPLACE FUNCTION public._pos_clock_feed_fresh(_location_id uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v_src text; v_at timestamptz;
BEGIN
  v_src := public.labor_source_for(_location_id);
  IF v_src IS DISTINCT FROM 'toast' THEN RETURN true; END IF;
  SELECT max(lc.fetched_at) INTO v_at FROM public.labor_cache lc
   WHERE lc.location_id = _location_id AND lc.source = 'toast';
  RETURN v_at IS NOT NULL AND v_at >= now() - interval '30 minutes';
END $$;
REVOKE EXECUTE ON FUNCTION public._pos_clock_feed_fresh(uuid) FROM public, anon, authenticated;

DO $mig$
DECLARE d text; s text; r text;
  pairs text[][] := ARRAY[
    ARRAY[') INTO has_punch;',
          ') OR EXISTS (
          SELECT 1 FROM toast_shifts ts
          WHERE ts.croo_user_id = shift.user_id AND ts.location_id = loc.id
            AND ts.shift_date = local_date::DATE AND ts.in_time IS NOT NULL
        ) INTO has_punch;'],
    ARRAY['      LOOP
        shift_start_minutes := EXTRACT',
          '          AND public._pos_clock_feed_fresh(loc.id)
      LOOP
        shift_start_minutes := EXTRACT'],
    ARRAY['AND NOT COALESCE(ss.is_coverage_only, false)
        LOOP',
          'AND NOT COALESCE(ss.is_coverage_only, false)
            AND public._pos_clock_feed_fresh(loc.id)
        LOOP']];
  i int;
BEGIN
  d := pg_get_functiondef('public.check_alerts_sql()'::regprocedure);
  FOR i IN 1..array_length(pairs, 1) LOOP
    s := pairs[i][1]; r := pairs[i][2];
    IF (length(d) - length(replace(d, s, ''))) / length(s) <> 1 THEN
      RAISE EXCEPTION 'check_alerts_sql snippet % not found exactly once', i;
    END IF;
    d := replace(d, s, r);
  END LOOP;
  EXECUTE d;
END $mig$;

ALTER TABLE public.toast_robot_status ADD COLUMN IF NOT EXISTS labor_alert_stage integer NOT NULL DEFAULT 0;

ALTER FUNCTION public.check_weekly_checklist_alerts_sql() SET search_path = public, pg_temp;
REVOKE EXECUTE ON FUNCTION public.check_weekly_checklist_alerts_sql() FROM public, anon, authenticated;