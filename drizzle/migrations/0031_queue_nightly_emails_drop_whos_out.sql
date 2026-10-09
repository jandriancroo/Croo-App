-- Availability Insights replaces the old "Who's out tomorrow" call. Everything else is unchanged.
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
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';
  v_dow := EXTRACT(DOW FROM v_today);

  INSERT INTO email_queue (
    email_type, location_id, target_date, 
    status, source, subject, html, to_addresses, metadata
  )
  SELECT 
    'daily_summary', l.id, v_yesterday,
    'pending', 'nightly_cron',
    '', '', ARRAY[]::text[], 
    jsonb_build_object('location_name', l.name)
  FROM locations l
  WHERE l.is_active = true
    AND EXISTS (
      SELECT 1 FROM sales_cache sc
      WHERE sc.location_id = l.id
        AND sc.sale_date = v_yesterday
        AND sc.net_sales > 0
    )
  ON CONFLICT (email_type, location_id, target_date) 
    WHERE email_type IS NOT NULL AND location_id IS NOT NULL AND target_date IS NOT NULL AND source != 'test_preview'
  DO NOTHING;

  IF v_dow = 1 THEN
    INSERT INTO email_queue (
      email_type, location_id, target_date,
      status, source, subject, html, to_addresses, metadata
    )
    SELECT 
      'weekly_summary', l.id, v_yesterday,
      'pending', 'nightly_cron',
      '', '', ARRAY[]::text[],
      jsonb_build_object('location_name', l.name)
    FROM locations l
    WHERE l.is_active = true
      AND EXISTS (
        SELECT 1 FROM sales_cache sc
        WHERE sc.location_id = l.id
          AND sc.sale_date = v_yesterday
          AND sc.net_sales > 0
      )
    ON CONFLICT (email_type, location_id, target_date)
      WHERE email_type IS NOT NULL AND location_id IS NOT NULL AND target_date IS NOT NULL AND source != 'test_preview'
    DO NOTHING;
  END IF;
END;
$function$;