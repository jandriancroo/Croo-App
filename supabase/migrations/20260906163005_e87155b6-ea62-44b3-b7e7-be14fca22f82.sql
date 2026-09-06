CREATE OR REPLACE FUNCTION public.mark_labor_cache_stale_and_backfill()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location_id UUID;
  v_timezone TEXT;
  v_new_date DATE;
  v_old_date DATE;
  v_start_date DATE;
  v_end_date DATE;
  v_payload JSONB;
BEGIN
  v_location_id := COALESCE(NEW.location_id, OLD.location_id);

  IF v_location_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT timezone INTO v_timezone
  FROM location_settings
  WHERE location_id = v_location_id
  LIMIT 1;

  v_timezone := COALESCE(v_timezone, 'America/Los_Angeles');

  IF TG_OP = 'DELETE' THEN
    v_new_date := (OLD.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := v_new_date;
  ELSIF TG_OP = 'UPDATE' THEN
    v_new_date := (NEW.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := (OLD.punch_time AT TIME ZONE v_timezone)::DATE;
  ELSE
    v_new_date := (NEW.punch_time AT TIME ZONE v_timezone)::DATE;
    v_old_date := v_new_date;
  END IF;

  v_start_date := LEAST(v_old_date, v_new_date);
  v_end_date := GREATEST(v_old_date, v_new_date);

  UPDATE labor_cache
  SET is_stale = true
  WHERE location_id = v_location_id
    AND labor_date BETWEEN v_start_date AND v_end_date
    AND source = 'punch_clock';

  v_payload := jsonb_build_object(
    'action', 'backfill',
    'locationId', v_location_id::TEXT,
    'startDate', v_start_date::TEXT,
    'endDate', v_end_date::TEXT,
    'forceRefresh', true
  );

  BEGIN
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service',
      headers := public.cron_edge_headers(),
      body := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'mark_labor_cache_stale_and_backfill: net.http_post call failed: %', SQLERRM;
  END;

  RETURN COALESCE(NEW, OLD);
END;
$function$