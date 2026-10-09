-- One caller for yesterday's QU sales sync (was Task 5 inside maintenance-service).
-- 0 11 UTC = 3 AM PST / 4 AM PDT, same slot as the Clover and Aloha yesterday jobs.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'qubeyond-sync-yesterday-3am-pst') THEN
    PERFORM cron.unschedule('qubeyond-sync-yesterday-3am-pst');
  END IF;
  PERFORM cron.schedule(
    'qubeyond-sync-yesterday-3am-pst',
    '0 11 * * *',
    $cmd$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/sales-service?action=sync-yesterday',
    headers := public.cron_edge_headers(),
    body := '{}'::jsonb
  ) AS request_id;
$cmd$
  );
END $$;