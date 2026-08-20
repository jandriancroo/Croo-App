CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  yesterday_date date := (now() AT TIME ZONE 'America/Los_Angeles')::date - 1;
  today_dow int := EXTRACT(DOW FROM (now() AT TIME ZONE 'America/Los_Angeles')::date);
  supabase_url text;
  service_key text;
BEGIN
  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'backfill_labor', l.id, yesterday_date, 'pending'
  FROM public.locations l WHERE l.is_active = true;

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'refresh_pfg_token', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'pfg' AND li.is_active = true);

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status, created_at)
  SELECT 'sync_pfg_orders', l.id, yesterday_date, 'pending', now() + interval '1 second'
  FROM public.locations l
  WHERE l.is_active = true AND COALESCE(l.inventory_enabled, false) = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'pfg' AND li.is_active = true);

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status, created_at)
  SELECT 'sync_pfg_invoices', l.id, yesterday_date, 'pending', now() + interval '2 seconds'
  FROM public.locations l
  WHERE l.is_active = true AND COALESCE(l.inventory_enabled, false) = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'pfg' AND li.is_active = true);

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'labor_intelligence', l.id, yesterday_date, 'pending'
  FROM public.locations l WHERE l.is_active = true;

  -- Weekly logbook summary entry (Mondays only, mirrors the weekly pulse email queue)
  IF today_dow = 1 THEN
    INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status, created_at)
    SELECT 'weekly_summary', l.id, yesterday_date, 'pending', now() + interval '3 seconds'
    FROM public.locations l
    WHERE l.is_active = true
      AND NOT EXISTS (
        SELECT 1 FROM public.maintenance_queue mq
        WHERE mq.location_id = l.id AND mq.task_type = 'weekly_summary' AND mq.target_date = yesterday_date
      );
  END IF;

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'opus_bulk_extract', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'opus' AND li.is_active = true);

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'backfill_clover_sales', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'clover' AND li.is_active = true)
    AND (SELECT COUNT(*) FROM public.sales_cache sc WHERE sc.location_id = l.id AND sc.pos_source = 'clover') < 371
    AND NOT EXISTS (SELECT 1 FROM public.maintenance_queue mq WHERE mq.location_id = l.id AND mq.task_type = 'backfill_clover_sales' AND mq.status IN ('pending','running'));

  INSERT INTO public.maintenance_queue (task_type, location_id, target_date, status)
  SELECT 'backfill_aloha_sales', l.id, yesterday_date, 'pending'
  FROM public.locations l
  WHERE l.is_active = true
    AND EXISTS (SELECT 1 FROM public.location_integrations li WHERE li.location_id = l.id AND li.integration_type = 'aloha' AND li.is_active = true)
    AND (SELECT COUNT(*) FROM public.sales_cache sc WHERE sc.location_id = l.id AND sc.pos_source = 'aloha') < 371
    AND NOT EXISTS (SELECT 1 FROM public.maintenance_queue mq WHERE mq.location_id = l.id AND mq.task_type = 'backfill_aloha_sales' AND mq.status IN ('pending','running'));

  SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key';

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