-- ============================================================================
-- FIX: queue_nightly_maintenance() — restore bulk inserts, gate only HTTP
-- ============================================================================
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  yesterday_date date := (now() AT TIME ZONE 'America/Los_Angeles')::date - 1;
  supabase_url text;
  service_key text;
BEGIN
  -- ============================================================
  -- BULK INSERTS — RUN UNCONDITIONALLY (no credential gating)
  -- These are pure DB writes; they don't need vault secrets.
  -- ============================================================

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
      WHERE li.location_id = l.id AND li.provider = 'pfg' AND li.is_active = true
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
      WHERE li.location_id = l.id AND li.provider = 'opus' AND li.is_active = true
    );

  -- ============================================================
  -- HTTP CALLS — GATED ON VAULT CREDENTIALS
  -- Only these need supabase_url + service_role_key.
  -- ============================================================
  SELECT decrypted_secret INTO supabase_url
  FROM vault.decrypted_secrets WHERE name = 'supabase_url';
  SELECT decrypted_secret INTO service_key
  FROM vault.decrypted_secrets WHERE name = 'service_role_key';

  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE WARNING 'queue_nightly_maintenance: vault credentials missing (supabase_url/service_role_key) — bulk inserts ran, but HTTP calls (vendor-sku-health-sync, inventory-availability-sweep) skipped';
    RETURN;
  END IF;

  -- Vendor SKU health sync (one call, brand-wide)
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/vendor-sku-health-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );

  -- Inventory availability sweep (one call, all locations)
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/inventory-availability-sweep',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || service_key
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- ============================================================================
-- AUTO SUPPORT TICKET ON PERMANENT MAINTENANCE FAILURE
-- Fires when a task exhausts retries (status flips to 'error', retry_count >= 3)
-- Skips refresh_pfg_token because the edge function already creates a ticket
-- for that case (avoids duplicates).
-- ============================================================================
CREATE OR REPLACE FUNCTION public.notify_maintenance_failure()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  super_admin_id uuid;
  location_name text;
BEGIN
  -- Only act when transitioning into a permanently-failed state
  IF NEW.status <> 'error' OR NEW.retry_count < 3 THEN
    RETURN NEW;
  END IF;

  IF OLD.status = 'error' THEN
    RETURN NEW; -- already handled
  END IF;

  -- PFG already gets its own ticket from the edge function — skip to avoid dupes
  IF NEW.task_type = 'refresh_pfg_token' THEN
    RETURN NEW;
  END IF;

  SELECT user_id INTO super_admin_id
  FROM public.user_roles
  WHERE role = 'super_admin'
  LIMIT 1;

  IF super_admin_id IS NULL THEN
    RAISE WARNING 'notify_maintenance_failure: no super_admin found, skipping ticket';
    RETURN NEW;
  END IF;

  SELECT name INTO location_name
  FROM public.locations
  WHERE id = NEW.location_id;

  INSERT INTO public.support_tickets (
    user_id,
    category,
    description,
    occurrence_time
  ) VALUES (
    super_admin_id,
    'data_sync_issues',
    format(
      '%s — System Alert: nightly maintenance task "%s" failed after %s retries for target date %s.%sError: %s',
      COALESCE(location_name, 'Unknown location'),
      NEW.task_type,
      NEW.retry_count,
      COALESCE(NEW.target_date::text, 'n/a'),
      E'\n\n',
      COALESCE(NEW.error_message, 'no error message captured')
    ),
    now()
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_notify_maintenance_failure ON public.maintenance_queue;

CREATE TRIGGER trg_notify_maintenance_failure
AFTER UPDATE ON public.maintenance_queue
FOR EACH ROW
WHEN (NEW.status = 'error')
EXECUTE FUNCTION public.notify_maintenance_failure();