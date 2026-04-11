
CREATE OR REPLACE FUNCTION public.queue_nightly_maintenance()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  supabase_url text;
  service_key text;
BEGIN
  -- Get config
  supabase_url := current_setting('app.settings.supabase_url', true);
  service_key := current_setting('app.settings.service_role_key', true);

  -- If settings aren't available, try from vault
  IF supabase_url IS NULL THEN
    SELECT decrypted_secret INTO supabase_url FROM vault.decrypted_secrets WHERE name = 'supabase_url' LIMIT 1;
  END IF;
  IF service_key IS NULL THEN
    SELECT decrypted_secret INTO service_key FROM vault.decrypted_secrets WHERE name = 'service_role_key' LIMIT 1;
  END IF;

  -- Skip if we can't get credentials
  IF supabase_url IS NULL OR service_key IS NULL THEN
    RAISE LOG 'queue_nightly_maintenance: missing supabase_url or service_role_key, skipping';
    RETURN;
  END IF;

  -- Trigger vendor-sku-health-sync
  PERFORM net.http_post(
    url := supabase_url || '/functions/v1/vendor-sku-health-sync',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );

  RAISE LOG 'queue_nightly_maintenance: vendor-sku-health-sync queued';
END;
$$;
