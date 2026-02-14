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
  v_has_sales BOOLEAN;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';
  v_dow := EXTRACT(DOW FROM v_today);

  FOR v_location IN 
    SELECT id FROM locations
  LOOP
    -- Check if location has sales data for yesterday
    SELECT EXISTS (
      SELECT 1 FROM sales_cache
      WHERE location_id = v_location.id
        AND sale_date = v_yesterday
        AND net_sales > 0
    ) INTO v_has_sales;

    -- Daily summary email ONLY if location had sales
    IF v_has_sales THEN
      INSERT INTO maintenance_queue (task_type, location_id, target_date)
      VALUES ('daily_summary', v_location.id, v_yesterday)
      ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
    END IF;

    -- Backfill yesterday's labor cache (always, regardless of sales)
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('backfill_labor', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

    -- Weekly summary (Monday only, also only if location had any sales that week)
    IF v_dow = 1 THEN
      INSERT INTO maintenance_queue (task_type, location_id, target_date)
      VALUES ('weekly_summary', v_location.id, v_yesterday)
      ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
    END IF;
  END LOOP;
END;
$$;