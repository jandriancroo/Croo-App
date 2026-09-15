CREATE OR REPLACE FUNCTION public.refresh_all_pfg_tokens()
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_location RECORD;
  v_headers jsonb;
BEGIN
  -- Resolve credentials the same way every other scheduled caller does
  -- (vault-backed service role key), instead of a hardcoded anon key.
  BEGIN
    v_headers := public.cron_edge_headers();
  EXCEPTION WHEN OTHERS THEN
    v_headers := NULL;
  END;

  IF v_headers IS NULL OR v_headers->>'Authorization' IS NULL
     OR v_headers->>'Authorization' = 'Bearer ' THEN
    RAISE LOG '[PFG Keep-Alive] Aborted: no service credential available';
    RETURN;
  END IF;

  FOR v_location IN
    SELECT li.location_id, li.id AS integration_id, li.pfg_keep_alive_minutes, li.pfg_last_keep_alive_at
    FROM location_integrations li
    WHERE li.integration_type = 'pfg'
      AND li.is_active = true
  LOOP
    -- Throttle: skip if last refresh was within the per-location interval
    IF v_location.pfg_last_keep_alive_at IS NOT NULL
       AND v_location.pfg_last_keep_alive_at > now() - (v_location.pfg_keep_alive_minutes || ' minutes')::interval THEN
      RAISE LOG '[PFG Keep-Alive] Throttled location % (next refresh in % min interval)', v_location.location_id, v_location.pfg_keep_alive_minutes;
      CONTINUE;
    END IF;

    -- Stamp before firing so concurrent cron tick doesn't double-queue
    UPDATE location_integrations
    SET pfg_last_keep_alive_at = now()
    WHERE id = v_location.integration_id;

    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/pfg-service?action=refresh_keep_alive',
      headers := v_headers,
      body := jsonb_build_object('locationId', v_location.location_id)
    );

    RAISE LOG '[PFG Keep-Alive] Queued refresh for location % (interval % min)', v_location.location_id, v_location.pfg_keep_alive_minutes;
  END LOOP;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.refresh_all_pfg_tokens() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.refresh_all_pfg_tokens() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.refresh_all_pfg_tokens() TO service_role;