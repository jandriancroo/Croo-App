select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'nightly-labor-maintenance'),
  command := $cmd$
  SELECT net.http_post(
    url := 'https://lmodeiyrpwvgyqcvjkjr.supabase.co/functions/v1/labor-service?action=refresh-stale',
    headers := public.cron_edge_headers(),
    body := '{"action": "refresh-stale"}'::jsonb
  ) as request_id;
  $cmd$
);