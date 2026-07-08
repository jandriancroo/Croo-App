-- Aloha (BWW GO) raw sales cache — twin of clover_sales_cache
CREATE TABLE public.aloha_sales_cache (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id UUID NOT NULL,
  sale_date DATE NOT NULL,
  net_sales NUMERIC NOT NULL DEFAULT 0,
  guest_count INTEGER NOT NULL DEFAULT 0,
  avg_ticket NUMERIC NOT NULL DEFAULT 0,
  hourly_data JSONB NOT NULL DEFAULT '[]'::jsonb,
  projected_sales NUMERIC,
  validation_status TEXT,
  validation_attempts INTEGER NOT NULL DEFAULT 0,
  flagged_no_sales BOOLEAN NOT NULL DEFAULT false,
  yoy_sale_date DATE,
  yoy_net_sales NUMERIC,
  yoy_hourly_data JSONB,
  payments_data JSONB,
  living_projection NUMERIC,
  override_projection NUMERIC,
  override_at TIMESTAMPTZ,
  override_by UUID,
  initial_projection NUMERIC,
  product_mix JSONB,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT aloha_sales_cache_location_date_uniq UNIQUE (location_id, sale_date)
);

CREATE INDEX aloha_sales_cache_location_date_idx
  ON public.aloha_sales_cache (location_id, sale_date DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.aloha_sales_cache TO authenticated;
GRANT ALL ON public.aloha_sales_cache TO service_role;

ALTER TABLE public.aloha_sales_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view aloha sales for their locations"
ON public.aloha_sales_cache FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = aloha_sales_cache.location_id));

CREATE POLICY "Users can insert aloha sales for their locations"
ON public.aloha_sales_cache FOR INSERT TO authenticated
WITH CHECK (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = aloha_sales_cache.location_id));

CREATE POLICY "Users can update aloha sales for their locations"
ON public.aloha_sales_cache FOR UPDATE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = aloha_sales_cache.location_id))
WITH CHECK (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = aloha_sales_cache.location_id));

CREATE POLICY "Users can delete aloha sales for their locations"
ON public.aloha_sales_cache FOR DELETE TO authenticated
USING (EXISTS (SELECT 1 FROM public.user_locations ul WHERE ul.user_id = auth.uid() AND ul.location_id = aloha_sales_cache.location_id));

-- Extend nightly maintenance to also queue Aloha backfill for BWW GO locations
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

  -- Aloha (BWW GO) backfill — mirrors Clover: 53 weeks (371 days) of history
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