-- Drop the old broken cron that sends empty body
SELECT cron.unschedule('pfg-keep-alive-every-8h');

-- Create a proper DB function that refreshes ALL PFG locations
CREATE OR REPLACE FUNCTION public.refresh_all_pfg_tokens()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_location RECORD;
BEGIN
  FOR v_location IN
    SELECT li.location_id
    FROM location_integrations li
    WHERE li.integration_type = 'pfg'
      AND li.is_active = true
  LOOP
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/pfg-service?action=refresh_keep_alive',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imxtb2RlaXlycHd2Z3lxY3Zqa2pyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjM5MTIyODYsImV4cCI6MjA3OTQ4ODI4Nn0.h2MYYJ3CQh6mEF5sWsRY_tttuZCv_8WOKjnTvnHaChg'
      ),
      body := jsonb_build_object('locationId', v_location.location_id)
    );
    
    RAISE LOG '[PFG Keep-Alive] Queued refresh for location %', v_location.location_id;
  END LOOP;
END;
$$;

-- Schedule every 30 minutes to handle PFG's short token lifetimes
SELECT cron.schedule(
  'pfg-keep-alive-every-30m',
  '*/30 * * * *',
  $$SELECT public.refresh_all_pfg_tokens()$$
);