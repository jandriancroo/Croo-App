CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  yesterday_date date := (now() AT TIME ZONE 'America/Los_Angeles')::date - 1;
  supabase_url text;
  service_key text;
BEGIN
  -- 1) Backfill labor for yesterday across every active location
  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'backfill_labor', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true;

  -- 2) Refresh PFG tokens for every PFG-enabled location
  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'refresh_pfg_token', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.location_integrations li
      WHERE li.location_id = l.id AND li.integration_type = 'pfg' AND li.is_active = true
    );

  -- 3) Labor intelligence analysis per active location
  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'labor_intelligence', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true;

  -- 4) Opus bulk extract for OPUS-enabled locations
  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'opus_bulk_extract', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (
      SELECT 1 FROM public.location_integrations li
      WHERE li.location_id = l.id AND li.integration_type = 'opus' AND li.is_active = true
    );

  SELECT decrypted_secret INTO supabase_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'queue_nightly_maintenance: vault credentials missing — bulk inserts ran, HTTP calls skipped';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/vendor-sku-health-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  );

  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/inventory-availability-sweep',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || service_key),
    body := '{}'::jsonb
  );
END;
$function$;