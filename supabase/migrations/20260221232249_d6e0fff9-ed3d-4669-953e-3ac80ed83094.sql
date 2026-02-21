
CREATE OR REPLACE FUNCTION public.mark_labor_cache_stale_and_backfill()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location_id UUID;
  v_labor_date DATE;
  v_timezone TEXT;
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
  v_labor_date := (COALESCE(NEW.punch_time, OLD.punch_time) AT TIME ZONE v_timezone)::DATE;
  
  UPDATE labor_cache
  SET is_stale = true
  WHERE location_id = v_location_id
    AND labor_date = v_labor_date;
  
  v_payload := jsonb_build_object(
    'action', 'backfill',
    'locationId', v_location_id::TEXT,
    'startDate', v_labor_date::TEXT,
    'endDate', v_labor_date::TEXT,
    'forceRefresh', true
  );
  
  BEGIN
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg'
      ),
      body := v_payload
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE LOG 'mark_labor_cache_stale_and_backfill: net.http_post call failed: %', SQLERRM;
  END;
  
  RETURN COALESCE(NEW, OLD);
END;
$function$;
