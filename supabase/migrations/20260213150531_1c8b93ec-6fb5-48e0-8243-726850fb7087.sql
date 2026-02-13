
-- Drop existing trigger (if it only marks is_stale, we'll replace it)
DROP TRIGGER IF EXISTS mark_labor_cache_stale_on_punch_change ON time_punches;

-- Create new trigger that marks stale AND calls labor-service for immediate backfill
CREATE OR REPLACE FUNCTION mark_labor_cache_stale_and_backfill()
RETURNS TRIGGER AS $$
DECLARE
  v_location_id UUID;
  v_labor_date DATE;
  v_timezone TEXT;
  v_url TEXT;
  v_payload JSONB;
BEGIN
  -- Determine location_id and labor_date from the punch record
  v_location_id := COALESCE(NEW.location_id, OLD.location_id);
  
  IF v_location_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  
  -- Get timezone for the location
  SELECT timezone INTO v_timezone
  FROM location_settings
  WHERE location_id = v_location_id
  LIMIT 1;
  
  v_timezone := COALESCE(v_timezone, 'America/Los_Angeles');
  
  -- Determine the labor date in the location's timezone
  v_labor_date := (COALESCE(NEW.punch_time, OLD.punch_time) AT TIME ZONE v_timezone)::DATE;
  
  -- Mark all labor_cache entries for this location+date as stale (for both sources)
  UPDATE labor_cache
  SET is_stale = true
  WHERE location_id = v_location_id
    AND labor_date = v_labor_date;
  
  -- Trigger immediate backfill via labor-service edge function
  -- Build the request payload
  v_payload := jsonb_build_object(
    'action', 'backfill',
    'locationId', v_location_id::TEXT,
    'startDate', v_labor_date::TEXT,
    'endDate', v_labor_date::TEXT,
    'forceRefresh', true
  );
  
  -- Call the labor-service edge function
  -- Note: This is async, so it won't block the punch insert/update
  PERFORM pg_net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.functions.supabase.co/labor-service',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.supabase_service_role_key', true)
    ),
    body := v_payload::TEXT
  );
  
  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;

-- Create trigger on INSERT, UPDATE, DELETE
CREATE TRIGGER mark_labor_cache_stale_and_backfill
AFTER INSERT OR UPDATE OR DELETE ON time_punches
FOR EACH ROW
EXECUTE FUNCTION mark_labor_cache_stale_and_backfill();
