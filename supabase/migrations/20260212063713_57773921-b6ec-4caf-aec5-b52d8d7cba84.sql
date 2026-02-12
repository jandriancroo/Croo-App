
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_yesterday DATE;
  v_today DATE;
  v_dow INT;
  v_location RECORD;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';
  v_dow := EXTRACT(DOW FROM v_today);

  FOR v_location IN 
    SELECT id FROM locations
  LOOP
    -- Daily summary email (every night, for yesterday)
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('daily_summary', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

    -- Backfill yesterday's labor cache
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('backfill_labor', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

    -- Weekly summary (Monday only)
    IF v_dow = 1 THEN
      INSERT INTO maintenance_queue (task_type, location_id, target_date)
      VALUES ('weekly_summary', v_location.id, v_yesterday)
      ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;
