CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Bulk insert labor intelligence analysis for ALL active locations
  INSERT INTO maintenance_queue (task_type, location_id, target_date)
  SELECT 'labor_intelligence', id, v_yesterday
  FROM locations
  WHERE is_active = true
  ON CONFLICT (task_type, location_id, target_date) DO NOTHING;

  -- Bulk extract OPUS training documents for all active locations
  INSERT INTO maintenance_queue (task_type, location_id, target_date)
  SELECT 'opus_bulk_extract', id, v_today
  FROM locations
  WHERE is_active = true
  ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
END;
$$;