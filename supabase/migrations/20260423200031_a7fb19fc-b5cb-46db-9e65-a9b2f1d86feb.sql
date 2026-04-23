CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_key text;
  v_yesterday DATE;
  v_location RECORD;
BEGIN
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  IF supabase_url IS NULL THEN
    SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  END IF;

  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;

  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE LOG 'queue_nightly_maintenance: missing credentials, skipping';
    RETURN;
  END IF;

  -- Existing: vendor-sku-health-sync
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/vendor-sku-health-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  RAISE LOG 'queue_nightly_maintenance: vendor-sku-health-sync queued';

  -- RESTORED: Queue backfill_labor for yesterday for every active location
  v_yesterday := (now() AT TIME ZONE 'America/Los_Angeles')::date - INTERVAL '1 day';

  FOR v_location IN
    SELECT id FROM locations WHERE is_active = true
  LOOP
    INSERT INTO maintenance_queue (task_type, location_id, target_date, status)
    VALUES ('backfill_labor', v_location.id, v_yesterday, 'pending')
    ON CONFLICT (task_type, location_id, target_date) DO NOTHING;
  END LOOP;
  RAISE LOG 'queue_nightly_maintenance: backfill_labor queued for all active locations';

  -- NEW: Call labor-service refresh-stale to heal any rows marked stale by auto-punch-out
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/labor-service?action=refresh-stale',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
  RAISE LOG 'queue_nightly_maintenance: labor-service refresh-stale queued';
END;
$$;

COMMENT ON FUNCTION public.queue_nightly_maintenance() IS 'Nightly maintenance function that queues vendor-sku-health-sync, backfill_labor for all active locations, and labor-service refresh-stale';

-- Ensure the maintenance_queue table has the unique constraint needed for ON CONFLICT
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes 
    WHERE indexname = 'maintenance_queue_unique_task'
  ) THEN
    CREATE UNIQUE INDEX maintenance_queue_unique_task 
    ON maintenance_queue (task_type, location_id, target_date) 
    WHERE target_date IS NOT NULL;
  END IF;
END $$;

COMMENT ON INDEX maintenance_queue_unique_task IS 'Unique constraint to prevent duplicate maintenance tasks for the same location and date';