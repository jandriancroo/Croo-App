
CREATE OR REPLACE FUNCTION public.oneshot_backfill_qu_pmix()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT li.location_id
    FROM location_integrations li
    WHERE li.integration_type = 'qubeyond' AND li.is_active
  LOOP
    PERFORM net.http_post(
      url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-service?action=sync-dates',
      headers := public.cron_edge_headers(),
      body := jsonb_build_object(
        'locationId', r.location_id,
        'dates', jsonb_build_array('2026-07-31','2026-08-01','2026-08-02','2026-08-03','2026-08-04')
      ),
      timeout_milliseconds := 120000
    );
  END LOOP;

  PERFORM cron.unschedule('oneshot-pmix-backfill');
END;
$$;

REVOKE ALL ON FUNCTION public.oneshot_backfill_qu_pmix() FROM PUBLIC, anon, authenticated;

SELECT cron.schedule('oneshot-pmix-backfill', '* * * * *', $job$ SELECT public.oneshot_backfill_qu_pmix(); $job$);
