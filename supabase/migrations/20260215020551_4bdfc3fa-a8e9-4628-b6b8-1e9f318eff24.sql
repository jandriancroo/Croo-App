-- Update queue_nightly_maintenance to ONLY handle non-email tasks
-- Email queuing is now handled by queue_nightly_emails()
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_yesterday DATE;
  v_today DATE;
  v_location RECORD;
BEGIN
  v_today := (now() AT TIME ZONE 'America/Los_Angeles')::date;
  v_yesterday := v_today - INTERVAL '1 day';

  FOR v_location IN 
    SELECT id FROM locations WHERE is_active = true
  LOOP
    -- Backfill yesterday's labor cache (always)
    INSERT INTO maintenance_queue (task_type, location_id, target_date)
    VALUES ('backfill_labor', v_location.id, v_yesterday)
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
  END LOOP;
END;
$function$;