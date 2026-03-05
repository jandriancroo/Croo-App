
-- =============================================
-- REWRITE queue_nightly_maintenance: FOR loop → set-based
-- =============================================
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_yesterday DATE;
  v_today DATE;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';

  -- Bulk insert labor backfills for ALL active locations (single query)
  INSERT INTO maintenance_queue (task_type, location_id, target_date)
  SELECT 'backfill_labor', id, v_yesterday
  FROM locations
  WHERE is_active = true
  ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

  -- Bulk insert PFG token refreshes for locations with active PFG integration
  INSERT INTO maintenance_queue (task_type, location_id, target_date)
  SELECT 'refresh_pfg_token', li.location_id, v_today
  FROM location_integrations li
  JOIN locations l ON l.id = li.location_id
  WHERE l.is_active = true
    AND li.integration_type = 'pfg'
    AND li.is_active = true
  ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
END;
$function$;

-- =============================================
-- REWRITE queue_nightly_emails: FOR loop → set-based
-- =============================================
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
END;
$function$;
