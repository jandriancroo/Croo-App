-- New simplified function: queues email jobs directly into email_queue
-- Runs at 3 AM PST, inserts one row per active location with sales
CREATE OR REPLACE FUNCTION public.queue_nightly_emails()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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
    SELECT id, name FROM locations WHERE is_active = true
  LOOP
    -- Check if location had sales yesterday
    SELECT EXISTS (
      SELECT 1 FROM sales_cache
      WHERE location_id = v_location.id
        AND sale_date = v_yesterday
        AND net_sales > 0
    ) INTO v_has_sales;

    -- Queue daily summary email if location had sales
    IF v_has_sales THEN
      INSERT INTO email_queue (
        email_type, location_id, target_date, 
        status, source, subject, html, to_addresses, metadata
      )
      VALUES (
        'daily_summary', v_location.id, v_yesterday,
        'pending', 'nightly_cron',
        '', '', ARRAY[]::text[], 
        jsonb_build_object('location_name', v_location.name)
      )
      ON CONFLICT (email_type, location_id, target_date) 
        WHERE email_type IS NOT NULL AND location_id IS NOT NULL AND target_date IS NOT NULL AND source != 'test_preview'
      DO NOTHING;
    END IF;

    -- Queue weekly summary on Monday (for prior week Sun)
    IF v_dow = 1 AND v_has_sales THEN
      INSERT INTO email_queue (
        email_type, location_id, target_date,
        status, source, subject, html, to_addresses, metadata
      )
      VALUES (
        'weekly_summary', v_location.id, v_yesterday,
        'pending', 'nightly_cron',
        '', '', ARRAY[]::text[],
        jsonb_build_object('location_name', v_location.name)
      )
      ON CONFLICT (email_type, location_id, target_date)
        WHERE email_type IS NOT NULL AND location_id IS NOT NULL AND target_date IS NOT NULL AND source != 'test_preview'
      DO NOTHING;
    END IF;
  END LOOP;
END;
$function$;