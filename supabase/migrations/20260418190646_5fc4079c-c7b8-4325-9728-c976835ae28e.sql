-- 1. Add per-location keep-alive interval to location_integrations
-- Default 5 min preserves current behavior; Hemet will get 30
ALTER TABLE public.location_integrations
  ADD COLUMN IF NOT EXISTS pfg_keep_alive_minutes integer NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS pfg_last_keep_alive_at timestamptz,
  ADD COLUMN IF NOT EXISTS pfg_auto_revert_on_failure boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.location_integrations.pfg_keep_alive_minutes IS 'Minimum minutes between PFG token keep-alive refreshes. Default 5. Increase for experiments.';
COMMENT ON COLUMN public.location_integrations.pfg_last_keep_alive_at IS 'Timestamp of last keep-alive refresh attempt (success or failure). Used by refresh_all_pfg_tokens() to throttle.';
COMMENT ON COLUMN public.location_integrations.pfg_auto_revert_on_failure IS 'If true, on ropc_failed the keep-alive handler resets pfg_keep_alive_minutes to 5 (used during cadence experiments).';

-- 2. Modify refresh_all_pfg_tokens to honor per-location interval
CREATE OR REPLACE FUNCTION public.refresh_all_pfg_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_location RECORD;
BEGIN
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
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg'
      ),
      body := jsonb_build_object('locationId', v_location.location_id)
    );

    RAISE LOG '[PFG Keep-Alive] Queued refresh for location % (interval % min)', v_location.location_id, v_location.pfg_keep_alive_minutes;
  END LOOP;
END;
$function$;

-- 3. Set Hemet to 30-min experimental cadence with auto-revert safety net
UPDATE public.location_integrations
SET pfg_keep_alive_minutes = 30,
    pfg_auto_revert_on_failure = true
WHERE location_id = '12c977c7-1786-4131-90f5-1eef3f96e2c6'
  AND integration_type = 'pfg';