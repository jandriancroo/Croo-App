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

  -- Bulk insert daily summaries for locations with sales yesterday
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

  -- Bulk insert weekly summaries on Mondays
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

  -- Who's out tomorrow (one email per store). Never blocks the summaries above.
  BEGIN
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/whos-out-email',
      headers := public.cron_edge_headers(),
      body := '{"action":"run_nightly"}'::jsonb,
      timeout_milliseconds := 5000
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'whos-out nightly call failed: %', SQLERRM;
  END;
END;
$function$;